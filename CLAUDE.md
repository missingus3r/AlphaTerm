# AlphaTerm (antes NovaTerm) — contexto para Claude Code

Terminal propia estilo Warp, más liviana, orientada a trabajar con agentes de IA.
El plan está en `Plan_Terminal_NovaTerm.txt` (con adendas al final: entorno de casa y AlphaTerm);
la guía de código en `Documentacion\Guia_de_codigo.txt` (y su PDF); el registro de cada fase en
`Documentacion\Informe_Proceso_y_Stats.md`.

## Estado
- F0 a F9 terminadas, más los extras pedidos (API de control para agentes + MCP, Docker, guardián,
  paneles en mosaico, historial, sesión, rutas con vista previa, carpetas y color de pestañas…).
- Renombrada a AlphaTerm: binario `alphaterm.exe`, identificador `uy.alphaterm.app`, datos en
  `%APPDATA%\AlphaTerm` (se copia la de NovaTerm la primera vez). La carpeta del proyecto es
  `Desktop\AlphaTerm` (renombrada el 18/11/2026; antes `Desktop\NovaTerm`).
- Pendiente: decidir si además de la instalación por versión (`compilar-version.bat`) hace falta un
  instalador NSIS; probar Docker con un contenedor real y Claude Code con una tarea real pasando por
  el guardián; metas de RAM (<120 MB) y arranque (<500 ms) no se cumplen (~225 MB y 1,2–1,4 s,
  dominados por WebView2).

## Correr y probar
- Desarrollo: `npx tauri dev`. Release: `npx tauri build --no-bundle` → `src-tauri\target\release\alphaterm.exe`.
- Versión nueva: subir `version` en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`,
  y doble clic en `compilar-version.bat` (o `npm run release`, que es `scripts/release.mjs`): compila
  (en `target\prueba` si `target\release\alphaterm.exe` está abierto) y `scripts/instalar.mjs` copia a
  `%LOCALAPPDATA%\AlphaTerm\versiones\<v>`, deja en el escritorio el acceso directo «AlphaTerm <v>»
  (renombra el anterior) y apunta ahí el anclado en la barra de tareas. Se puede con AlphaTerm
  abierta. `npm run instalar -- --desde <carpeta>` instala un build ya hecho. Los .bat, con CRLF. El footer muestra la versión (tooltip: commit, "+" si había cambios
  sin commitear, fecha y ruta del exe).
- Tests: `cargo test` en `src-tauri` (anteponer `~/.cargo/bin` al PATH), `npx vitest run`, `npx tsc --noEmit`.
- Inspeccionar el WebView: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
  antes de abrir la app y hablarle por CDP (Runtime.evaluate, Input.dispatchMouseEvent). Si ya hay
  una AlphaTerm abierta sin ese flag, el WebView2 no arranca (comparten carpeta de datos).
- API de control: `node %APPDATA%\AlphaTerm\alphaterm-mcp.mjs list` (o `call <método> '<json>'`).
- Medir arranque: `ALPHATERM_BENCH=<archivo>` anota los ms hasta el primer prompt.

## Gotchas
- Paneles de terminal: se iteran por id y se posicionan por rectángulos (anidarlos re-monta las
  terminales y mata la shell). Lo mismo con los paneles laterales del mosaico: iterar ids, no objetos.
- Escrituras a la PTY por `WriteQueue` (si no, se invierten teclas). Nunca atajos con Ctrl+Alt (AltGr).
- Solid: dentro de un `createEffect`, una función que lee y cambia una señal lo vuelve a disparar en
  bucle (pasó en el footer: 180 MB). Usar `untrack` u `on`. Y en `<Show>` con callback, no leer `m()`
  después de cerrar (por eso el menú aplica la acción antes de cerrarse).
- Enter a la shell: `String.fromCharCode(13)`, nunca un salto de línea literal en una plantilla.
- Scripts de parches: escribirlos con Write a un .py; los heredoc de bash se comen `\\` y `\n`.
- El esquema de settings vive en `src/settings/schema.ts`; el backend guarda JSON opaco.
- Ventanas transparentes: el fondo lo pinta el body; xterm con viewport transparente por CSS.
- Codex guarda sesiones como `.jsonl.zst`. agy: nunca desde Git Bash (MSYS convierte `/quota`).
- agy siempre con `AGY_CLI_DISABLE_AUTO_UPDATE=true` (exactamente "true"): si no, cada consulta puede
  lanzar su actualizador fuera de la consola escondida y aparece una ventana de cmd un instante.
- Consumo en vivo (`usage_live.rs`, como el System dashboard): claude `/usage` y codex `/status` se
  leen abriéndolos en una ConPTY sin ventana + `vt100`. No contestar `ESC[6n`: con el modo de entrada
  de ConPTY la respuesta le llega al programa como texto tipeado. Claude va con `--strict-mcp-config`
  y `disableAllHooks`. `ALPHATERM_PROBE_DUMP=<carpeta>` guarda las pantallas leídas.
- Claude: entre consultas en vivo, el consumo sale de la statusline (no se leen credenciales).
- Tests de Rust: el manifiesto de Windows (controles comunes v6) lo incrusta el linker
  (`build.rs` + `windows-app-manifest.xml`), no tauri-build: sin él el binario de test no arranca
  (STATUS_ENTRYPOINT_NOT_FOUND, TaskDialogIndirect).
- Panel de modificaciones (`changes.rs`): hook Pre/PostToolUse de Claude + copia y vigía de la
  carpeta de cada pestaña con un agente. En Solid, las tarjetas se iteran por id (si no, una lista
  nueva re-monta todo y se pierde lo que se está editando).
- Pegar imágenes (`clip.rs`): sin texto en el portapapeles, la imagen se guarda como PNG en
  `%TEMP%\AlphaTerm\pegadas` y se pega su ruta (Claude Code y Codex la adjuntan).
- Probar una versión nueva con otra AlphaTerm abierta: compilar con `CARGO_TARGET_DIR=target\prueba`
  (cargo lo toma relativo a `src-tauri`, así que queda en `src-tauri\target\prueba`; o una ruta
  absoluta) y abrirla con `ALPHATERM_DATA_DIR` y `WEBVIEW2_USER_DATA_FOLDER` propios (no toca la
  sesión ni la configuración de la abierta).
- `alphaterm-mcp.mjs` lee `%APPDATA%\AlphaTerm\control.json` aunque haya `ALPHATERM_DATA_DIR`: para
  hablarle a una AlphaTerm de prueba, pasarle `ALPHATERM_CONTROL_URL` y `ALPHATERM_CONTROL_TOKEN` del
  `control.json` de su carpeta de datos (si no, se le habla a la de Bruno).
- Opciones de arranque de agentes: catálogo en `src/panels/agentLaunch.ts` (relevado de los `--help`;
  revisarlo cuando se actualice un agente). Listas de modelos en vivo: `agent_models` en `agents.rs`.
- computer use: el escritorio a veces queda al frente y bloquea clics; usar CDP para la interfaz.
- Las shells no heredan el entorno de quien abrió AlphaTerm (`src-tauri/src/pty/env.rs`): Claude Code
  le pone NO_COLOR=1 y decenas de CLAUDE_CODE_* (con tokens) a sus herramientas. Se respetan si están
  en el entorno persistente de Windows.
- `build.rs`: rutas con `std::env::var("CARGO_MANIFEST_DIR")`, no `env!()` (queda fija al compilar el
  build script y se rompe al mover la carpeta).

## Decisiones ya tomadas (no re-discutir sin motivo)
- Tauri 2 + Rust; Vite + TypeScript + SolidJS 1.9; xterm.js 6 con WebGL (fallback DOM).
- Nombre de pestaña: manual > título OSC del programa > resumen por modelo (opcional) > heurística.
- Salida de la PTY agrupada por `tauri::ipc::Channel` binario con contrapresión.
- Git por la CLI. Docker por la CLI. Nada de shell en el medio para comandos armados por la app.

## Entorno
- Casa (`C:\Users\Br1`): Rust 1.99.1 fuera del PATH, Node 22, PowerShell 5.1 (sin pwsh), Docker
  Desktop instalado, Ollama sin modelos.
- PC del trabajo: inspección SSL, PowerShell bloquea `.ps1`, sin Rust al armar el plan.

## Forma de trabajo
- Cada fase cierra verificada y registrada en el Informe; lo no verificado se marca como tal.
- Bruno prefiere respuestas en español, directas, en párrafos y con pushback honesto.
