# NovaTerm — contexto para Claude Code

Terminal propia estilo Warp, más liviana y rápida, orientada a trabajar con agentes de IA.
El plan completo está en `Plan_Terminal_NovaTerm.txt` (en esta misma carpeta): es la fuente de verdad.

## Estado al 18/11/2026
- Plan aprobado por Bruno ("vamos a implementarlo").
- F0 hecha en la PC de casa: entorno verificado, adenda al plan, PDFs en `Documentacion\` (se regeneran con `python Documentacion\generar_pdfs.py`) e Informe iniciado.
- F1 terminada (17/11/2026): una pestaña ConPTY + xterm WebGL, perfiles, resize, copiar/pegar. Throughput a la par de Windows Terminal.
- F2 terminada (18/11/2026): pestañas, splits, multi-ventana, barra H/V, marquee, shell integration (PowerShell, Git Bash, cmd) y título-resumen.
- F3 terminada (18/11/2026): settings.json en `%APPDATA%\NovaTerm` (vigilado, escritura atómica), ventana de configuración (Ctrl+,), temas + importar, Mica/Acrylic/opacidad/imagen, fuentes y ligaduras, atajos configurables. Próximo paso: F4 (Agentes).
- Gotchas de F3: el esquema vive en `src/settings/schema.ts` (el backend guarda JSON opaco; las claves de fases nuevas se agregan ahí y `normalize` conserva las desconocidas); las ventanas son transparentes y el fondo lo pinta el body (xterm con `allowTransparency` y viewport transparente por CSS); las ligaduras leen la fuente vía `font_file` (reemplazo de `queryLocalFonts`). Para inspeccionar el WebView: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` antes de `npx tauri dev`, y CDP por WebSocket.
- Gotchas de F2: los paneles se iteran por id y se posicionan por rectángulos (anidarlos re-monta las terminales y mata la shell); las escrituras a la PTY van por `WriteQueue` (si no, se invierten teclas); nunca atajos con Ctrl+Alt (AltGr en teclado español); los scripts de `src-tauri\shell\` se editan con Edit, no con heredoc (se comen los `\\`).
- Correr la app: `npx tauri dev`, o `npx tauri build --no-bundle` y abrir `src-tauri\target\release\novaterm.exe`. Tests: `cargo test` en `src-tauri` y `npx vitest run`.
- `src-tauri\conpty\` tiene la ConPTY de Microsoft (sideload); `build.rs` la copia al lado del exe.
- Versiones fijadas: SolidJS 1.9 (no 2.0), xterm.js 6 (fallback DOM, no canvas), reqwest 0.13 con `native-tls`. Ver adenda del plan.

## Decisiones ya tomadas (no re-discutir sin motivo)
- Stack: Tauri 2 + Rust en el backend; Vite + TypeScript + SolidJS en el frontend; xterm.js 6 con el addon WebGL (fallback al renderer DOM).
- Resumen de pestaña híbrido, en este orden: título manual > título OSC 0/2 del agente > heurística > LLM opcional.
- Salida del PTY agrupada (~4 ms / 64 KB) por `tauri::ipc::Channel` binario, sin JSON por chunk, con contrapresión.
- Git vía git CLI (porcelain v2), no libgit2.
- Fallback si cargo/crates.io no funciona: Electron 41.3.0 (cacheado en la PC del trabajo).

## Ojo con el entorno
- El plan se armó en la PC del trabajo (`C:\Users\usuario`): ahí hay inspección SSL (Node necesitó `--use-system-ca`), PowerShell bloquea `.ps1` (usar `.cmd`), `objects.githubusercontent.com` está bloqueado y Rust no estaba instalado.
- Esta carpeta se creó en otra máquina (`C:\Users\Br1`), donde ya existen `.rustup` y `.cargo`. Hay que verificar el entorno real de donde se esté corriendo antes de asumir lo del plan: `rustc -V`, `cargo -V`, `node -v` y la conexión con crates.io.
- En casa (`C:\Users\Br1`): Rust 1.99.1 fuera del PATH (anteponer `~/.cargo/bin`), Node 22, red limpia, sin pwsh (PowerShell 5.1 alcanza). Gemini CLI ahora es Antigravity CLI (`agy`); su cuota sale exacta de `agy -p /quota --output-format json`, pero nunca desde Git Bash (MSYS convierte `/quota` en ruta y agy lo corre como prompt, gastando cuota). fpdf2 está en Python 3.11 (`python`), no en 3.14.

## Forma de trabajo
- Cada fase cierra verificada: compila, arranca, pasa un smoke test y queda registrada en `Documentacion/Informe_Proceso_y_Stats.md`.
- Honestidad: lo que no esté verificado (por ejemplo, la cuota de Gemini o el endpoint de uso de Claude) se marca como tal en la UI y en el Informe.
- Bruno prefiere respuestas en español, directas, en párrafos y con pushback honesto.
