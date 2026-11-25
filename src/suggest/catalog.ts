/**
 * Own command catalog for command suggestions: what each one does, its subcommands, options
 * and where the values of its arguments come from. Those with live data (folders, branches,
 * hosts…) name a generator (`GenName`, see `generators.ts`).
 *
 * The internal cmd commands that are cmdlet aliases in PowerShell (dir, del, copy, type…) go
 * for cmd only: in PowerShell their options are different and the session itself knows them (TabExpansion2).
 *
 * Descriptions are in Spanish, marked with `k()`: `SuggestMenu` translates them when showing them.
 */
import { k } from "../i18n";
import type { Shell } from "./types";

export type { Shell };

export type GenName =
  | "folders"
  | "paths"
  | "hosts"
  | "gitBranches"
  | "gitRemotes"
  | "npmScripts"
  | "dockerContainers"
  | "dockerImages"
  | "processes";

export interface Value {
  v: string;
  desc?: string;
}
export type ArgSource = GenName | Value[];

export interface Opt {
  name: string;
  desc: string;
  /** The option expects a value (what follows comes from here). */
  arg?: ArgSource;
}

export interface CmdSpec {
  names: string[];
  desc: string;
  /** Without this, in both. */
  shells?: Shell[];
  subs?: CmdSpec[];
  opts?: Opt[];
  /** Positional arguments. */
  args?: ArgSource;
}

const o = (name: string, desc: string, arg?: ArgSource): Opt => ({ name, desc, arg });
const v = (value: string, desc?: string): Value => ({ v: value, desc });
const sub = (names: string | string[], desc: string, rest: Partial<CmdSpec> = {}): CmdSpec => ({
  names: Array.isArray(names) ? names : [names],
  desc,
  ...rest,
});
const CMD: Shell[] = ["cmd"];

export const CATALOG: CmdSpec[] = [
  // --- Files and folders ------------------------------------------------------------------------
  sub("cd", k("Cambiar de carpeta"), { args: "folders", opts: [o("/d", k("también cambia de unidad"))] }),
  sub(["pushd"], k("Ir a una carpeta recordando la actual (volver con popd)"), { args: "folders" }),
  sub(["popd"], k("Volver a la carpeta guardada con pushd")),
  sub(["dir"], k("Listar archivos y carpetas"), {
    shells: CMD,
    args: "paths",
    opts: [o("/s", k("incluye subcarpetas")), o("/b", k("solo los nombres")), o("/a", k("incluye ocultos y de sistema")), o("/o:d", k("ordenado por fecha")), o("/o:s", k("ordenado por tamaño")), o("/w", k("en columnas")), o("/p", k("de a una pantalla"))],
  }),
  sub(["mkdir", "md"], k("Crear una carpeta"), { shells: CMD, args: "folders" }),
  sub(["rmdir", "rd"], k("Borrar una carpeta"), { shells: CMD, args: "folders", opts: [o("/s", k("con todo lo que tiene adentro")), o("/q", k("sin preguntar"))] }),
  sub(["del", "erase"], k("Borrar archivos"), { shells: CMD, args: "paths", opts: [o("/s", k("también en subcarpetas")), o("/q", k("sin preguntar")), o("/f", k("también los de solo lectura")), o("/p", k("pregunta por cada uno"))] }),
  sub(["copy"], k("Copiar archivos"), { shells: CMD, args: "paths", opts: [o("/y", k("pisa sin preguntar")), o("/-y", k("pregunta antes de pisar"))] }),
  sub(["xcopy"], k("Copiar carpetas enteras"), { shells: CMD, args: "paths", opts: [o("/e", k("con subcarpetas, también vacías")), o("/i", k("el destino es una carpeta")), o("/y", k("pisa sin preguntar")), o("/h", k("incluye ocultos"))] }),
  sub(["robocopy"], k("Copiar o espejar carpetas (robusto, reanuda)"), { args: "folders", opts: [o("/e", k("con subcarpetas")), o("/mir", k("espeja: borra en el destino lo que no está en el origen")), o("/z", k("reanudable")), o("/mt:8", k("8 hilos"))] }),
  sub(["move"], k("Mover o renombrar archivos"), { shells: CMD, args: "paths", opts: [o("/y", k("pisa sin preguntar"))] }),
  sub(["ren", "rename"], k("Renombrar un archivo o carpeta"), { shells: CMD, args: "paths" }),
  sub(["type"], k("Mostrar el contenido de un archivo"), { shells: CMD, args: "paths" }),
  sub(["tree"], k("Árbol de carpetas"), { args: "folders", opts: [o("/f", k("con los archivos")), o("/a", k("con caracteres simples"))] }),
  sub(["start"], k("Abrir un archivo, carpeta o programa en otra ventana"), { shells: CMD, args: [v(".", k("esta carpeta en el Explorador"))] }),
  sub(["explorer"], k("Abrir el Explorador de archivos"), { args: [v(".", k("esta carpeta"))] }),
  sub(["code"], k("Abrir en Visual Studio Code"), { args: [v(".", k("esta carpeta"))], opts: [o("-n", k("ventana nueva")), o("-r", k("en la ventana abierta")), o("--diff", k("comparar dos archivos"))] }),
  sub(["notepad"], k("Abrir en el Bloc de notas"), { args: "paths" }),
  sub(["where"], k("Dónde está un programa del PATH"), { shells: CMD }),
  sub(["attrib"], k("Ver o cambiar atributos de archivos"), { args: "paths", opts: [o("+h", k("ocultar")), o("-h", k("mostrar")), o("+r", k("solo lectura")), o("-r", k("quitar solo lectura")), o("/s", k("en subcarpetas"))] }),

  // --- Network --------------------------------------------------------------------------------------
  sub(["ping"], k("Probar si responde un equipo o sitio"), {
    args: "hosts",
    opts: [o("-t", k("hasta Ctrl+C")), o("-n", k("cantidad de pings"), [v("4"), v("10"), v("100")]), o("-l", k("tamaño del paquete en bytes"), [v("32"), v("1472")]), o("-a", k("muestra el nombre del equipo")), o("-4", k("solo IPv4")), o("-6", k("solo IPv6")), o("-w", k("espera máxima en ms"), [v("1000"), v("5000")])],
  }),
  sub(["tracert"], k("Ver por dónde pasa la conexión hasta un sitio"), { args: "hosts", opts: [o("-d", k("sin resolver nombres (más rápido)")), o("-h", k("saltos máximos"), [v("15"), v("30")]), o("-w", k("espera por salto en ms"))] }),
  sub(["pathping"], k("tracert + pérdida de paquetes por salto"), { args: "hosts", opts: [o("-n", k("sin resolver nombres"))] }),
  sub(["nslookup"], k("Consultar el DNS de un nombre"), { args: "hosts" }),
  sub(["ipconfig"], k("Ver la configuración de red"), {
    args: [v("/all", k("todo, con MAC y DNS")), v("/flushdns", k("vaciar la caché de DNS")), v("/displaydns", k("ver la caché de DNS")), v("/release", k("soltar la IP")), v("/renew", k("pedir IP nueva"))],
  }),
  sub(["netstat"], k("Conexiones y puertos abiertos"), {
    args: [v("-ano", k("todo, numérico y con PID")), v("-an", k("todo, numérico"))],
    opts: [o("-a", k("todas las conexiones y puertos en escucha")), o("-n", k("números en vez de nombres")), o("-o", k("con el PID dueño")), o("-b", k("con el programa (como administrador)")), o("-r", k("tabla de rutas")), o("-e", k("estadísticas de la placa"))],
  }),
  sub(["arp"], k("Tabla de equipos de la red local"), { args: [v("-a", k("ver la tabla"))] }),
  sub(["route"], k("Tabla de rutas"), { args: [v("print", k("ver las rutas"))] }),
  sub(["curl"], k("Pedir una URL"), {
    shells: CMD,
    args: [v("http://localhost:3000"), v("http://localhost:8080"), v("https://")],
    opts: [o("-I", k("solo los encabezados")), o("-L", k("seguir redirecciones")), o("-o", k("guardar en un archivo"), "paths"), o("-O", k("guardar con el nombre remoto")), o("-X", k("método"), [v("GET"), v("POST"), v("PUT"), v("DELETE")]), o("-H", k("encabezado")), o("-d", k("datos a enviar")), o("-v", k("mostrar todo")), o("-s", k("sin progreso")), o("-k", k("sin verificar el certificado"))],
  }),
  sub(["ssh"], k("Conectarse a otro equipo"), { args: "hosts", opts: [o("-p", k("puerto"), [v("22"), v("2222")]), o("-i", k("clave privada"), "paths"), o("-L", k("túnel local (puerto:host:puerto)")), o("-v", k("mostrar el detalle de la conexión"))] }),
  sub(["scp"], k("Copiar archivos por SSH"), { args: "paths", opts: [o("-r", k("carpetas enteras")), o("-P", k("puerto"))] }),

  // --- System ----------------------------------------------------------------------------------
  sub(["tasklist"], k("Procesos abiertos"), { opts: [o("/v", k("con detalle")), o("/svc", k("con los servicios de cada uno")), o("/fi", k("filtro"), [v('"IMAGENAME eq chrome.exe"'), v('"STATUS eq NOT RESPONDING"')])] }),
  sub(["taskkill"], k("Cerrar un proceso"), { opts: [o("/IM", k("por nombre"), "processes"), o("/PID", k("por número de proceso")), o("/F", k("a la fuerza")), o("/T", k("con sus procesos hijos"))] }),
  sub(["shutdown"], k("Apagar o reiniciar"), {
    opts: [o("/s", k("apagar")), o("/r", k("reiniciar")), o("/a", k("cancelar un apagado programado")), o("/t", k("en N segundos"), [v("0", k("ya")), v("60"), v("3600", k("en una hora"))]), o("/h", k("hibernar")), o("/l", k("cerrar sesión"))],
  }),
  sub(["systeminfo"], k("Datos del equipo y de Windows")),
  sub(["whoami"], k("Usuario actual"), { args: [v("/all", k("con grupos y privilegios")), v("/groups", k("grupos")), v("/priv", k("privilegios"))] }),
  sub(["hostname"], k("Nombre del equipo")),
  sub(["sfc"], k("Revisar archivos de Windows (como administrador)"), { args: [v("/scannow", k("revisar y reparar")), v("/verifyonly", k("solo revisar"))] }),
  sub(["chkdsk"], k("Revisar un disco"), { args: [v("C:")], opts: [o("/f", k("corregir errores")), o("/r", k("buscar sectores malos")), o("/scan", k("en línea, sin desmontar"))] }),
  sub(["winget"], k("Instalar y actualizar programas"), {
    subs: [
      sub("search", k("buscar un programa")),
      sub("install", k("instalar"), { opts: [o("--id", k("por id exacto")), o("-e", k("nombre exacto")), o("--silent", k("sin ventanas"))] }),
      sub("upgrade", k("actualizar"), { opts: [o("--all", k("todo lo que tenga actualización")), o("--include-unknown", k("también los de versión desconocida"))] }),
      sub("list", k("programas instalados"), { opts: [o("--upgrade-available", k("solo los que tienen actualización"))] }),
      sub("uninstall", k("desinstalar")),
      sub("show", k("detalles de un programa")),
      sub("source", k("orígenes de paquetes")),
    ],
  }),
  sub(["wsl"], k("Linux dentro de Windows"), {
    opts: [o("-l", k("distribuciones instaladas")), o("-v", k("con versión y estado")), o("--shutdown", k("apagar todas")), o("-d", k("usar una distribución")), o("--install", k("instalar")), o("--update", k("actualizar WSL")), o("-u", k("como otro usuario"))],
  }),
  sub(["set"], k("Ver o cambiar variables de entorno"), { shells: CMD }),
  sub(["echo"], k("Mostrar un texto"), { shells: CMD }),
  sub(["cls"], k("Limpiar la pantalla"), { shells: CMD }),
  sub(["exit"], k("Cerrar la shell")),

  // --- Development -------------------------------------------------------------------------------
  sub(["git"], k("Control de versiones"), {
    subs: [
      sub("status", k("qué cambió"), { opts: [o("-s", k("resumido"))] }),
      sub("add", k("preparar cambios"), { args: "paths", opts: [o("-A", k("todo")), o("-p", k("de a partes")), o(".", k("esta carpeta"))] }),
      sub("commit", k("guardar los cambios preparados"), { opts: [o("-m", k("con este mensaje")), o("-a", k("prepara lo modificado")), o("--amend", k("corregir el último commit"))] }),
      sub("push", k("subir commits"), { args: "gitRemotes", opts: [o("-u", k("y seguir la rama remota")), o("--force-with-lease", k("forzar sin pisar trabajo ajeno")), o("--tags", k("con los tags"))] }),
      sub("pull", k("bajar y mezclar"), { args: "gitRemotes", opts: [o("--rebase", k("rebasando en vez de mezclar"))] }),
      sub("fetch", k("bajar sin mezclar"), { args: "gitRemotes", opts: [o("--all", k("de todos los remotos")), o("--prune", k("olvidar ramas borradas"))] }),
      sub("checkout", k("cambiar de rama o restaurar archivos"), { args: "gitBranches", opts: [o("-b", k("crear la rama"))] }),
      sub("switch", k("cambiar de rama"), { args: "gitBranches", opts: [o("-c", k("crear la rama"))] }),
      sub("branch", k("ramas"), { args: "gitBranches", opts: [o("-a", k("también las remotas")), o("-d", k("borrar (si ya se mezcló)")), o("-D", k("borrar a la fuerza")), o("-m", k("renombrar")), o("-vv", k("con su remota"))] }),
      sub("merge", k("mezclar otra rama en la actual"), { args: "gitBranches", opts: [o("--no-ff", k("siempre con commit de merge")), o("--abort", k("cancelar"))] }),
      sub("rebase", k("rebasar sobre otra rama"), { args: "gitBranches", opts: [o("-i", k("interactivo")), o("--continue", k("seguir")), o("--abort", k("cancelar"))] }),
      sub("log", k("historial"), { opts: [o("--oneline", k("una línea por commit")), o("--graph", k("con el gráfico de ramas")), o("-n", k("los últimos N"), [v("10"), v("20")]), o("--stat", k("con archivos tocados"))] }),
      sub("diff", k("diferencias"), { args: "paths", opts: [o("--staged", k("lo preparado")), o("--stat", k("resumen"))] }),
      sub("stash", k("guardar cambios aparte"), { subs: [sub("push", k("guardar")), sub("pop", k("recuperar y sacar")), sub("apply", k("recuperar")), sub("list", k("ver")), sub("drop", k("tirar"))] }),
      sub("restore", k("descartar cambios de archivos"), { args: "paths", opts: [o("--staged", k("sacarlos de lo preparado"))] }),
      sub("reset", k("mover la rama"), { args: [v("HEAD~1", k("el commit anterior"))], opts: [o("--soft", k("deja los cambios preparados")), o("--hard", k("descarta los cambios"))] }),
      sub("remote", k("remotos"), { args: "gitRemotes", opts: [o("-v", k("con sus URLs"))], subs: [sub("add", k("agregar")), sub("remove", k("sacar"))] }),
      sub("clone", k("clonar un repositorio")),
      sub("init", k("crear un repositorio acá")),
      sub("tag", k("tags"), { opts: [o("-a", k("anotado")), o("-d", k("borrar"))] }),
      sub("show", k("ver un commit")),
      sub("cherry-pick", k("traer un commit a esta rama")),
      sub("worktree", k("carpetas de trabajo extra"), { subs: [sub("add", k("agregar")), sub("list", k("ver")), sub("remove", k("sacar"))] }),
    ],
  }),
  sub(["npm"], k("Paquetes de Node"), {
    subs: [
      sub("run", k("correr un script del package.json"), { args: "npmScripts" }),
      sub(["install", "i"], k("instalar dependencias"), { opts: [o("-D", k("como dependencia de desarrollo")), o("-g", k("global")), o("--save-exact", k("versión exacta"))] }),
      sub("uninstall", k("desinstalar")),
      sub("start", k("script start")),
      sub("test", k("script test")),
      sub("ci", k("instalar exacto desde el package-lock")),
      sub("outdated", k("dependencias con versión nueva")),
      sub("update", k("actualizar dependencias")),
      sub(["list", "ls"], k("dependencias instaladas"), { opts: [o("--depth=0", k("solo las directas"))] }),
      sub("init", k("crear package.json"), { opts: [o("-y", k("con valores por defecto"))] }),
      sub("audit", k("revisar vulnerabilidades"), { args: [v("fix", k("corregir lo que se pueda"))] }),
    ],
  }),
  sub(["npx"], k("Correr un paquete de Node"), { args: [v("tauri"), v("vite"), v("vitest"), v("tsc"), v("eslint"), v("prettier")] }),
  sub(["node"], k("Correr JavaScript"), { args: "paths", opts: [o("--version", k("versión")), o("-e", k("evaluar este código")), o("--watch", k("reiniciar al guardar")), o("--inspect", k("con depurador"))] }),
  sub(["python", "py"], k("Correr Python"), { args: "paths", opts: [o("-m", k("módulo"), [v("pip"), v("venv"), v("http.server", k("servidor web en esta carpeta"))]), o("-c", k("este código")), o("-V", k("versión"))] }),
  sub(["pip"], k("Paquetes de Python"), {
    subs: [
      sub("install", k("instalar"), { opts: [o("-r", k("desde un archivo"), [v("requirements.txt")]), o("-U", k("actualizar")), o("--user", k("para este usuario"))] }),
      sub("uninstall", k("desinstalar")),
      sub("list", k("instalados"), { opts: [o("--outdated", k("con versión nueva"))] }),
      sub("freeze", k("instalados, para requirements.txt")),
      sub("show", k("detalles de un paquete")),
    ],
  }),
  sub(["docker"], k("Contenedores"), {
    subs: [
      sub("ps", k("contenedores corriendo"), { opts: [o("-a", k("también los parados"))] }),
      sub("images", k("imágenes")),
      sub("run", k("crear y arrancar un contenedor"), { args: "dockerImages", opts: [o("-it", k("interactivo")), o("-d", k("en segundo plano")), o("--rm", k("borrarlo al salir")), o("-p", k("puertos (host:contenedor)"), [v("8080:80"), v("3000:3000")]), o("-v", k("carpeta compartida")), o("--name", k("nombre")), o("-e", k("variable de entorno"))] }),
      sub("exec", k("correr algo en un contenedor"), { args: "dockerContainers", opts: [o("-it", k("interactivo"))] }),
      sub("logs", k("salida de un contenedor"), { args: "dockerContainers", opts: [o("-f", k("seguir")), o("--tail", k("las últimas N líneas"), [v("100")])] }),
      sub("start", k("arrancar"), { args: "dockerContainers" }),
      sub("stop", k("parar"), { args: "dockerContainers" }),
      sub("restart", k("reiniciar"), { args: "dockerContainers" }),
      sub("rm", k("borrar un contenedor"), { args: "dockerContainers", opts: [o("-f", k("aunque esté corriendo"))] }),
      sub("rmi", k("borrar una imagen"), { args: "dockerImages" }),
      sub("pull", k("bajar una imagen")),
      sub("build", k("armar una imagen"), { args: [v(".", k("con el Dockerfile de acá"))], opts: [o("-t", k("nombre:tag")), o("-f", k("otro Dockerfile"), "paths")] }),
      sub("compose", k("varios contenedores juntos"), { subs: [sub("up", k("levantar"), { opts: [o("-d", k("en segundo plano")), o("--build", k("rearmando"))] }), sub("down", k("bajar")), sub("logs", k("salida"), { opts: [o("-f", k("seguir"))] }), sub("ps", k("estado"))] }),
      sub("system", k("mantenimiento"), { subs: [sub("prune", k("borrar lo que no se usa"), { opts: [o("-a", k("también imágenes sin usar"))] }), sub("df", k("espacio usado"))] }),
    ],
  }),
  sub(["cargo"], k("Proyectos de Rust"), {
    subs: [
      sub("build", k("compilar"), { opts: [o("--release", k("optimizado"))] }),
      sub("run", k("compilar y correr"), { opts: [o("--release", k("optimizado"))] }),
      sub("test", k("tests")),
      sub("check", k("revisar sin compilar del todo")),
      sub("clippy", k("sugerencias del linter")),
      sub("fmt", k("formatear")),
      sub("add", k("agregar una dependencia")),
      sub("update", k("actualizar dependencias")),
      sub("clean", k("borrar lo compilado")),
    ],
  }),
  sub(["claude"], "Claude Code", {
    opts: [o("--model", k("modelo"), [v("opus"), v("sonnet"), v("haiku"), v("fable")]), o("-p", k("una pregunta y salir")), o("-c", k("seguir la última conversación")), o("--resume", k("elegir una conversación")), o("--dangerously-skip-permissions", k("sin pedir permisos"))],
  }),
  sub(["codex"], "Codex", { subs: [sub("exec", k("una tarea y salir")), sub("resume", k("seguir una sesión"))], opts: [o("--model", k("modelo")), o("--full-auto", k("sin pedir permisos"))] }),
  sub(["agy"], "Antigravity"),
  sub(["opencode"], "OpenCode"),
];

const norm = (name: string) => name.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");

export function findSpec(name: string, shell: Shell): CmdSpec | null {
  const n = norm(name);
  return CATALOG.find((s) => (!s.shells || s.shells.includes(shell)) && s.names.includes(n)) ?? null;
}

/** Catalog commands for this shell (for the first word). */
export const catalogFor = (shell: Shell) => CATALOG.filter((s) => !s.shells || s.shells.includes(shell));
