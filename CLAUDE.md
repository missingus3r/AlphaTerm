# AlphaTerm (antes NovaTerm) — contexto para Claude Code

Terminal propia estilo Warp, más liviana, orientada a trabajar con agentes de IA.
El plan está en `Plan_Terminal_NovaTerm.txt` (con adendas al final: entorno de casa y AlphaTerm);
la guía de código en `Documentacion\Guia_de_codigo.txt` (y su PDF); el registro de cada fase en
`Documentacion\Informe_Proceso_y_Stats.md`.

## Estado al 18/11/2026
- F0 a F9 terminadas, más los extras pedidos (API de control para agentes + MCP, Docker, guardián,
  paneles en mosaico, historial, sesión, rutas con vista previa, carpetas y color de pestañas…).
- Renombrada a AlphaTerm: binario `alphaterm.exe`, identificador `uy.alphaterm.app`, datos en
  `%APPDATA%\AlphaTerm` (se copia la de NovaTerm la primera vez). La carpeta del proyecto es
  `Desktop\AlphaTerm` (renombrada el 18/11/2026; antes `Desktop\NovaTerm`).
- Pendiente: decidir empaquetado (exe suelto o instalador NSIS); probar Docker con un contenedor
  real y Claude Code con una tarea real pasando por el guardián; metas de RAM (<120 MB) y arranque
  (<500 ms) no se cumplen (~225 MB y 1,2–1,4 s, dominados por WebView2).

## Correr y probar
- Desarrollo: `npx tauri dev`. Release: `npx tauri build --no-bundle` → `src-tauri\target\release\alphaterm.exe`.
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
- Claude: el consumo exacto sale de la statusline (no se leen credenciales).
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
