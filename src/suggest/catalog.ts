/**
 * Catálogo propio de comandos para las predicciones: qué hace cada uno, sus subcomandos, opciones
 * y de dónde salen los valores de sus argumentos. Los que tienen datos en vivo (carpetas, ramas,
 * hosts…) nombran un generador (`GenName`, ver `generators.ts`).
 *
 * Los comandos internos de cmd que en PowerShell son alias de cmdlets (dir, del, copy, type…) van
 * solo para cmd: en PowerShell sus opciones son otras y las sabe la propia sesión (TabExpansion2).
 */
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
  /** La opción espera un valor (lo que sigue sale de acá). */
  arg?: ArgSource;
}

export interface CmdSpec {
  names: string[];
  desc: string;
  /** Sin esto, en las dos. */
  shells?: Shell[];
  subs?: CmdSpec[];
  opts?: Opt[];
  /** Argumentos posicionales. */
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
  // --- Archivos y carpetas ----------------------------------------------------------------------
  sub("cd", "Cambiar de carpeta", { args: "folders", opts: [o("/d", "también cambia de unidad")] }),
  sub(["pushd"], "Ir a una carpeta recordando la actual (volver con popd)", { args: "folders" }),
  sub(["popd"], "Volver a la carpeta guardada con pushd"),
  sub(["dir"], "Listar archivos y carpetas", {
    shells: CMD,
    args: "paths",
    opts: [o("/s", "incluye subcarpetas"), o("/b", "solo los nombres"), o("/a", "incluye ocultos y de sistema"), o("/o:d", "ordenado por fecha"), o("/o:s", "ordenado por tamaño"), o("/w", "en columnas"), o("/p", "de a una pantalla")],
  }),
  sub(["mkdir", "md"], "Crear una carpeta", { shells: CMD, args: "folders" }),
  sub(["rmdir", "rd"], "Borrar una carpeta", { shells: CMD, args: "folders", opts: [o("/s", "con todo lo que tiene adentro"), o("/q", "sin preguntar")] }),
  sub(["del", "erase"], "Borrar archivos", { shells: CMD, args: "paths", opts: [o("/s", "también en subcarpetas"), o("/q", "sin preguntar"), o("/f", "también los de solo lectura"), o("/p", "pregunta por cada uno")] }),
  sub(["copy"], "Copiar archivos", { shells: CMD, args: "paths", opts: [o("/y", "pisa sin preguntar"), o("/-y", "pregunta antes de pisar")] }),
  sub(["xcopy"], "Copiar carpetas enteras", { shells: CMD, args: "paths", opts: [o("/e", "con subcarpetas, también vacías"), o("/i", "el destino es una carpeta"), o("/y", "pisa sin preguntar"), o("/h", "incluye ocultos")] }),
  sub(["robocopy"], "Copiar o espejar carpetas (robusto, reanuda)", { args: "folders", opts: [o("/e", "con subcarpetas"), o("/mir", "espeja: borra en el destino lo que no está en el origen"), o("/z", "reanudable"), o("/mt:8", "8 hilos")] }),
  sub(["move"], "Mover o renombrar archivos", { shells: CMD, args: "paths", opts: [o("/y", "pisa sin preguntar")] }),
  sub(["ren", "rename"], "Renombrar un archivo o carpeta", { shells: CMD, args: "paths" }),
  sub(["type"], "Mostrar el contenido de un archivo", { shells: CMD, args: "paths" }),
  sub(["tree"], "Árbol de carpetas", { args: "folders", opts: [o("/f", "con los archivos"), o("/a", "con caracteres simples")] }),
  sub(["start"], "Abrir un archivo, carpeta o programa en otra ventana", { shells: CMD, args: [v(".", "esta carpeta en el Explorador")] }),
  sub(["explorer"], "Abrir el Explorador de archivos", { args: [v(".", "esta carpeta")] }),
  sub(["code"], "Abrir en Visual Studio Code", { args: [v(".", "esta carpeta")], opts: [o("-n", "ventana nueva"), o("-r", "en la ventana abierta"), o("--diff", "comparar dos archivos")] }),
  sub(["notepad"], "Abrir en el Bloc de notas", { args: "paths" }),
  sub(["where"], "Dónde está un programa del PATH", { shells: CMD }),
  sub(["attrib"], "Ver o cambiar atributos de archivos", { args: "paths", opts: [o("+h", "ocultar"), o("-h", "mostrar"), o("+r", "solo lectura"), o("-r", "quitar solo lectura"), o("/s", "en subcarpetas")] }),

  // --- Red --------------------------------------------------------------------------------------
  sub(["ping"], "Probar si responde un equipo o sitio", {
    args: "hosts",
    opts: [o("-t", "hasta Ctrl+C"), o("-n", "cantidad de pings", [v("4"), v("10"), v("100")]), o("-l", "tamaño del paquete en bytes", [v("32"), v("1472")]), o("-a", "muestra el nombre del equipo"), o("-4", "solo IPv4"), o("-6", "solo IPv6"), o("-w", "espera máxima en ms", [v("1000"), v("5000")])],
  }),
  sub(["tracert"], "Ver por dónde pasa la conexión hasta un sitio", { args: "hosts", opts: [o("-d", "sin resolver nombres (más rápido)"), o("-h", "saltos máximos", [v("15"), v("30")]), o("-w", "espera por salto en ms")] }),
  sub(["pathping"], "tracert + pérdida de paquetes por salto", { args: "hosts", opts: [o("-n", "sin resolver nombres")] }),
  sub(["nslookup"], "Consultar el DNS de un nombre", { args: "hosts" }),
  sub(["ipconfig"], "Ver la configuración de red", {
    args: [v("/all", "todo, con MAC y DNS"), v("/flushdns", "vaciar la caché de DNS"), v("/displaydns", "ver la caché de DNS"), v("/release", "soltar la IP"), v("/renew", "pedir IP nueva")],
  }),
  sub(["netstat"], "Conexiones y puertos abiertos", {
    args: [v("-ano", "todo, numérico y con PID"), v("-an", "todo, numérico")],
    opts: [o("-a", "todas las conexiones y puertos en escucha"), o("-n", "números en vez de nombres"), o("-o", "con el PID dueño"), o("-b", "con el programa (como administrador)"), o("-r", "tabla de rutas"), o("-e", "estadísticas de la placa")],
  }),
  sub(["arp"], "Tabla de equipos de la red local", { args: [v("-a", "ver la tabla")] }),
  sub(["route"], "Tabla de rutas", { args: [v("print", "ver las rutas")] }),
  sub(["curl"], "Pedir una URL", {
    shells: CMD,
    args: [v("http://localhost:3000"), v("http://localhost:8080"), v("https://")],
    opts: [o("-I", "solo los encabezados"), o("-L", "seguir redirecciones"), o("-o", "guardar en un archivo", "paths"), o("-O", "guardar con el nombre remoto"), o("-X", "método", [v("GET"), v("POST"), v("PUT"), v("DELETE")]), o("-H", "encabezado"), o("-d", "datos a enviar"), o("-v", "mostrar todo"), o("-s", "sin progreso"), o("-k", "sin verificar el certificado")],
  }),
  sub(["ssh"], "Conectarse a otro equipo", { args: "hosts", opts: [o("-p", "puerto", [v("22"), v("2222")]), o("-i", "clave privada", "paths"), o("-L", "túnel local (puerto:host:puerto)"), o("-v", "mostrar el detalle de la conexión")] }),
  sub(["scp"], "Copiar archivos por SSH", { args: "paths", opts: [o("-r", "carpetas enteras"), o("-P", "puerto")] }),

  // --- Sistema ----------------------------------------------------------------------------------
  sub(["tasklist"], "Procesos abiertos", { opts: [o("/v", "con detalle"), o("/svc", "con los servicios de cada uno"), o("/fi", "filtro", [v('"IMAGENAME eq chrome.exe"'), v('"STATUS eq NOT RESPONDING"')])] }),
  sub(["taskkill"], "Cerrar un proceso", { opts: [o("/IM", "por nombre", "processes"), o("/PID", "por número de proceso"), o("/F", "a la fuerza"), o("/T", "con sus procesos hijos")] }),
  sub(["shutdown"], "Apagar o reiniciar", {
    opts: [o("/s", "apagar"), o("/r", "reiniciar"), o("/a", "cancelar un apagado programado"), o("/t", "en N segundos", [v("0", "ya"), v("60"), v("3600", "en una hora")]), o("/h", "hibernar"), o("/l", "cerrar sesión")],
  }),
  sub(["systeminfo"], "Datos del equipo y de Windows"),
  sub(["whoami"], "Usuario actual", { args: [v("/all", "con grupos y privilegios"), v("/groups", "grupos"), v("/priv", "privilegios")] }),
  sub(["hostname"], "Nombre del equipo"),
  sub(["sfc"], "Revisar archivos de Windows (como administrador)", { args: [v("/scannow", "revisar y reparar"), v("/verifyonly", "solo revisar")] }),
  sub(["chkdsk"], "Revisar un disco", { args: [v("C:")], opts: [o("/f", "corregir errores"), o("/r", "buscar sectores malos"), o("/scan", "en línea, sin desmontar")] }),
  sub(["winget"], "Instalar y actualizar programas", {
    subs: [
      sub("search", "buscar un programa"),
      sub("install", "instalar", { opts: [o("--id", "por id exacto"), o("-e", "nombre exacto"), o("--silent", "sin ventanas")] }),
      sub("upgrade", "actualizar", { opts: [o("--all", "todo lo que tenga actualización"), o("--include-unknown", "también los de versión desconocida")] }),
      sub("list", "programas instalados", { opts: [o("--upgrade-available", "solo los que tienen actualización")] }),
      sub("uninstall", "desinstalar"),
      sub("show", "detalles de un programa"),
      sub("source", "orígenes de paquetes"),
    ],
  }),
  sub(["wsl"], "Linux dentro de Windows", {
    opts: [o("-l", "distribuciones instaladas"), o("-v", "con versión y estado"), o("--shutdown", "apagar todas"), o("-d", "usar una distribución"), o("--install", "instalar"), o("--update", "actualizar WSL"), o("-u", "como otro usuario")],
  }),
  sub(["set"], "Ver o cambiar variables de entorno", { shells: CMD }),
  sub(["echo"], "Mostrar un texto", { shells: CMD }),
  sub(["cls"], "Limpiar la pantalla", { shells: CMD }),
  sub(["exit"], "Cerrar la shell"),

  // --- Desarrollo -------------------------------------------------------------------------------
  sub(["git"], "Control de versiones", {
    subs: [
      sub("status", "qué cambió", { opts: [o("-s", "resumido")] }),
      sub("add", "preparar cambios", { args: "paths", opts: [o("-A", "todo"), o("-p", "de a partes"), o(".", "esta carpeta")] }),
      sub("commit", "guardar los cambios preparados", { opts: [o("-m", "con este mensaje"), o("-a", "prepara lo modificado"), o("--amend", "corregir el último commit")] }),
      sub("push", "subir commits", { args: "gitRemotes", opts: [o("-u", "y seguir la rama remota"), o("--force-with-lease", "forzar sin pisar trabajo ajeno"), o("--tags", "con los tags")] }),
      sub("pull", "bajar y mezclar", { args: "gitRemotes", opts: [o("--rebase", "rebasando en vez de mezclar")] }),
      sub("fetch", "bajar sin mezclar", { args: "gitRemotes", opts: [o("--all", "de todos los remotos"), o("--prune", "olvidar ramas borradas")] }),
      sub("checkout", "cambiar de rama o restaurar archivos", { args: "gitBranches", opts: [o("-b", "crear la rama")] }),
      sub("switch", "cambiar de rama", { args: "gitBranches", opts: [o("-c", "crear la rama")] }),
      sub("branch", "ramas", { args: "gitBranches", opts: [o("-a", "también las remotas"), o("-d", "borrar (si ya se mezcló)"), o("-D", "borrar a la fuerza"), o("-m", "renombrar"), o("-vv", "con su remota")] }),
      sub("merge", "mezclar otra rama en la actual", { args: "gitBranches", opts: [o("--no-ff", "siempre con commit de merge"), o("--abort", "cancelar")] }),
      sub("rebase", "rebasar sobre otra rama", { args: "gitBranches", opts: [o("-i", "interactivo"), o("--continue", "seguir"), o("--abort", "cancelar")] }),
      sub("log", "historial", { opts: [o("--oneline", "una línea por commit"), o("--graph", "con el gráfico de ramas"), o("-n", "los últimos N", [v("10"), v("20")]), o("--stat", "con archivos tocados")] }),
      sub("diff", "diferencias", { args: "paths", opts: [o("--staged", "lo preparado"), o("--stat", "resumen")] }),
      sub("stash", "guardar cambios aparte", { subs: [sub("push", "guardar"), sub("pop", "recuperar y sacar"), sub("apply", "recuperar"), sub("list", "ver"), sub("drop", "tirar")] }),
      sub("restore", "descartar cambios de archivos", { args: "paths", opts: [o("--staged", "sacarlos de lo preparado")] }),
      sub("reset", "mover la rama", { args: [v("HEAD~1", "el commit anterior")], opts: [o("--soft", "deja los cambios preparados"), o("--hard", "descarta los cambios")] }),
      sub("remote", "remotos", { args: "gitRemotes", opts: [o("-v", "con sus URLs")], subs: [sub("add", "agregar"), sub("remove", "sacar")] }),
      sub("clone", "clonar un repositorio"),
      sub("init", "crear un repositorio acá"),
      sub("tag", "tags", { opts: [o("-a", "anotado"), o("-d", "borrar")] }),
      sub("show", "ver un commit"),
      sub("cherry-pick", "traer un commit a esta rama"),
      sub("worktree", "carpetas de trabajo extra", { subs: [sub("add", "agregar"), sub("list", "ver"), sub("remove", "sacar")] }),
    ],
  }),
  sub(["npm"], "Paquetes de Node", {
    subs: [
      sub("run", "correr un script del package.json", { args: "npmScripts" }),
      sub(["install", "i"], "instalar dependencias", { opts: [o("-D", "como dependencia de desarrollo"), o("-g", "global"), o("--save-exact", "versión exacta")] }),
      sub("uninstall", "desinstalar"),
      sub("start", "script start"),
      sub("test", "script test"),
      sub("ci", "instalar exacto desde el package-lock"),
      sub("outdated", "dependencias con versión nueva"),
      sub("update", "actualizar dependencias"),
      sub(["list", "ls"], "dependencias instaladas", { opts: [o("--depth=0", "solo las directas")] }),
      sub("init", "crear package.json", { opts: [o("-y", "con valores por defecto")] }),
      sub("audit", "revisar vulnerabilidades", { args: [v("fix", "corregir lo que se pueda")] }),
    ],
  }),
  sub(["npx"], "Correr un paquete de Node", { args: [v("tauri"), v("vite"), v("vitest"), v("tsc"), v("eslint"), v("prettier")] }),
  sub(["node"], "Correr JavaScript", { args: "paths", opts: [o("--version", "versión"), o("-e", "evaluar este código"), o("--watch", "reiniciar al guardar"), o("--inspect", "con depurador")] }),
  sub(["python", "py"], "Correr Python", { args: "paths", opts: [o("-m", "módulo", [v("pip"), v("venv"), v("http.server", "servidor web en esta carpeta")]), o("-c", "este código"), o("-V", "versión")] }),
  sub(["pip"], "Paquetes de Python", {
    subs: [
      sub("install", "instalar", { opts: [o("-r", "desde un archivo", [v("requirements.txt")]), o("-U", "actualizar"), o("--user", "para este usuario")] }),
      sub("uninstall", "desinstalar"),
      sub("list", "instalados", { opts: [o("--outdated", "con versión nueva")] }),
      sub("freeze", "instalados, para requirements.txt"),
      sub("show", "detalles de un paquete"),
    ],
  }),
  sub(["docker"], "Contenedores", {
    subs: [
      sub("ps", "contenedores corriendo", { opts: [o("-a", "también los parados")] }),
      sub("images", "imágenes"),
      sub("run", "crear y arrancar un contenedor", { args: "dockerImages", opts: [o("-it", "interactivo"), o("-d", "en segundo plano"), o("--rm", "borrarlo al salir"), o("-p", "puertos (host:contenedor)", [v("8080:80"), v("3000:3000")]), o("-v", "carpeta compartida"), o("--name", "nombre"), o("-e", "variable de entorno")] }),
      sub("exec", "correr algo en un contenedor", { args: "dockerContainers", opts: [o("-it", "interactivo")] }),
      sub("logs", "salida de un contenedor", { args: "dockerContainers", opts: [o("-f", "seguir"), o("--tail", "las últimas N líneas", [v("100")])] }),
      sub("start", "arrancar", { args: "dockerContainers" }),
      sub("stop", "parar", { args: "dockerContainers" }),
      sub("restart", "reiniciar", { args: "dockerContainers" }),
      sub("rm", "borrar un contenedor", { args: "dockerContainers", opts: [o("-f", "aunque esté corriendo")] }),
      sub("rmi", "borrar una imagen", { args: "dockerImages" }),
      sub("pull", "bajar una imagen"),
      sub("build", "armar una imagen", { args: [v(".", "con el Dockerfile de acá")], opts: [o("-t", "nombre:tag"), o("-f", "otro Dockerfile", "paths")] }),
      sub("compose", "varios contenedores juntos", { subs: [sub("up", "levantar", { opts: [o("-d", "en segundo plano"), o("--build", "rearmando")] }), sub("down", "bajar"), sub("logs", "salida", { opts: [o("-f", "seguir")] }), sub("ps", "estado")] }),
      sub("system", "mantenimiento", { subs: [sub("prune", "borrar lo que no se usa", { opts: [o("-a", "también imágenes sin usar")] }), sub("df", "espacio usado")] }),
    ],
  }),
  sub(["cargo"], "Proyectos de Rust", {
    subs: [
      sub("build", "compilar", { opts: [o("--release", "optimizado")] }),
      sub("run", "compilar y correr", { opts: [o("--release", "optimizado")] }),
      sub("test", "tests"),
      sub("check", "revisar sin compilar del todo"),
      sub("clippy", "sugerencias del linter"),
      sub("fmt", "formatear"),
      sub("add", "agregar una dependencia"),
      sub("update", "actualizar dependencias"),
      sub("clean", "borrar lo compilado"),
    ],
  }),
  sub(["claude"], "Claude Code", {
    opts: [o("--model", "modelo", [v("opus"), v("sonnet"), v("haiku"), v("fable")]), o("-p", "una pregunta y salir"), o("-c", "seguir la última conversación"), o("--resume", "elegir una conversación"), o("--dangerously-skip-permissions", "sin pedir permisos")],
  }),
  sub(["codex"], "Codex", { subs: [sub("exec", "una tarea y salir"), sub("resume", "seguir una sesión")], opts: [o("--model", "modelo"), o("--full-auto", "sin pedir permisos")] }),
  sub(["agy"], "Antigravity"),
  sub(["opencode"], "OpenCode"),
];

const norm = (name: string) => name.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");

export function findSpec(name: string, shell: Shell): CmdSpec | null {
  const n = norm(name);
  return CATALOG.find((s) => (!s.shells || s.shells.includes(shell)) && s.names.includes(n)) ?? null;
}

/** Comandos del catálogo para esta shell (para la primera palabra). */
export const catalogFor = (shell: Shell) => CATALOG.filter((s) => !s.shells || s.shells.includes(shell));
