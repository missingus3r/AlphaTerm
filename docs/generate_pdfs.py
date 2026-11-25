"""Genera los PDF de la documentación (especificación, plan y guía de código) en cada idioma.

Los txt son la fuente de verdad: si cambian, se vuelve a correr este script.
- es: docs/es/Terminal_Plan.txt y docs/es/Code_Guide.txt → docs/
- en: docs/en/Terminal_Plan.txt y Code_Guide.txt → docs/en/
- pt: docs/pt/Terminal_Plan.txt y Code_Guide.txt → docs/pt/
Uso:  python docs/generate_pdfs.py [es] [en] [pt]   (sin idiomas: los tres; necesita fpdf2)
"""
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

from fpdf import FPDF

RAIZ = Path(__file__).resolve().parent.parent
PLAN = RAIZ / "docs/es/Terminal_Plan.txt"
SALIDA = RAIZ / "docs"
FUENTES = Path("C:/Windows/Fonts")

ACENTO = (37, 99, 235)
GRIS = (90, 90, 90)
NEGRO = (25, 25, 25)


def leer_secciones(texto: str) -> tuple[list[str], dict[str, list[str]]]:
    """Separa el txt en el encabezado y las secciones marcadas con líneas de '='."""
    lineas = texto.replace("\r\n", "\n").split("\n")
    encabezado: list[str] = []
    secciones: dict[str, list[str]] = {}
    actual: list[str] = encabezado
    i = 0
    while i < len(lineas):
        l = lineas[i]
        if re.fullmatch(r"=+", l.strip()) and i + 2 < len(lineas) and re.fullmatch(r"=+", lineas[i + 2].strip()):
            titulo = lineas[i + 1].strip()
            actual = secciones.setdefault(titulo, [])
            i += 3
            continue
        actual.append(l)
        i += 1
    return encabezado, secciones


def agrupar(lineas: list[str]) -> list[tuple[str, int, str]]:
    """Convierte líneas con cortes duros en bloques (tipo, sangría, texto)."""
    bloques: list[tuple[str, int, str]] = []
    en_arbol = False
    for crudo in lineas:
        if not crudo.strip():
            en_arbol = False
            bloques.append(("blanco", 0, ""))
            continue
        sangria = len(crudo) - len(crudo.lstrip(" "))
        l = crudo.strip()
        if re.match(r"^Desktop\\NovaTerm\\", l):
            en_arbol = True
        if en_arbol:
            bloques.append(("mono", 0, crudo.rstrip()))
            continue
        if re.match(r"^F\d+ — ", l):
            bloques.append(("fase", 0, l))
        elif re.match(r"^\d+\.\s", l):
            bloques.append(("titulo", 0, l))
        elif m := re.match(r"^- (.*)", l):
            bloques.append(("viñeta", sangria, m.group(1)))
        elif m := re.match(r"^(i{1,3}|iv|v)\.\s+(.*)", l):
            bloques.append(("romano", sangria, f"{m.group(1)}. {m.group(2)}"))
        elif bloques and bloques[-1][0] in ("viñeta", "romano", "parrafo") and sangria > bloques[-1][1]:
            tipo, s, t = bloques[-1]
            bloques[-1] = (tipo, s, f"{t} {l}")
        elif l.endswith(":") and len(l) < 60:
            bloques.append(("subtitulo", 0, l))
        else:
            bloques.append(("parrafo", sangria, l))
    return bloques


class Doc(FPDF):
    def __init__(self, titulo: str):
        super().__init__(format="A4")
        self.titulo_doc = titulo
        self.add_font("Segoe", "", str(FUENTES / "segoeui.ttf"))
        self.add_font("Segoe", "B", str(FUENTES / "segoeuib.ttf"))
        self.add_font("Segoe", "I", str(FUENTES / "segoeuii.ttf"))
        self.add_font("Mono", "", str(FUENTES / "consola.ttf"))
        self.set_margins(20, 18, 20)
        self.set_auto_page_break(True, 18)

    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Segoe", "", 8)
        self.set_text_color(*GRIS)
        self.cell(0, 6, f"AlphaTerm — {self.titulo_doc}", align="L")
        self.ln(8)

    def footer(self):
        self.set_y(-12)
        self.set_font("Segoe", "", 8)
        self.set_text_color(*GRIS)
        self.cell(0, 6, f"{self.page_no()}", align="C")

    def portada(self, subtitulo: str, guardado: str, generado: str):
        self.add_page()
        self.ln(60)
        self.set_font("Segoe", "B", 30)
        self.set_text_color(*ACENTO)
        self.cell(0, 14, "AlphaTerm", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Segoe", "", 16)
        self.set_text_color(*NEGRO)
        self.multi_cell(0, 9, self.titulo_doc, new_x="LMARGIN", new_y="NEXT")
        self.ln(4)
        self.set_font("Segoe", "", 11)
        self.set_text_color(*GRIS)
        self.multi_cell(0, 6, subtitulo, new_x="LMARGIN", new_y="NEXT")
        self.ln(30)
        self.set_font("Segoe", "", 9)
        fuente = getattr(self, "fuente", "docs/es/Terminal_Plan.txt")
        pie = generado.format(fecha=f"{date.today():%d/%m/%Y}", fuente=fuente)
        self.multi_cell(0, 5, f"{guardado}\n{pie}", new_x="LMARGIN", new_y="NEXT")

    def seccion(self, titulo: str):
        self.add_page()
        self.set_font("Segoe", "B", 18)
        self.set_text_color(*ACENTO)
        self.multi_cell(0, 10, titulo.capitalize() if titulo.isupper() else titulo, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*ACENTO)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(4)

    def bloques(self, bloques: list[tuple[str, int, str]]):
        ancho = self.w - self.l_margin - self.r_margin
        previo = None
        for tipo, sangria, texto in bloques:
            if tipo == "blanco":
                if previo not in (None, "blanco"):
                    self.ln(2)
                previo = tipo
                continue
            self.set_text_color(*NEGRO)
            if tipo in ("fase", "titulo"):
                self.ln(3)
                self.set_font("Segoe", "B", 13 if tipo == "fase" else 12)
                self.set_text_color(*ACENTO if tipo == "fase" else NEGRO)
                self.multi_cell(0, 7, texto, new_x="LMARGIN", new_y="NEXT")
                self.ln(1)
            elif tipo == "subtitulo":
                self.set_font("Segoe", "B", 10.5)
                self.multi_cell(0, 6, texto, new_x="LMARGIN", new_y="NEXT")
            elif tipo == "mono":
                self.set_font("Mono", "", 8.5)
                self.set_fill_color(244, 246, 250)
                self.multi_cell(0, 4.6, texto, fill=True, new_x="LMARGIN", new_y="NEXT")
            elif tipo in ("viñeta", "romano"):
                nivel = (sangria + 1) // 3
                x = self.l_margin + 3 + nivel * 6
                self.set_x(x)
                self.set_font("Segoe", "", 10)
                marca = "•" if tipo == "viñeta" else ""
                if marca:
                    self.cell(4, 5.5, marca)
                self.multi_cell(ancho - (self.get_x() - self.l_margin), 5.5, texto, new_x="LMARGIN", new_y="NEXT")
            else:
                self.set_font("Segoe", "", 10)
                self.multi_cell(0, 5.5, texto, new_x="LMARGIN", new_y="NEXT")
            previo = tipo


def construir(nombre: str, titulo: str, subtitulo: str, guardado: str,
              secciones: dict[str, list[str]], orden: list[str], fuente: str = "docs/es/Terminal_Plan.txt",
              salida: Path = SALIDA, generado: str = "Generado el {fecha} desde {fuente}"):
    doc = Doc(titulo)
    doc.fuente = fuente
    doc.portada(subtitulo, guardado, generado)
    for clave in orden:
        reales = [k for k in secciones if k.startswith(clave)]
        for k in reales:
            doc.seccion(k)
            doc.bloques(agrupar(secciones[k]))
    destino = salida / nombre
    doc.output(str(destino))
    print(f"{destino.name}: {doc.page_no()} páginas")


# Por idioma: fuentes, carpeta de salida, nombres, títulos y cómo empiezan las secciones de cada PDF.
IDIOMAS = {
    "es": {
        "plan": "docs/es/Terminal_Plan.txt", "guia": "docs/es/Code_Guide.txt", "salida": "docs/es",
        "guardado": "Guardado:", "generado": "Generado el {fecha} desde {fuente}",
        "espec": ("Specification.pdf", "Especificación funcional y de arquitectura",
                  "Terminal propia estilo Warp, liviana y rápida, para trabajar con agentes de IA.",
                  ["CONTEXTO", "ARQUITECTURA", "FUNCIONALIDADES", "ADENDA"]),
        "fases": ("Plan.pdf", "Plan de implementación por fases", "Fases F0 a F9, criterios de cierre y verificación.",
                  ["FASES", "VERIFICACIÓN", "ADENDA"]),
        "codigo": ("Code_Guide.pdf", "Guía de código", "Cómo está armado AlphaTerm, dónde está cada cosa y cómo extenderlo."),
    },
    "en": {
        "plan": "docs/en/Terminal_Plan.txt", "guia": "docs/en/Code_Guide.txt", "salida": "docs/en",
        "guardado": "Saved:", "generado": "Generated on {fecha} from {fuente}",
        "espec": ("Specification.pdf", "Functional and architecture specification",
                  "A Warp-style terminal of our own, light and fast, for working with AI agents.",
                  ["CONTEXT", "ARCHITECTURE", "FEATURES", "ADDENDUM"]),
        "fases": ("Plan.pdf", "Phased implementation plan", "Phases F0 to F9, completion criteria and verification.",
                  ["PHASES", "VERIFICATION", "ADDENDUM"]),
        "codigo": ("Code_Guide.pdf", "Code guide", "How AlphaTerm is built, where everything lives and how to extend it."),
    },
    "pt": {
        "plan": "docs/pt/Terminal_Plan.txt", "guia": "docs/pt/Code_Guide.txt", "salida": "docs/pt",
        "guardado": "Salvo em:", "generado": "Gerado em {fecha} a partir de {fuente}",
        "espec": ("Specification.pdf", "Especificação funcional e de arquitetura",
                  "Terminal próprio no estilo Warp, leve e rápido, para trabalhar com agentes de IA.",
                  ["CONTEXTO", "ARQUITETURA", "FUNCIONALIDADES", "ADENDO"]),
        "fases": ("Plan.pdf", "Plano de implementação por fases", "Fases F0 a F9, critérios de conclusão e verificação.",
                  ["FASES", "VERIFICAÇÃO", "ADENDO"]),
        "codigo": ("Code_Guide.pdf", "Guia de código", "Como o AlphaTerm é feito, onde fica cada coisa e como estendê-lo."),
    },
}


def generar(idioma: str):
    c = IDIOMAS[idioma]
    salida = RAIZ / c["salida"]
    encabezado, secciones = leer_secciones((RAIZ / c["plan"]).read_text(encoding="utf-8"))
    guardado = next((l.strip() for l in encabezado if l.startswith(c["guardado"])), "")
    for clave in ("espec", "fases"):
        nombre, titulo, subtitulo, orden = c[clave]
        construir(nombre, titulo, subtitulo, guardado, secciones, orden, c["plan"], salida, c["generado"])
    enc, secs = leer_secciones((RAIZ / c["guia"]).read_text(encoding="utf-8"))
    nombre, titulo, subtitulo = c["codigo"]
    construir(nombre, titulo, subtitulo, next((l.strip() for l in enc if l.startswith(c["guardado"])), ""), secs,
              list(secs.keys()), c["guia"], salida, c["generado"])


def main():
    pedidos = sys.argv[1:] or list(IDIOMAS)
    for idioma in pedidos:
        if idioma not in IDIOMAS:
            raise SystemExit(f"Idioma desconocido: {idioma} (es, en o pt)")
        generar(idioma)


if __name__ == "__main__":
    main()
