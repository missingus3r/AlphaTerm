# AlphaTerm (antes NovaTerm) — contexto para Claude Code

Terminal propia estilo Warp, más liviana, orientada a trabajar con agentes de IA.
El plan está en `docs/es/Terminal_Plan.txt` (con adendas al final: entorno de casa y AlphaTerm);
la guía de código en `docs\es\Code_Guide.txt` (y su PDF); el registro de cada fase en
`docs\es\Process_Report.md`.

## Estado
- F0 a F9 terminadas, más los extras pedidos (API de control para agentes + MCP, Docker, guardián,
  paneles en mosaico, historial, sesión, rutas con vista previa, carpetas y color de pestañas…).
- Renombrada a AlphaTerm: binario `alphaterm.exe`, identificador `uy.alphaterm.app`, datos en
  `%APPDATA%\AlphaTerm` (se copia la de NovaTerm la primera vez). La carpeta del proyecto es
  `Desktop\AlphaTerm` (renombrada el 18/11/2026; antes `Desktop\NovaTerm`).
- Navegador integrado con marcado (20/11/2026): panel de navegador (hoja con `browser` en el modelo)
  con modo edición para marcar elementos y pedirle cambios al agente de la pestaña. Ver Gotchas.
- Pendiente: decidir si además de la instalación por versión (`build-release.bat`) hace falta un
  instalador NSIS; probar Docker con un contenedor real y Claude Code con una tarea real pasando por
  el guardián; metas de RAM (<120 MB) y arranque (<500 ms) no se cumplen (~225 MB y 1,2–1,4 s,
  dominados por WebView2).

## Correr y probar
- Desarrollo: `npx tauri dev`. Release: `npx tauri build --no-bundle` → `src-tauri\target\release\alphaterm.exe`.
- Versión nueva: doble clic en `build-release.bat` (o `npm run release`, que es `scripts/release.mjs`).
  Sube la versión sola (patch por defecto; `--minor`, `--major`, o `--misma` para recompilar sin subir)
  en `package.json`, `tauri.conf.json`, `Cargo.toml` y `Cargo.lock`, hace el commit «Versión X» y el tag
  anotado `vX`, compila (en `target\prueba` si `target\release\alphaterm.exe` está abierto) e instala con
  `scripts/install.mjs` en `%LOCALAPPDATA%\AlphaTerm\versiones\<v>` (acceso directo «AlphaTerm <v>» en el
  escritorio, renombra el anterior, y el anclado de la barra de tareas). Si falla, deshace el commit y el
  tag. Se puede con AlphaTerm abierta. `npm run install-version -- --desde <carpeta>` instala un build ya hecho.
  Los .bat, con CRLF. El footer muestra la versión (tooltip: commit, "+" si había cambios sin commitear,
  fecha y ruta del exe) y el botón «Novedades» (changelog por versión).
- Changelog: `scripts/changelog.mjs` lo genera desde git (tags `vX.Y.Z`) en `src/generated/changelog.json`
  (ignorado por git); lo corren `npm run dev`, `build` y `typecheck`. Lógica pura en
  `scripts/changelog-lib.mjs` (tests en `scripts/changelog.test.mjs`). Los commits de antes de los tags
  quedan en la versión más vieja (0.1.0 = todo hasta el 18/11/2026).
- Tests: `cargo test` en `src-tauri` (anteponer `~/.cargo/bin` al PATH), `npx vitest run`, `npx tsc --noEmit`.
- Inspeccionar el WebView: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
  antes de abrir la app y hablarle por CDP (Runtime.evaluate, Input.dispatchMouseEvent). Si ya hay
  una AlphaTerm abierta sin ese flag, el WebView2 no arranca (comparten carpeta de datos).
- API de control: `node %APPDATA%\AlphaTerm\alphaterm-mcp.mjs list` (o `call <método> '<json>'`).
- Medir arranque: `ALPHATERM_BENCH=<archivo>` anota los ms hasta el primer prompt.

## Gotchas
- Paneles de terminal: se iteran por id y se posicionan por rectángulos (anidarlos re-monta las
  terminales y mata la shell). Lo mismo con los paneles laterales del mosaico: iterar ids, no objetos.
  Cada uno tiene arriba la barrita de 22 px (`PaneBar`) y la terminal va en `.pane-body`. Mover un
  panel (`movePane`) es solo cambiar el árbol: la hoja es la misma y la terminal no se recrea.
  El arrastre usa la clase `resizing` del body (esconde el navegador y quita el puntero a los
  paneles) más `pane-dragging`; Esc se ataja en captura para que no le llegue a la terminal.
- `window.confirm` NO pregunta: el plugin de diálogos de Tauri lo reemplaza por una función async
  (devuelve una promesa, que siempre es "sí") y falta el permiso `dialog:allow-confirm`. Usar
  `askConfirm` (`src/widgets/confirm.ts`), que pregunta dentro de la app (`ConfirmModal`, montado
  en Workspace y en la ventana de configuración). El test `scripts/no-confirm.test.mjs` falla si
  vuelve a aparecer un `confirm(` suelto en `src`.
- Con `npx tauri dev`/Vite, la recarga en caliente de `Workspace.tsx` deja viva la instancia vieja
  (sigue contestando la API de control y puede pisar la sesión): recargar la página antes de probar.
- Escrituras a la PTY por `WriteQueue` (si no, se invierten teclas). Nunca atajos con Ctrl+Alt (AltGr).
- Solid: dentro de un `createEffect`, una función que lee y cambia una señal lo vuelve a disparar en
  bucle (pasó en el footer: 180 MB). Usar `untrack` u `on`. Y en `<Show>` con callback, no leer `m()`
  después de cerrar (por eso el menú aplica la acción antes de cerrarse).
- Enter a la shell: `String.fromCharCode(13)`, nunca un salto de línea literal en una plantilla.
- Scripts de parches: escribirlos con Write a un .py; los heredoc de bash se comen `\\` y `\n`.
- La configuración se abre dentro de la misma ventana (`settingsOpen` en `src/settings/store.ts`,
  `.settings-overlay` encima de `.workspace`); con ella abierta, los atajos no tocan las pestañas.
  La ventana aparte "settings" (`settings_open`) quedó sin usar.
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

- Navegador integrado (`src-tauri/src/browser.rs`, `src/browser/`): un WebView2 hijo
  (`Window::add_child`, feature `unstable` de tauri) puesto encima del `.bp-view` de su panel; el
  frontend le manda el rectángulo cada 150 ms y lo esconde si algo flotante de la interfaz se le
  superpone (`FLOATING` en `src/browser/marks.ts`: agregar ahí las clases de menús/modales nuevos,
  porque nada de la interfaz puede tapar al WebView2). Se maneja por CDP con
  `CallDevToolsProtocolMethod` (bloquea: nunca desde el hilo principal; `add_child` tampoco).
  La capa de marcado es `scripts/browser-overlay.js` (initialization_script) y le habla al backend
  por `Runtime.addBinding("__alphaterm")`. El pedido se pega en la terminal del dueño con
  `term.paste` (bracketed paste) y el Enter va aparte 350 ms después. "Listo": hook Stop de Claude
  Code (`claude-stop.json` o dentro de `claude-guardian.json` → `agent_stop`); los demás agentes,
  por el silencio de la terminal después de haber trabajado. Con `--remote-debugging-port`, el
  navegador hijo aparece como otro target en `/json` (sirve para probar).

## Idiomas (español, inglés y portugués, desde 0.7.0)
- Interfaz: cada texto visible pasa por `t("texto en español")` (`src/i18n/index.ts`); en constantes
  de módulo se marca con `k("…")` y se traduce con `t(valor)` al mostrarlo. Variables con llaves:
  `t("Cerrar {n} pestañas", { n })`, nunca concatenando. Traducciones en `src/i18n/en/*.json` y
  `src/i18n/pt/*.json` (un archivo por área; clave = el texto en español EXACTO). Cambiar un texto en
  español es cambiar su clave en los dos idiomas: `node scripts/i18n-check.mjs` (y su test) falla si
  falta, sobra o no coinciden las {variables}, o si un texto tiene dos traducciones. Términos y
  estilo: `src/i18n/GLOSSARY.md`. Fechas y números con `locale()`.
- Rust: `tr("…", "…", "…")` y `tr!(…)` de `src-tauri/src/i18n.rs` (es, en, pt). El idioma llega por
  `set_locale` y al arrancar se lee de settings.json. En tests: `tr_in!`/`Lang::pick`, nunca cambiar
  el global (otros tests esperan español).
- Quedan en español a propósito porque se comparan (se traducen solo al mostrarlos): las etiquetas
  de las ventanas de consumo ("5 h", "semana"…), las decisiones del registro del guardián
  ("bloqueado"…) y el perfil "Símbolo del sistema" (`profileLabel`).
- Scripts de agentes (MCP, hook del guardián, capa del navegador): el idioma sale de
  `ALPHATERM_LANG` (lo reciben las pestañas nuevas) o de settings.json.
- Idioma inicial: instalación nueva = el de Windows; settings.json sin la clave `language` = español.
- Novedades: traducción de cada commit en `src/i18n/changelog/en|pt.json` (clave = asunto en
  español). `node scripts/changelog.mjs --faltan` lista lo que falta y `release.mjs` no sube la
  versión si un commit desde el último tag no está traducido.
- Documentación: las versiones en inglés y portugués están en `docs/en|pt`, `CLAUDE.en.md`,
  `CLAUDE.pt.md`, `README.md` (inglés), `README.es.md` y `README.pt.md`. Al cambiar un documento,
  actualizar las tres (y sus PDF: `python docs/generate_pdfs.py es en pt`, necesita fpdf2).
  Las capturas del README (las mismas para los tres) son de la interfaz en inglés, en
  `docs/screenshots/`.

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
- Comentarios del código y nombres de archivos en inglés (el repo es público). Los textos de la interfaz
  se escriben en español: son la clave de `t()` (ver «Idiomas»).
