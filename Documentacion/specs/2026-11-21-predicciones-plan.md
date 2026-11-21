# Predicciones de comandos — plan de implementación

> Para quien ejecute: tareas en orden, con casillas `- [ ]`. Rama `predicciones`.

**Objetivo:** menú de sugerencias debajo del cursor en cmd y PowerShell (carpetas, historial,
catálogo propio y completados de la sesión de PowerShell), sin tocar ↑ ni Tab/Enter/Esc fuera del menú.

**Arquitectura:** lógica pura en `src/suggest/` (leer la línea, catálogo, motor, teclas, inserción,
mensajes de PowerShell), un controlador que la engancha a la xterm de `TerminalView`, un componente
de menú, comandos nuevos en `src-tauri/src/suggest.rs` y un handler de PSReadLine en `alphaterm.ps1`.

**Tecnología:** SolidJS 1.9 + xterm 6, Tauri 2 / Rust, PowerShell 5.1 + PSReadLine 2.0, vitest.

**Diseño:** `Documentacion/specs/2026-11-21-predicciones-de-comandos.md` (leerlo junto con este plan).

## Restricciones globales

- Todas las escrituras a la shell por `PtySession.write` (WriteQueue). Nunca atajos con Ctrl+Alt.
- Enter = `String.fromCharCode(13)`; retroceso = `"\x7f"` (lo que manda xterm).
- Solo perfiles `cmd`, `powershell`, `pwsh`. Cursor al final de lo escrito; una sola línea lógica.
- Sin shell en el medio para lo que arma la app (git/docker por la CLI, como hoy).
- Descripciones y textos visibles en español.
- Atajo escondido: `F12,e` (xterm manda F12 como `\x1b[24~`). OSC propia `7717`:
  `ESC]7717;ready;<nonce>BEL` y `ESC]7717;c;<nonce>;<base64 de JSON UTF-8>BEL`.
  JSON: `{"b":buffer,"c":cursor,"i":ReplacementIndex,"l":ReplacementLength,"r":[{"t":CompletionText,"s":ListItemText,"k":ResultType,"d":ToolTip≤200}]}`, hasta 100 resultados.
- Nonce: variable `ALPHATERM_NONCE` que manda la vista al lanzar la shell; el script la lee y la borra.
- Umbrales: pedir a PowerShell tras 150 ms sin teclas; degradar la pestaña a "solo Ctrl+Espacio" si una
  respuesta tarda > 300 ms; primera palabra con ≥ 2 letras (≥ 3 para pedirle a PowerShell);
  argumentos de ruta con ≥ 1 letra; 8 filas visibles; 500 entradas por carpeta; caché de carpeta 3 s.
- No cerrar la AlphaTerm de Bruno. Pruebas de interfaz con `CARGO_TARGET_DIR=target\prueba` y
  `ALPHATERM_DATA_DIR`/`WEBVIEW2_USER_DATA_FOLDER` propios.

## Foco de revisión (lo que más puede morder)

1. Enter con el menú abierto sin navegar: tiene que ejecutar, y el `keypress` de Enter no puede
   colarse cuando el menú lo tomó (xterm procesa `keypress` aparte) → test en Tarea 5.
2. Teclas tipeadas que la shell todavía no mostró al aceptar una sugerencia → la inserción espera el
   eco (Tarea 7).
3. Un programa o agente corriendo en cmd (lanzado por el panel de agentes, que escribe con Enter) →
   el estado "en el prompt" se apaga con cualquier Enter escrito (Tarea 7).
4. Carpetas con espacios y comillas ya abiertas → Tarea 6.
5. Respuestas de PowerShell viejas o falsas (otro texto con 7717) → nonce y buffer (Tarea 2).

---

### Task 1: handler de PowerShell y prueba real por ConPTY (riesgo 1, va primero)

**Archivos:** `src-tauri/shell/alphaterm.ps1`, test en `src-tauri/src/pty/mod.rs` (`integration_tests`).

- [ ] Test `powershell_completa_con_f12`: `spawn_env` de `powershell` con `ALPHATERM_NONCE=abc123`
  y cwd con una carpeta conocida; esperar `\x1b]7717;ready;abc123`; escribir `Get-ChildIt` y
  después `\x1b[24~e`; esperar `\x1b]7717;c;abc123;`, decodificar el base64 y comprobar
  `b == "Get-ChildIt"`, `c == 11`, y que `r` tenga `Get-ChildItem`. Segundo caso: `cd ` + atajo →
  hay al menos un `ProviderContainer`. Que `$env:ALPHATERM_NONCE` quede vacío en la sesión.
- [ ] Correrlo: falla (no hay handler).
- [ ] Handler con `Set-PSReadLineKeyHandler -Chord 'F12,e'` (solo si existe PSReadLine y hay nonce),
  `GetBufferState` + `TabExpansion2`, `ConvertTo-Json -Compress -Depth 4`, `[Console]::Write` de la OSC.
  `ready` se emite en cada prompt (dentro de `prompt`) si el handler quedó registrado.
- [ ] Correrlo: pasa. **Si no pasa por ConPTY, frenar y avisarle a Bruno (plan B o sin enfoque 2).**
- [ ] Commit.

### Task 2: mensajes de PowerShell en el frontend

**Archivos:** `src/suggest/pwsh.ts`, `src/suggest/pwsh.test.ts`.
**Produce:** `parse7717(data: string, nonce: string): PsMsg | null` con
`PsMsg = { type: "ready" } | { type: "completions"; buffer: string; cursor: number; index: number; length: number; results: PsResult[] }`,
`PsResult = { text: string; label: string; kind: string; tip: string }`. `PS_CHORD = "\x1b[24~e"`.

- [ ] Tests: ready válido; nonce distinto → null; base64 roto → null; JSON con 2 resultados → campos mapeados.
- [ ] Implementar y pasar. Commit.

### Task 3: leer la línea y separar palabras

**Archivos:** `src/suggest/line.ts`, `src/suggest/line.test.ts`.
**Produce:**
- `readInput(buf: BufLike, start: { line: number; x: number }, cur: { line: number; x: number }, cols: number): string | null`
  (`BufLike = { getLine(i): { isWrapped: boolean; translateToString(trim: boolean, s?: number, e?: number): string } | undefined }`);
  null si el cursor está antes del inicio o hay una línea no envuelta en el medio.
- `parseLine(line: string): Parsed` con `Parsed = { words: Word[]; current: Word; index: number }`,
  `Word = { raw: string; value: string; start: number; quote: '"' | "'" | null; closed: boolean }`
  (la actual es vacía con `start = line.length` si la línea termina en espacio fuera de comillas).

- [ ] Tests: `"cd "` → current vacía índice 1; `cd "Mis Doc` → value `Mis Doc`, quote `"`, closed false;
  `cd 'a b\'` → value `a b\`, closed true; línea envuelta en 2 filas; fila no envuelta en el medio → null.
- [ ] Implementar y pasar. Commit.

### Task 4: backend de sugerencias (Rust)

**Archivos:** `src-tauri/src/suggest.rs` (nuevo), `src-tauri/src/lib.rs` (registrar).
**Produce (comandos):**
- `suggest_list_dir(cwd: String, dir: String, dirs_only: bool, hidden: bool) -> Vec<DirEntry { name, dir }>`:
  `dir` relativo a `cwd`, absoluto o con `~`; `\\…` → vacío; máx. 500, orden alfabético sin mayúsculas, caché 3 s.
- `suggest_gateway() -> Option<String>`: `GetBestRoute` hacia 8.8.8.8, siguiente salto IPv4 (caché 60 s).
- `suggest_path_commands() -> Vec<String>`: ejecutables del PATH completo (`agents::agents_path_env()`),
  extensiones de `PATHEXT` + `.ps1`, sin extensión y sin repetir, caché 60 s.
- `suggest_npm_scripts(cwd: String) -> Vec<(String, String)>`: `scripts` del `package.json`.
- `suggest_processes() -> Vec<String>`: nombres de procesos (sysinfo), sin repetir.

- [ ] Tests (`cargo test suggest`): carpeta temporal con `a/`, `B/`, `c.txt`, `.oculta/` → orden y filtros;
  `~` y `..`; ruta de red vacía; `package.json` con 2 scripts; gateway devuelve IPv4 válida o None.
- [ ] Implementar y pasar. Commit.

### Task 5: teclas del menú

**Archivos:** `src/suggest/keys.ts`, `src/suggest/keys.test.ts`.
**Produce:** `menuKey(e: KeyLike, st: { open: boolean; navigating: boolean; enabled: boolean }): MenuKey`
con `MenuKey = "pass" | "up" | "down" | "accept" | "close" | "open" | "toShell"` (`toShell` = cerrar y dejar pasar).
`KeyLike` de `src/terminal/keys.ts`.

- [ ] Tests: la tabla de teclas del diseño completa; Ctrl+Espacio con `enabled: false` → pass;
  Ctrl+Alt+lo que sea → pass; `keypress`/`keyup` → pass (lo traga el controlador, Tarea 7).
- [ ] Implementar y pasar. Commit.

### Task 6: catálogo, motor e inserción

**Archivos:** `src/suggest/catalog.ts`, `src/suggest/engine.ts`, `src/suggest/insert.ts` y sus `.test.ts`.
**Produce:**
- `CmdSpec = { names: string[]; desc: string; shells?: Shell[]; subs?: CmdSpec[]; opts?: Opt[]; args?: ArgSource }`,
  `Opt = { name: string; desc: string; arg?: ArgSource }`, `ArgSource = GenName | Value[]`,
  `GenName = "folders" | "paths" | "hosts" | "gitBranches" | "gitRemotes" | "npmScripts" | "dockerContainers" | "dockerImages" | "processes"`,
  `Value = { v: string; desc?: string }`, `Shell = "cmd" | "ps"`. `findSpec(name, shell): CmdSpec | null`
  (sin mayúsculas, sin `.exe`). Lista de comandos del diseño.
- `Suggestion = { insert: string; label: string; desc?: string; kind: Kind; score: number; replace: "word" | "line"; dir?: boolean; hits?: number[] }`,
  `Kind = "folder" | "file" | "history" | "command" | "option" | "value" | "pwsh"`.
- `Sources = { listDir(dir: string, dirsOnly: boolean, hidden: boolean): Promise<{ name: string; dir: boolean }[]>; history(): Promise<HistEntry[]>; pathCommands(): Promise<string[]>; gen(name: GenName, cwd: string): Promise<Value[]> }`.
- `analyze(p: Parsed, shell: Shell): Analysis` (primera palabra o argumento, comando, spec, fuente del
  argumento, si conviene pedirle a PowerShell, si aparece solo) y
  `collect(a: Analysis, ctx: { line: string; cwd: string; shell: Shell }, src: Sources, ps?: PsMsg): Promise<Suggestion[]>`
  con filtro, orden y sin repetidos del diseño. Historial filtrado por shell (`shell` contiene
  "PowerShell" → ps; "Símbolo" o "cmd" → cmd; null → las dos).
- `insertion(line: string, s: Suggestion, cur: Word, shell: Shell): string`: retrocesos + texto; comillas
  si hace falta (`"` en cmd, `'` en PowerShell); carpeta → termina en `\`; lo demás → espacio; `line` →
  borra la línea entera. Para resultados de PowerShell, retrocesos = `cursor - index`.

- [ ] Tests: `ping ` → 8.8.8.8 y `-t` (con `gen` falso); `cd al` con carpetas falsas → solo carpetas,
  primero las que empiezan con "al"; `git checkout ` → ramas; `git p` con historial → `git push origin main`
  primero, con más puntaje si es de la misma carpeta; historial de cmd no aparece en ps; `Get-Ch` en ps →
  analysis pide PowerShell, `cd x` en ps → no; resultados de PowerShell + carpetas locales sin repetir;
  inserción de `Mis Documentos` en cmd → `"Mis Documentos\"`, en ps → `'Mis Documentos\'`; reemplazo de
  palabra con comillas cerradas; línea de historial → borra todo.
- [ ] Implementar y pasar. Commit.

### Task 7: controlador, menú y engancharlo a la terminal

**Archivos:** `src/suggest/controller.ts`, `src/suggest/SuggestMenu.tsx`, `src/suggest/generators.ts`,
`src/terminal/TerminalView.tsx`, `src/layout/Workspace.tsx`, `src/styles.css`, `src/browser/marks.ts`.
**Produce:** `createSuggest(o: { term: Terminal; profileId: string; write(s: string): void; cwd(): string | undefined; settings(): SuggestSettings; patchCmdCommand(line: string): void }): SuggestCtl`
con `SuggestCtl = { onPromptEnd(): void; onCommandStart(): void; onParsed(): void; onWrite(data: string): void; key(e: KeyboardEvent): boolean; onOsc7717(data: string): boolean; nonce: string; menu: Accessor<MenuView | null>; pick(i: number): void; dispose(): void }`.

- [ ] `TerminalView`: un solo `write()` para todo lo que va a la shell (onData, `send`, `runStartup`)
  que avisa a `onWrite`; `ALPHATERM_NONCE` en el env al lanzar; `registerOscHandler(7717)`; `key()`
  antes de `props.match`; tragar el `keypress` que siga a una tecla tomada; renderizar `<SuggestMenu>`.
- [ ] cmd: Enter en el prompt con línea no vacía → `running = true` + `patch({ lastCommand, running: true })`.
- [ ] Estado "en el prompt" del diseño; eco pendiente: si se tipeó después del último `onWriteParsed`,
  la inserción espera el próximo (máx. 300 ms).
- [ ] Pedido a PowerShell: debounce 150 ms, nunca después de Tab/Ctrl+R/F-teclas, medir y degradar.
- [ ] `.suggest-menu` en `FLOATING`; estilos con las variables del tema.
- [ ] `npx tsc --noEmit` y `npx vitest run` pasan. Commit.

### Task 8: configuración

**Archivos:** `src/settings/schema.ts`, `src/settings/SettingsView.tsx`, `src/settings/settings.test.ts`.
**Produce:** `SuggestSettings = { enabled: boolean; mode: "auto" | "manual"; pwsh: boolean }` en
`Settings.terminal.suggest` (por defecto `{ enabled: true, mode: "auto", pwsh: true }`).

- [ ] Test: normalize de un settings viejo sin `suggest` → valores por defecto; valores inválidos → por defecto.
- [ ] Implementar, filas en "Terminal e interfaz", pasar. Commit.

### Task 9: prueba real, informe y build para Bruno

- [ ] `cargo test`, `npx vitest run`, `npx tsc --noEmit`.
- [ ] Build `npx tauri build --no-bundle` con `CARGO_TARGET_DIR=target\prueba`; abrirlo con datos propios y
  CDP; probar en cmd y PowerShell: `cd ` con carpetas, `ping `, ↑ intacto, `Get-Ch` con cmdlets, nada de
  menú dentro de un programa, historial de cmd guardado. Capturas.
- [ ] Acceso directo para que Bruno pruebe esa build con una copia de su configuración e historial.
- [ ] Entrada en `Documentacion/Informe_Proceso_y_Stats.md` (lo no verificado, marcado). Commit.
- [ ] Si Bruno lo aprueba: merge a `main` y `compilar-version.bat --minor` (0.5.0). Si no: volver a `main`
  y borrar la rama (con su permiso).
