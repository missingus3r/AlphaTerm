# NovaTerm — Informe de proceso y stats (Playbook)

Registro de cada fase: qué se hizo, cómo se verificó, cuánto tardó y qué quedó pendiente.
Regla de honestidad: lo que no esté verificado con datos reales de la máquina se marca **NO VERIFICADO**.

## Resumen de fases

| Fase | Estado | Fecha | Verificación |
|---|---|---|---|
| F0 — Preparación | Terminada | 17/11/2026 | Toolchain probado, PDFs generados, gate aprobado |
| F1 — Núcleo terminal | Terminada | 17/11/2026 | Probada en la app; throughput a la par de Windows Terminal |
| F2 — Layout | Terminada | 18/11/2026 | Probada en la app: pestañas, splits, multi-ventana, integración y títulos |
| F3 — Settings y temas | Terminada | 18/11/2026 | Probada en la app: temas, Mica/Acrylic, fuentes, ligaduras, atajos, edición a mano del archivo |
| F4 — Agentes | Terminada | 18/11/2026 | Claude Code lanzado desde el panel, estados y detección real |
| F5 — Widgets | Terminada | 18/11/2026 | CPU/RAM y consumo con datos reales (agy exacto, Codex y Claude con su antigüedad) |
| F6 — Servidores/Puertos | Terminada | 18/11/2026 | Servidor en pestaña detectado, receta guardada, detener e iniciar |
| F7 — Proyectos | Terminada | 18/11/2026 | Proyectos de Claude/Codex y árbol con .gitignore |
| F8 — Git | Terminada | 18/11/2026 | Diff, stage y commit desde el panel en un repo de prueba |
| F9 — Pulido | Terminada | 18/11/2026 | Resumen por modelo (servidor de prueba), mediciones, guía de código |
| Extras — AlphaTerm | Terminada | 18/11/2026 | Pedidos durante la implementación: API para agentes, Docker, guardián, mosaico, sesión… |

---

## F0 — Preparación (17/11/2026)

**Máquina:** PC de casa (`C:\Users\Br1`), Windows 11 Pro 10.0.26300. El plan se armó en la PC del
trabajo; las diferencias quedaron en la adenda al final de `docs/es/Terminal_Plan.txt`.

### Hecho
- Plan exportado a txt (en la PC del trabajo, 17/11) y copiado a `NovaTerm\docs/es/Terminal_Plan.txt`.
- Adenda con el entorno de casa y el ajuste de versiones agregada al plan.
- `docs\generate_pdfs.py`: genera `Specification.pdf` (8 págs.) y `Plan.pdf` (3 págs.) desde
  el txt con fpdf2 2.8.7 y Segoe UI / Consolas de Windows. Regenerable: `python docs\generate_pdfs.py`.
- Este Informe iniciado.

### Entorno verificado

| Herramienta | Versión | Nota |
|---|---|---|
| rustc / cargo | 1.99.1 / 1.99.1 | toolchain `stable-x86_64-pc-windows-msvc`, en `~/.cargo/bin` fuera del PATH |
| Node / npm | 22.22.2 / 11.14.1 | |
| Git | 2.56.0 | |
| Python | 3.11.3 (fpdf2 2.8.7) | 3.14.5 también instalado, sin fpdf2 |
| Visual Studio | 2022 y 2019 | linker MSVC: `cargo run` de un hola mundo enlaza y corre |
| WebView2 | 157.0.4341.60 | |

### Red

| Destino | Resultado |
|---|---|
| index.crates.io | 200 en 0,17 s |
| static.crates.io | 200 en 0,23 s |
| registry.npmjs.org | 200 en 0,19 s |

Sin inspección SSL ni proxy en esta red. No hizo falta `~/.cargo/config.toml`.

### Prueba de dependencias Rust
`cargo check` de un crate de prueba con las dependencias del plan: **OK en 1 min 32 s** (en frío).

| Crate | Versión resuelta |
|---|---|
| tauri | 2.12.6 |
| portable-pty | 0.9.0 |
| sysinfo | 0.40.4 |
| tokio | 1.54.1 |
| reqwest | 0.13.5 (`native-tls`, `json`, `system-proxy`) |
| windows | 0.62.2 (`Win32_NetworkManagement_IpHelper`, `Win32_Networking_WinSock`) |
| ignore / notify | 0.4.34 / 8.2.2 |

Tropiezo: reqwest 0.13 ya no tiene el feature `rustls-tls`; se usa `native-tls` (schannel), que además
respeta los certificados del sistema como pedía el plan para la red del trabajo.

### Versiones del frontend (decididas, se instalan en F1)
- SolidJS **1.9.19**, no 2.0: `vite-plugin-solid` 2.11.16 solo declara `solid-js ^1.7.2`.
- xterm.js **6.0.0** con `@xterm/addon-webgl` 0.19; el addon canvas (0.7) solo soporta xterm 5, así
  que el fallback del WebGL es el renderer DOM de xterm.
- Vite 8.3.8, TypeScript 7.0.2, Vitest 5.1.0, Tauri CLI/API 2.12.5.

### Lo que cambia respecto del plan original
- Rust no hubo que instalarlo; el fallback a Electron queda descartado.
- Shells disponibles: Windows PowerShell 5.1 (perfil por defecto), cmd, Git Bash y WSL. pwsh
  (PowerShell 7) no está instalado y no hace falta. La shell integration se escribe compatible con 5.1.
- Agentes instalados: claude, codex, opencode y **agy (Antigravity CLI 1.4.12)**, que reemplazó a
  Gemini CLI.
- Consumo de agy, **verificado**: `agy -p /quota --output-format json` devuelve la fracción restante
  de las ventanas de 5 h y semanal por grupo de modelos, con la hora de reset, sin correr un turno
  (`num_turns: 0`, `total_tokens: 0`). El provider de Gemini deja de ser "estimado".
- Tropiezo: desde Git Bash, `/quota`, `/usage` y `/credits` se convirtieron en rutas de Windows
  (MSYS) y agy los tomó como prompts. Fueron 6 turnos reales (unos 50 mil tokens) que gastaron cuota
  del grupo "Claude and GPT models" (quedó en 86 % de la ventana de 5 h y 93 % de la semanal).
  Lección: ejecutar agy como proceso directo o desde PowerShell/cmd.

### Gate
Aprobado por Bruno el 17/11/2026 ("Sí, arrancá F1").

### Stats
- Duración de F0 en casa: una sesión corta (verificación de entorno + documentos).

---

## F1 — Núcleo terminal (17/11/2026)

### Hecho
- Proyecto Tauri 2.12 + Vite 8 + SolidJS 1.9 + xterm.js 6 en `NovaTerm\` (repo git iniciado, sin commits).
- Backend `src-tauri\src\pty\`:
  - `mod.rs`: sesiones ConPTY (portable-pty 0.9) con tres hilos por sesión (lector, agrupador, vigía).
    El vigía cierra la pseudoconsola cuando termina el proceso, porque sin eso ConPTY no da EOF.
  - `batcher.rs`: agrupado de salida. El primer trozo después de un rato quieto sale enseguida
    (eco de teclas sin demora); en ráfaga se junta 4 ms o 64 KB. Contrapresión con marca alta de
    2 MB y baja de 512 KB: el frontend confirma los bytes cuando xterm terminó de procesarlos.
  - `profiles.rs`: Windows PowerShell, PowerShell 7, cmd, Git Bash y WSL, con detección.
- Salida por `tauri::ipc::Channel` binario (`InvokeResponseBody::Raw`, llega como ArrayBuffer).
- Frontend: xterm con WebGL (fallback DOM), fit, unicode11, links que abren el navegador,
  copiar/pegar como Windows Terminal (Ctrl+C con selección copia y sin selección interrumpe;
  Ctrl+V y Ctrl+Shift+C/V; clic derecho copia o pega), reinicio con Enter al terminar la shell.

### Tests
- Rust: 9 tests (agrupado, contrapresión, perfiles, ConPTY real con cmd y código de salida, kill).
- Vitest: 8 tests (atajos de copiar/pegar y agrupado de acks).

### Prueba en la app (manejada con computer use)
| Prueba | Resultado |
|---|---|
| Prompt de PowerShell 5.1 | OK |
| Color de 24 bits, negrita, subrayado, acentos, ✓ y CJK de ancho doble | OK |
| `ping -t` + Ctrl+C | OK, corta enseguida |
| `git log --graph --color` | OK |
| vim (resaltado, pantalla alternativa, salir sin guardar) | OK |
| Claude Code (TUI, flechas, Esc) y título OSC en la barra | OK |
| Cambio de tamaño (238×54 → 135×37 visto desde PowerShell) | OK |
| ssh (`ssh -T git@github.com` conecta; rechaza por falta de clave en esta PC) | OK como transporte; sesión interactiva no probada |
| Copiar selección con Ctrl+C (verificado leyendo el portapapeles) | OK |
| Pegar (bracketed paste en vim y bash) | OK |
| Git Bash: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=NovaTerm` | OK |
| `exit 3` informa el código 3 y Enter reinicia | OK |
| Cerrar la ventana no deja shells huérfanas | OK |

### Bugs encontrados y corregidos
- Al cambiar de perfil, el aviso de fin de la sesión vieja pisaba la barra de estado de la nueva.
- ConPTY arranca preguntando la posición del cursor (`ESC[6n`) y espera la respuesta: xterm la
  contesta sola, pero el test de Rust tuvo que contestarla a mano.
- vite-plugin-solid pone jsdom como entorno de Vitest por defecto: `vitest.config.ts` fija node.

### Mediciones (release, 17/11/2026)
- Ejecutable: 9,1 MB. Build release: 3 min 41 s.
- Bundle del frontend: 495 KB (132 KB gzip); casi todo es xterm + WebGL.
- RAM en reposo con 1 pestaña: **181 MB de memoria privada** (NovaTerm 6 MB, WebView2 el resto).
  Working set sumado: 376 MB (cuenta varias veces lo compartido). **Meta del plan (< 120 MB): NO SE CUMPLE.**
- Throughput medido sin frontend (bench `bench_conpty`, ConPTY del sistema):
  - `type` de 20 MB: 0,98 MB/s.
  - `seq 1 300000` (MSYS): 0,08 MB/s.
  - En la app, `seq` da unas 10 mil líneas/s: el límite es la ConPTY del sistema, no el IPC ni xterm.
    Con las dos pruebas hay unos 240 lotes/s, como si la ConPTY entregara por cuadros.

### ConPTY de Microsoft (sideload) y comparación con Windows Terminal
- Con permiso de Bruno se bajó `Microsoft.Windows.Console.ConPTY` 1.25.261109001 de NuGet (1,76 MB,
  MIT). Firmas Authenticode de `conpty.dll` y `OpenConsole.exe`: válidas, Microsoft Corporation.
  Quedan en `src-tauri\conpty\`; `build.rs` los copia junto al exe (y a `deps\` para los tests) y
  el instalador los incluye. portable-pty los usa solo con estar al lado del ejecutable
  (verificado: el proceso hijo pasa a ser `OpenConsole.exe` en vez de `conhost.exe`).
- Diagnóstico con `bench_raw` (lectura cruda de ConPTY, sin agrupador ni frontend):

| Productor | ConPTY nueva | ConPTY de Windows |
|---|---|---|
| Python escribe 20 MB de una vez | 5,37 MB/s (1.823 lecturas) | 5,60 MB/s |
| `seq 1 300000` (MSYS, una escritura por línea) | 0,11 MB/s (299 mil lecturas) | 0,11 MB/s |
| `type` 20 MB | 1,27 MB/s (279 mil lecturas) | 1,24 MB/s |

  Conclusión: el techo es el costo de cada escritura que pasa por ConPTY (~70 µs), no NovaTerm (el
  agrupador junta 279 mil lecturas en ~3.700 lotes). En esta PC (Windows 11 build 26300) la ConPTY
  nueva no es más rápida que la del sistema. Se deja igual: es la misma que traen Windows Terminal
  y Warp, y en Windows más viejos (por ejemplo, la PC del trabajo) la del sistema es bastante peor.
- Comparación con el mismo script (`bench.ps1`, cronómetro de PowerShell) en las dos terminales:

| Prueba | Windows Terminal (120×30) | NovaTerm release (135×37) |
|---|---|---|
| `seq 1 300000` | 22,9 s | 22,4 s |
| Python, 20 MB de una vez | 2,73 s | 2,92 s |
| `type` 20 MB | 14,2 s | 13,5 s |

  **Meta "throughput comparable a Windows Terminal": se cumple** (medido con 20 MB; el `type` de
  100 MB queda para el benchmark de F9).

### Pendiente para fases siguientes
- RAM: 181 MB privados contra la meta de 120 MB (casi todo WebView2). Revisar en F9.
- `term.onBinary` (modo de mouse X10 de algunos programas viejos) no se reenvía todavía.
- ssh interactivo no probado (no hay servidor ni clave en esta PC).
- clippy no está instalado en el toolchain de esta PC (`rustup component add clippy`).
- ~~Nada commiteado todavía en el repo git.~~ Commit `b5d6529` (18/11/2026).

### Stats
- Tests: Rust 9 + 2 benchmarks ignorados (`bench_conpty`, `bench_raw`); Vitest 8. Todos en verde.
- Build release: 3 min 41 s; debug: 1 min 9 s.

---

## F2 — Layout (18/11/2026)

### Hecho
- **Modelo** (`src\layout\model.ts`, funciones puras): pestañas con un árbol de paneles (hojas y
  divisiones en dos), agregar/cerrar/ciclar/mover/renombrar pestañas, dividir y cerrar paneles,
  proporciones, rectángulos de cada panel y vecino por dirección para moverse con el teclado.
- **Render sin re-montar**: los paneles se dibujan planos, posicionados por rectángulos, e iterando
  por id (texto). Si se anidaran como componentes, dividir un panel volvería a crear su terminal y
  mataría la shell.
- **Pestañas ocultas**: siguen recibiendo y cargando datos en el buffer, pero sin WebGL (se suelta el
  contexto al ocultarse y se vuelve a cargar al mostrarse). Los navegadores limitan los contextos
  WebGL a ~16, así que con muchas pestañas esto evita perder el render.
- **Barra de pestañas** arriba o a la izquierda (Ctrl+Shift+B; preferencia en localStorage hasta
  F3), arrastrar para reordenar, clic del medio cierra, doble clic o Ctrl+Shift+R renombra (vacío
  vuelve al nombre automático), punto de estado (en espera / ejecutando / falló / terminó) y número
  de paneles. Selector de perfil para las pestañas nuevas.
- **Marquee**: el nombre se desplaza si no entra, se pausa con el mouse encima, respeta
  prefers-reduced-motion (queda con puntos suspensivos) y el tooltip muestra el texto entero más
  carpeta, shell, PID, renderer y último comando.
- **Multi-ventana** (Ctrl+Shift+N o botón): cada ventana tiene sus pestañas y sus sesiones. Cada
  sesión guarda su ventana dueña: al cerrarse una ventana mueren solo sus shells; al recargar la
  vista se matan solo las de esa ventana. Sin pestañas, la ventana se cierra.
- **Atajos** (`src\layout\shortcuts.ts`): Ctrl+Shift+T/N/W, Alt+Shift++ / - / D (dividir), Alt+flechas,
  Ctrl+Tab, Ctrl+1…9, Ctrl+Shift+R/B/O, Ctrl+Shift+↑/↓. **Nunca Ctrl+Alt**: en teclado español es
  AltGr y se usa para escribir @ # [ ].
- **Salida limpia** (`exit` con código 0) cierra el panel, como Windows Terminal; con error queda el
  mensaje y Enter reinicia.
- **Shell integration** (`src-tauri\shell\` + `src-tauri\src\pty\integration.rs`):
  - PowerShell 5.1/7: script por `-EncodedCommand` (no lo frena la política de ejecución). Envuelve
    `prompt` y `PSConsoleHostReadLine`. OSC 133 A/B/C/D;código, 633;E;comando, 7;carpeta. Fuerza
    salida UTF-8. Compatible 5.1 (`[char]27`).
  - Git Bash: `--init-file` que primero carga /etc/profile y ~/.bash_profile (lo que haría
    --login). PS0 con el truco del subíndice aritmético para marcar el inicio del comando.
  - cmd: variable PROMPT con 133;A/B/D (sin código) y 9;9;carpeta. Sin clink.
  - WSL: sin integración (pendiente).
- **Bloques estilo Warp**: marca verde/roja a la izquierda de cada prompt y en la regla lateral según
  el código de salida (con tooltip), saltar al comando anterior/siguiente (Ctrl+Shift+↑/↓) y copiar
  la salida del último comando (Ctrl+Shift+O).
- **Título-resumen** (`src\layout\title.ts`): manual > título OSC del programa (solo mientras corre
  un comando, o si no hay integración y no es un título de shell) > heurística (comando en curso +
  carpeta + rama git). Para cmd se aprovecha el título "cmd.exe - comando" que pone cmd mismo.
  El backend da el proceso en primer plano (descendiente más nuevo de la shell, sin conhost ni
  OpenConsole, con sysinfo; se consulta cada 2 s y se pausa con la ventana minimizada) y la rama
  git (leyendo `.git/HEAD`, con soporte de worktrees).

### Tests
- Rust: 17 (+2 benchmarks). Nuevos: integración real con PowerShell y Git Bash (llegan 133;B,
  633;E, 133;C y 133;D con el código correcto), script codificado, bash con finales LF, proceso en
  primer plano (incluye PID reciclado) y rama git.
- Vitest: 32. Nuevos: modelo de pestañas y paneles (incluye vecinos en una grilla 2x2), atajos
  (incluye que AltGr no dispare nada), título y heurística, parseo de OSC 133/633/7/9, cola de
  escritura.

### Prueba en la app (computer use)
| Prueba | Resultado |
|---|---|
| Nombre por carpeta ("Br1") y título de ventana | OK |
| Repo git: "NovaTerm (main)"; con comando en curso: "ping -n 6 · …" | OK |
| Marcas verde/roja por código de salida | OK |
| Splits (auto, abajo), foco con Alt+flechas, borde del panel activo | OK |
| Pestaña nueva, Ctrl+Tab, la pestaña oculta sigue corriendo y se repinta bien | OK |
| Renombrar con nombre largo: marquee se desplaza | OK |
| Barra a la izquierda | OK |
| Ventana nueva; `exit` cierra panel, pestaña y ventana; las shells de la otra ventana siguen (5 → 4) | OK |
| Claude Code dentro de un panel | OK |
| Título OSC de un programa mientras corre ("✳ Refactor del login…") y vuelta a la carpeta | OK (simulado) |
| Ctrl+Shift+O copia exactamente la salida del último comando (leído del portapapeles) | OK |
| Git Bash con integración en la app (título con comando, marca roja en un `cd` fallido) | OK |
| cmd: carpeta por OSC 9;9 y "ping -n 8 · NovaTerm (main)" mientras corre | OK |
| Arrastrar divisor | OK (después del arreglo) |

### Bugs encontrados y corregidos
- **Teclas invertidas** ("cmd" llegaba como "cdm"): cada tecla iba en un `invoke` independiente y el
  backend podía atenderlos en otro orden. `WriteQueue` manda de a una y junta lo que se tipea
  mientras espera. Es el bug más serio de la fase.
- El Enter que confirma el renombrado también llegaba a la shell (prompt vacío de más).
- El divisor no arrastraba: con los eventos delegados de Solid, `currentTarget` no es el elemento.
- Al escribir los scripts de shell con un heredoc, cada `\\` quedó como `\`: el prompt de
  PowerShell fallaba (mostraba `PS>`). Lo detectó el test de integración real.
- Con `cd X; ping …` el título mostraba el `cd`: ahora se toma el último tramo de la cadena.

### Pendiente / no verificado
- **Título real de Claude Code**: no se probó con una tarea real (para no gastar cuota); el
  mecanismo se probó simulando el título OSC. Al intentarlo, un comando de prueba le llegó a Claude
  Code como mensaje (los Ctrl+C no lo habían cerrado) y consumió un turno (~77 mil tokens, casi todo
  contexto inicial) hasta que se interrumpió con Esc.
- Si el `cd` y el programa van en la misma línea, la carpeta del título es la anterior hasta que
  vuelve el prompt.
- Cuando NovaTerm se lanza desde una sesión de Claude Code, las shells heredan variables
  `CLAUDE_CODE_*` (Claude Code adentro avisa "Transcript saving is off"). Lanzada normalmente no pasa.
- WSL sin integración; cmd sin código de salida ni texto del comando (haría falta clink).
- La preferencia de barra vertical vive en localStorage hasta F3.

### Stats
- Archivos nuevos: 13 (6 de lógica con tests, 4 componentes, 2 scripts de shell, 1 módulo Rust).
- Tests: Rust 17 (+2 ignorados), Vitest 32. Todos en verde.

---

## F3 — Settings y temas (18/11/2026)

### Hecho
- **Persistencia** en `%APPDATA%\NovaTerm\settings.json`. El backend (`settings.rs`) no conoce el
  esquema: guarda el objeto de forma atómica (archivo temporal + rename), avisa a todas las ventanas
  con el evento `settings-changed` (con la ventana de origen, para que no se pise lo que se está
  editando) y vigila el archivo cada 1 s para aplicar ediciones hechas a mano. Si el archivo está
  roto no lo pisa sin antes copiarlo a `settings.json.bak`.
- **Esquema y normalización** en el frontend (`settings/schema.ts`): cualquier archivo (viejo, editado
  a mano o con basura) da una configuración completa; recorta números fuera de rango, descarta
  opciones inválidas y conserva las claves que no conoce (para las fases siguientes).
- **Ventana de configuración** propia (Ctrl+, o el botón ⚙), cargada bajo demanda (21 KB):
  tema y colores, fuente y cursor, fondo, terminal e interfaz, atajos y "próximas fases".
- **Temas**: 11 de fábrica (Nova oscuro/claro, Campbell, One Half Dark/Light, Solarized Dark/Light,
  Dracula, Tokyo Night, Gruvbox Dark, Nord), modo oscuro / claro / según Windows con un tema para
  cada modo, duplicar y editar los 21 colores, borrar, e **importar** esquemas de Windows Terminal
  (o su settings.json entero, con comentarios), `.itermcolors` de iTerm2 y temas de xterm.js.
  La barra de pestañas y la de título toman los colores del tema.
- **Fondo**: Mica, Mica alternativo, Acrylic y desenfoque (API de efectos de Tauri 2, sin crate
  extra), opacidad, e imagen con opacidad y ajuste. La imagen se copia a `%APPDATA%\NovaTerm\fondos`
  y el backend solo lee de esa carpeta. Las ventanas pasaron a ser transparentes.
- **Fuentes**: lista de monoespaciadas instaladas (registro de Windows + medición en canvas; se
  excluyen las de símbolos), o un nombre a mano; tamaño, interlineado, espaciado, grosor, cursor
  (bloque/barra/subrayado) y parpadeo. **Ligaduras** con `@xterm/addon-ligatures` 0.10: el addon
  pide la fuente con la API de fuentes locales (que en el WebView pediría permiso); la reemplazamos
  por una que lee el archivo desde el backend. Se carga solo al activarlas (191 KB aparte).
- **Atajos configurables**: 18 comandos con sus combinaciones (se agregan grabándolas, se quitan,
  vuelven "de fábrica"), conflictos marcados en rojo, Ctrl+Alt rechazado (AltGr), aviso para
  Ctrl+letra sin Shift. Ctrl+1…9 quedan fijos. Atajo nuevo: Ctrl+, abre la configuración.
- **Terminal e interfaz**: posición de la barra, shell por defecto, líneas de historial y cada
  cuánto se detecta el programa en uso.
- La preferencia de barra vertical de F2 (localStorage) se migra sola al archivo la primera vez.

### Tests
- Rust: 24 (+2 benchmarks). Nuevos: guardar y releer, archivo inexistente, archivo roto (aviso con
  línea y copia .bak antes de pisarlo), BOM, nombres de imagen seguros y decodificación, parseo de
  nombres de fuente del registro y lectura real del registro (Consolas → consola.ttf).
- Vitest: 51. Nuevos: normalización (basura, rangos, claves desconocidas, temas propios), temas de
  fábrica válidos, claro/oscuro, paleta con opacidad, importación (Windows Terminal, su settings.json
  con comentarios, formato propio, iTerm2, errores), ids de temas, atajos configurables (combinación
  desde el evento, forma canónica, rechazos, reemplazo, conflictos, ayuda).

### Prueba en la app (computer use + depuración remota del WebView2)
| Prueba | Resultado |
|---|---|
| Cambiar de tema en la ventana de configuración: se aplica al instante en la terminal y en la barra | OK |
| Ctrl+, abre (o trae al frente) la configuración | OK |
| Opacidad 75 % sin efecto: se ve el escritorio | OK (después del arreglo) |
| Mica (tinte del fondo de pantalla) y Acrylic (desenfocado) | OK |
| Cascadia Code con ligaduras en la vista previa y en la terminal (WebGL), sin pedido de permiso | OK |
| Grabar Ctrl+Shift+Y para "Pestaña nueva" y usarlo; Ctrl+Alt+T rechazado con explicación | OK |
| Editar settings.json a mano (tamaño 18, modo claro): se aplica solo, barra de título clara | OK |
| Archivo roto: aviso con línea y columna; las terminales siguen con lo último que andaba | OK |
| Modo "según Windows" con Windows en oscuro → tema oscuro | OK |
| Ctrl+Shift+B cambia la barra en todas las ventanas; ventana nueva con la configuración actual | OK |
| Imagen de fondo (copia en `fondos`, nombre con ñ) visible detrás del texto | OK (imagen inyectada en el selector) |
| Importar un esquema de Windows Terminal y editar su fondo: cambia en las dos ventanas | OK (archivo inyectado en el selector) |
| La terminal sigue en WebGL con transparencia y ligaduras | OK |
| Release: la barra vertical guardada en F2 pasó sola a settings.json | OK |

### Bugs encontrados y corregidos
- **Fondo negro con transparencia**: xterm pinta su viewport opaco aunque el tema sea transparente;
  se vio leyendo los estilos con la depuración remota del WebView2. Se fuerza transparente por CSS
  (el color lo pone el body).
- Wingdings 2 aparecía como monoespaciada (pasa la prueba de ancho): se excluyen las de símbolos.
- El aviso de archivo roto decía "se usan los valores por defecto" también cuando la app sigue con
  la última configuración válida: ahora el mensaje depende del caso.
- El addon de ligaduras sumaba 190 KB al arranque: pasó a cargarse solo al activarlas.

### Pendiente / no verificado
- **El selector de archivos nativo** no se pudo manejar con computer use (la captura lo tapa): la
  imagen y el tema se probaron inyectando el archivo en el mismo `<input>`, que corre el mismo
  código. Al intentarlo, la ruta se escribió en la terminal y PowerShell abrió la imagen en Fotos.
- **Cambio en vivo de Windows claro ↔ oscuro** con el modo automático: no se probó cambiando el tema
  del sistema (es una configuración de Windows); sí se verificó que toma el modo actual.
- **RAM**: 195 MB privados con una pestaña (release, medido con un script que suma NovaTerm y sus
  procesos de WebView2). En F1 se midieron 181 MB; parte puede ser la ventana transparente y parte el
  método. La meta de 120 MB sigue sin cumplirse: queda para F9.
- Las opciones de agentes, consumo, CPU/RAM y resumen por LLM llegan con F4, F5 y F9 (la sección
  "Próximas fases" lo dice).

### Stats
- Archivos nuevos: 10 (2 módulos Rust, 5 de lógica/estado, 1 componente, 1 hoja de estilos, 1 de tests).
- Bundle principal: 557 KB (533 KB en F2); configuración 21 KB y ligaduras 191 KB aparte, bajo demanda.
- Tests: Rust 24 (+2 ignorados), Vitest 51. Todos en verde.

---

## F4 a F9 y extras (18/11/2026)

Bruno pidió seguir de corrido hasta el final y probar todo al terminar; en el medio agregó funciones
(ver la adenda del plan) y el cambio de nombre a **AlphaTerm**. Cada fase quedó en su commit.

### F4 — Agentes
- Catálogo editable (Claude Code, Codex, Antigravity, OpenCode y propios) con comando, variables y
  ocultar. Detección sin ejecutar nada: PATH del proceso + del registro + carpetas habituales
  (encontró los cuatro: `.local\bin\claude.exe`, `npm\codex.cmd`, `agy\bin\agy.exe`, `npm\opencode.cmd`).
- Lanzar abre una pestaña con la shell por defecto y escribe el comando al primer prompt (el agente
  corre dentro de la shell). Estados: arrancando, trabajando (hay salida), esperando input
  (silencio), te necesita (campana), terminó (con código). También en el punto de la pestaña.
- Bug encontrado: el Enter se escribía como un salto de línea literal (en una plantilla JS se vuelve
  `\n` y PowerShell lo toma como línea incompleta). Bug de F1 que apareció acá: si el panel se
  ajustaba mientras arrancaba la sesión, el tamaño nuevo se perdía y los TUI se dibujaban corridos.

### F5 — Widgets
- CPU y RAM con sparkline de 60 s; clic: top de procesos y consumo de cada pestaña (árbol de la shell).
- Consumo: **agy** exacto por `/quota` (0 tokens, ejecutado sin shell); **Codex** del último
  `rate_limits` de sus sesiones, que ahora vienen comprimidas (`.jsonl.zst`, se leen con ruzstd);
  **Claude** de la statusline de Claude Code (no se leen credenciales: decisión que ya estaba en el
  Claude Control Panel). Sin statusline, estimación en tokens. Cada dato dice fuente y antigüedad.
- Hallazgo: la statusline de Claude Code apunta a `Desktop\claude-control-panel\statusline.js`, que ya
  no existe; la configuración lo avisa y ofrece instalar la de AlphaTerm (con copia del archivo).
  No se tocó: cambia la configuración de Claude Code y es decisión de Bruno.

### F6 — Servidores y puertos
- Puertos en escucha por GetExtendedTcpTable (IPv4 e IPv6), con proceso, comando, carpeta y uptime;
  marca los que nacieron en una pestaña. Detener con taskkill /T (más confirmación si no es de
  AlphaTerm; nunca PID ≤ 4). Recetas automáticas (comando por OSC 633 + carpeta + puertos) o a mano.

### F7 — Proyectos
- Desde los transcripts de Claude Code (`cwd`) y las sesiones de Codex (`session_meta`), más los
  agregados a mano y las carpetas recientes. Árbol perezoso con `.gitignore` (crate ignore) y vigilante
  de las carpetas abiertas (notify).

### F8 — Git
- CLI de git sin consola ni prompts: status porcelain v2, diff unificado o lado a lado, stage por
  archivo o todos, commit (Ctrl+Enter), historial con grafo, ramas, fetch/pull --ff-only/push (con -u
  si falta upstream), clone e init. Contador de cambios en cada pestaña.

### F9 — Pulido
- Resumen de pestaña con un modelo (endpoint compatible con OpenAI; apagado por defecto). Orden del
  nombre: manual > título del programa > modelo > heurística.
- Guía de código (`docs\es\Code_Guide.txt` y `Code_Guide.pdf`), adenda en el plan.

### Extras pedidos
Historial de comandos global, ubicación actual en el footer, consumo del agente activo resaltado,
restaurar la sesión, rutas clicables con vista previa, carpetas y color de pestañas, título de
ventana, **API de control** (HTTP local + token, servidor MCP y CLI `alphaterm-mcp.mjs`), **Docker**,
**guardián** y paneles laterales en **mosaico** (varios a la vez, redimensionables y reordenables).

### Tests
- Rust: 55 (+3 ignorados). Nuevos: detección de agentes, sysmon, consumo (fechas, Codex, agy,
  statusline), puertos (tabla real), proyectos (árbol con .gitignore), git (ciclo real en un repo
  temporal), historial, sesión, Docker (argumentos sin shell), guardián (clasificador y hook),
  migración de la carpeta, resumen por modelo.
- Vitest: 96. Nuevos: estado de agentes, formatos, recetas, proyectos, diff, rutas, sesión, carpetas
  de pestañas, consumo, mosaico.

### Prueba en la app (release, CDP + computer use)
| Prueba | Resultado |
|---|---|
| Lanzar Claude Code desde el panel (con `--mcp-config` y `--settings`), estado "esperando input" y "terminó (código 1)" | OK |
| API: ping, list, open_tab, split, open_window (sub ventana), run con espera (salida exacta y código 7), read, send, close; token inválido → 401 | OK |
| MCP por stdio como cliente: initialize, tools/list (14), tools/call, error en panel inexistente | OK |
| Guardián por la API (Remove-Item): diálogo en las dos ventanas, Bloquear → la API recibe el bloqueo | OK |
| Hook de Claude Code (simulado con el JSON que manda Claude): Edit con diff → permitir; rm -rf → deny | OK |
| Docker: motor apagado detectado, "Abrir Docker Desktop" lo arranca, versión 29.7.2 en el panel y la API | OK (sin contenedores: ver pendientes) |
| Servidor Python en una pestaña: marcado de AlphaTerm, receta guardada, detener y volver a iniciar (HTTP 200) | OK |
| Git: diff numerado, stage de un archivo, commit solo de ese archivo | OK |
| Historial con comandos de las dos ventanas y códigos | OK |
| Proyectos y árbol sin node_modules/dist/target | OK |
| Color y carpeta de pestaña, plegar, título de ventana | OK (después de arreglar el menú) |
| Restaurar la sesión al reabrir: título, 5 pestañas, división, carpetas, panel | OK |
| Rutas en la salida: vista previa de imagen (3840 px) y de carpeta | OK |
| Resumen por modelo contra un servidor de prueba: 3 pedidos por vuelta, nombre limpio | OK |
| Mosaico: 3 paneles a la vez, mover arriba de otro y a columna nueva, ancho y alto, guardado | OK |
| Saltos al principio/final con 300 líneas | OK |
| Footer: agy 7 % semanal (coincide con /quota), Codex y Claude marcados como viejos | OK |
| Configuración: las 8 secciones se dibujan; detecta la statusline rota | OK |

### Bugs encontrados en la prueba final y corregidos
- **Footer en bucle**: `load()` leía una señal dentro de su efecto → 60 layouts por segundo, nodos
  creciendo y el renderer en 180 MB (RAM total 373 MB). Con `untrack` el renderer baja a ~45 MB.
- La API leía las últimas filas de la pantalla (vacías) en vez de hasta el cursor.
- La integración se marcaba recién con el primer comando: `run` no podía esperar en una pestaña nueva.
- El menú de pestaña se cerraba antes de aplicar la acción (Solid no deja leer su valor ya cerrado).
- Línea clara a la derecha de la terminal: el borde del "overview ruler" de xterm.

### Mediciones (release, 18/11/2026)
| Medición | Resultado | Meta del plan |
|---|---|---|
| Arranque hasta el primer prompt | 1,2–1,4 s (PowerShell 5.1 solo tarda ~0,18 s) | < 500 ms — **no** |
| RAM privada con 1 pestaña (AlphaTerm + WebView2) | ~225 MB (renderer 45, GPU 108) | < 120 MB — **no** |
| Throughput | a la par de Windows Terminal (F1: el límite es ConPTY) | comparable — sí |
| Latencia de tecla | no medida | < 10 ms — sin dato |

La RAM y el arranque los domina WebView2 (el proceso de GPU crece con la ventana transparente y WebGL).
Bajar de ahí pediría otro motor de interfaz: no se hizo.

### Pendiente / no verificado
- **Docker con un contenedor real**: no hay imágenes en la máquina y bajar una es una descarga
  (se pregunta antes).
- **Claude Code con una tarea real** pasando por el hook: se probó el script con el mismo JSON que
  manda Claude y que Claude acepta los dos flags; no se aceptó el "confiar en la carpeta" (cambia su
  configuración) ni se le dio una tarea (gasta cuota).
- Codex y agy lanzados desde el panel; el modo de aprobación de Codex con `-s read-only -a on-request`.
- Resumen con un modelo de verdad (en Ollama no hay modelos; bajar uno es una descarga).
- Los selectores de carpeta nativos (no se pueden manejar con computer use).
- La sesión no guarda tamaño ni posición de las ventanas.
- Empaquetado (exe suelto o instalador NSIS): decisión de Bruno.
- ~~La carpeta del proyecto sigue siendo `Desktop\NovaTerm`~~: renombrada a `Desktop\AlphaTerm` el
  18/11/2026 (con la sesión de Claude Code fuera de la carpeta y la app cerrada).

### Stats
- Commits: F3 `8b4a54b`, F4 `9ce06bc`, F5 `3b94920`, F6 `b617faf`, F7 `38c09ad`, F8 `de356a4`,
  renombre `85f31a8`, extras y F9 hasta `cef9654`.
- Tests: Rust 55 (+3 ignorados), Vitest 96. Todos en verde.
- Binario release: alphaterm.exe 14,9 MB (+ conpty.dll y OpenConsole.exe).

---

## Después de la entrega (18/11/2026)

- **Claude Code sin colores dentro de AlphaTerm** (lo vio Bruno): AlphaTerm se había abierto desde
  esta sesión de Claude Code y las shells heredaban su entorno: `NO_COLOR=1` (apaga los colores) y
  ~30 variables `CLAUDE_CODE_*`, incluidos tokens y la marca de sesión hija (de ahí el aviso
  "Transcript saving is off"). Ahora las shells se crean sin esas variables, salvo que estén en el
  entorno persistente de Windows. Verificado: abriendo AlphaTerm desde la misma sesión, la shell
  queda sin NO_COLOR ni CLAUDE_*, y Claude Code se ve con colores.
- `build.rs` dejó de copiar la ConPTY después de renombrar la carpeta (la ruta quedaba fija en el build
  script compilado): ahora la lee al correr.
- Tests: Rust 56 (+3 ignorados), Vitest 96.

---

## Consumo en vivo, modificaciones de archivos y ajustes (20/11/2026)

Pedidos de Bruno, en orden:

1. **Ventana de cmd que aparecía y se iba cada tantos minutos.** Causa: `agy -p /quota` (la consulta
   de cuota del footer, cada 10 min) lanzaba el actualizador de agy ("Spawned background update
   process", en su log) fuera de la consola escondida. El System dashboard ya lo evitaba con
   `AGY_CLI_DISABLE_AUTO_UPDATE=true` (agy solo acepta "true"); AlphaTerm hace lo mismo. Verificado
   con un vigía de procesos y ventanas sobre la AlphaTerm nueva: 0 ventanas de consola en 3 minutos
   con una ronda completa de consultas (Claude, Codex y agy).
2. **Consumo como el System dashboard, sin tener que usar el agente.** `usage_live.rs`: al abrir
   AlphaTerm y cada N minutos (Configuración, 15 por defecto) se abre `claude` y `codex` en una ConPTY
   sin ventana, se escribe `/usage` o `/status` y se lee la pantalla con `vt100`; agy sigue con su
   `/quota` en JSON. Gana el dato más nuevo entre la consulta y los archivos (statusline, sesiones de
   Codex). Claude va con `--strict-mcp-config` y `disableAllHooks` (no levanta servidores MCP ni hooks).
   Tropiezo: contestar `ESC[6n` (dónde está el cursor) hacía que Codex recibiera la respuesta como
   texto tipeado; sin contestar anda, como en el dashboard. Tiempos medidos: Claude 9 s, Codex 16 s,
   agy 5 s. No quedan procesos colgados.
3. **Panel de modificaciones** (Ctrl+Shift+M, `changes.rs` + `ChangesPanel.tsx`): lo que cambian los
   agentes en archivos de texto, código y PDF (por su texto), con o sin git (etiqueta "en git"),
   lado a lado o unificado, abrir uno o todos, colapsar todos. Fuentes: hook Pre/PostToolUse de
   Claude Code lanzado desde AlphaTerm (exacto) y, para cualquier agente, la carpeta de su pestaña
   (copia al arrancar + vigía). Lo que no entró en la copia se compara con el último commit o se
   muestra entero. Se guarda 7 días en `changes.json`.
4. **Editar y guardar desde ese panel**: respeta codificación (UTF-8 con o sin BOM, UTF-16, ANSI) y
   fin de línea, y no guarda si el archivo cambió desde que se abrió.
5. **RAM en porcentaje** (botón, detalle, y por pestaña y proceso).
6. **Consumo detallado en el panel de agentes**: debajo de cada agente, plan, modelo, cada ventana
   con su reinicio (cuenta regresiva y hora), por modelo (Claude: semana por modelo y "qué más
   consume"; agy: grupos con sus modelos), uso extra y previsión semanal al ritmo de ahora.
7. **Barra de pestañas vertical plegable** (queda el estado y la inicial de cada pestaña).
8. **CPU y RAM en la barra vertical**: la gráfica va abajo de cada número; con la barra plegada
   quedan solo los números (antes el widget se escondía al plegar).
9. **Versión en el footer** (`v0.2.0`; tooltip con commit, fecha de compilación y ruta del exe) y en
   Configuración → Acerca. La versión pasa a 0.2.0.
10. **Instalar por versión y actualizar el acceso directo**: `npm run release` compila y corre
    `scripts/install.mjs`, que copia a `%LOCALAPPDATA%\AlphaTerm\versiones\<versión>` y apunta ahí el
    acceso directo del escritorio y el anclado en la barra de tareas. Antes apuntaban a
    `target\release\alphaterm.exe`, que no se puede pisar mientras AlphaTerm está abierta.
11. **`build-release.bat`** en la carpeta del proyecto (doble clic): compila (en `target\prueba`
    si `target\release\alphaterm.exe` está abierto) e instala, dejando en el escritorio el acceso
    directo «AlphaTerm <versión>» (renombra el anterior). Con CRLF.
12. **Pegar imágenes**: Ctrl+V (o clic derecho) con una imagen en el portapapeles y sin texto la
    guarda como PNG en `%TEMP%\AlphaTerm\pegadas` y pega su ruta; Claude Code y Codex la adjuntan.

Otros: los binarios de test de Rust no arrancaban (STATUS_ENTRYPOINT_NOT_FOUND: TaskDialogIndirect
necesita los controles comunes v6); el manifiesto ahora lo incrusta el linker para todos los binarios.
`ALPHATERM_DATA_DIR` permite abrir una versión nueva al lado de la que está en uso.

### Prueba en la app (release aparte, CDP)
- Footer con datos en vivo al abrir (Claude 5 h y semana, Codex semana, agy). Panel de agentes con
  el detalle de los tres. Sin ventanas de consola.
- Hook: el script real (`guardian-hook.mjs`) con la entrada de Claude Code: Edit de un `.md` (+2 −1),
  Write de un archivo nuevo ("nuevo") y de un PDF (−"Total: 100", +"Total: 250"). Abrir todos, diff.
- Edición: Ctrl+S guarda en disco ("editado a mano"); si el archivo cambia mientras se edita, no
  guarda y lo explica.
- Bug encontrado en la prueba: no se vigilaban carpetas dentro de AppData (excluía todo AppData, y el
  proyecto de prueba estaba en Temp). Ahora se excluyen solo las raíces (usuario, AppData, Temp).
- Vigía de carpetas, ya corregido: con Codex abierto en el proyecto, `plan.txt` nuevo (+3) y
  `compras.txt` (+2 −1) quedan a nombre de Codex; `node_modules` y un temporal se ignoran; borrar
  `plan.txt` se registra.
- CPU/RAM: en la barra vertical, la gráfica abajo del número; plegada, solo los números.
- `build-release.bat` de punta a punta: compiló en `target\prueba` (la vieja estaba abierta),
  instaló 0.2.0, renombró el acceso directo a «AlphaTerm 0.2.0» y actualizó el anclado. La versión
  instalada muestra «v0.2.0+» en el footer.

### Pendiente / no verificado
- Pegar una imagen con una captura real (no se tocó el portapapeles de Bruno; el guardado del PNG
  tiene test).
- El hook con una sesión real de Claude Code editando (se probó con el script real y la misma entrada).

### Stats
- Tests: Rust 72 (+6 ignorados: consultas reales a Claude, Codex y agy), Vitest 104. Todos en verde.
- Binario release: alphaterm.exe 17,4 MB (+ conpty.dll y OpenConsole.exe). Versión 0.2.0.


## Barra vertical ajustable y opciones de arranque de los agentes (20/11/2026, tarde)

1. **Botón de plegar la barra vertical**: el `«`/`»` pasa a ser un ícono de barra lateral dibujado
   (marco redondeado con una rayita a la izquierda, el mismo en los dos estados).
2. **Ancho de la barra vertical**: se arrastra su borde derecho (160 a 480 px, y deja al menos 360 px
   a las terminales). Se guarda al soltar en `tabBar.width`; doble clic vuelve a 220 px. Plegada
   sigue en 48 px y al desplegar recupera el ancho elegido.
3. **Opciones de arranque de los agentes** (en lugar del botón de editar del panel de agentes): un
   botón con deslizadores abre, pegado a la fila del agente, modelo (lista que se filtra escribiendo),
   esfuerzo (deslizador; la primera posición es "por defecto"), permisos y modos, casillas de sesión
   (continuar, retomar, worktree, primer mensaje) y "Más opciones" (carpetas extra, system prompt,
   herramientas, Chrome, debug, etc.), con la línea de comando que va a correr. Lo de antes (nombre,
   comando, variables, ocultar, borrar) quedó en "Avanzado".
   - Catálogo en `src/panels/agentLaunch.ts`, relevado del `--help` de las versiones instaladas
     (Claude Code 2.1.329, Codex 0.170.0, agy 1.5.13, OpenCode 1.19.1) y de la documentación oficial.
     OpenCode 2.x cambió los flags de su interfaz (sin --model ni --agent): el catálogo es el de la 1.x.
   - Modelos en vivo: comando `agent_models` (Rust). Codex desde `~/.codex/models_cache.json` (con
     los niveles de razonamiento de cada modelo: el deslizador cambia según el modelo), agy con
     `agy models` y OpenCode con `opencode models`, sin ventana y una vez por sesión (↻ para releer).
     Claude no tiene lista: va fija (alias y nombres completos).
   - Opciones que chocan (ej. Codex `--approve-for-me` con `--sandbox`, Claude
     `--dangerously-skip-permissions` con `--permission-mode`): la que queda afuera se ve gris, con
     "No se usa junto con …", y no se manda. Las peligrosas, en rojo.
   - Comillas según la shell del perfil (PowerShell 5.1, pwsh, cmd, bash). En PowerShell 5.1 las
     comillas dobles internas van como `\"` (si no, se pierden al pasarle el argumento al .exe).
   - El primer mensaje va primero (antes de flags como `--add-dir`, que se comen lo que sigue). En
     Codex, retomar es el subcomando `resume`, que va antes de todo.
   - Se guardan por agente en `agents[].launch` y valen para cada "Lanzar" (panel, Proyectos y al
     reabrir la sesión; al reabrir no se repiten las de sesión, porque ya se retoma).
   - Codex: si las opciones ya dicen cómo aprobar, AlphaTerm no le suma `-s read-only -a on-request`.
4. **Bug encontrado y corregido**: el panel de agentes iteraba objetos y cada cambio de la
   configuración rearmaba la fila (se perdía el foco y lo abierto). Ahora itera ids.

### Prueba en la app (release aparte con datos propios, CDP + API de control de la de prueba)
- Ícono igual al pedido; arrastre a 331 px guardado, límites 160 y 480, doble clic a 220, plegar y
  desplegar.
- Claude: opus + high + plan → la línea, el resumen bajo el nombre y lo guardado coinciden; lanzado,
  muestra "Opus 5.5 with high effort" y "plan mode on". Saltar permisos deja gris lo que choca.
- Codex: 10 modelos de la caché; con gpt-6-luna el deslizador pierde "ultra". Lanzado con
  `-c model_reasoning_effort=xhigh --approve-for-me --search`: arranca sin error y sin el `-s` del
  guardián.
- agy: 23 modelos (2 s). Lanzado con `--model gemini-4-neon --effort xhigh --mode auto --sandbox
  --settings '{\"toolPermission\":\"proceed-in-sandbox\"}'` en PowerShell 5.1: muestra "Gemini 4 Neon
  (XHigh)" y "Auto mode".
- OpenCode: 121 modelos (2 s). No se lanzó.

### Pendiente / no verificado
- OpenCode lanzado con opciones; el primer mensaje (no se mandó para no gastar); comillas en cmd y
  Git Bash (tienen test, no prueba en la app).

### Stats
- Tests: Rust 74 (+6 ignorados), Vitest 111. Todos en verde.

## Navegador integrado con marcado de elementos (20/11/2026)

Pedido: una vista de navegador dentro de AlphaTerm donde el agente vea la app que levantó,
interactúe, saque capturas, y donde el usuario marque elementos (como la primera versión de Claude
Design) para pedirle cambios en tiempo real. Decisiones de Bruno: el pedido va al agente que ya
trabaja en el proyecto, en su pestaña, como si se tipeara (opción 1); el navegador es un WebView2
hijo dentro de la ventana (opción A, frente a ventana pegada o Chrome transmitido como video); es
un tipo de panel nuevo; Claude Code con aviso exacto de "listo", el resto por silencio.

### Qué se hizo
- `src-tauri/src/browser.rs`: WebView2 hijo (`Window::add_child`, feature `unstable`) sobre el
  rectángulo del panel; CDP por `CallDevToolsProtocolMethod` (capturas de vista, página entera y
  recortes; clic, texto, teclas, scroll, eval); eventos `Runtime.bindingCalled` (marcas),
  `consoleAPICalled` y `exceptionThrown` (consola de la página); ventanas nuevas se abren en el mismo
  panel; el pedido arma `pedido.md`, `marcas.json` y las capturas en `%TEMP%\AlphaTerm\navegador`.
- `scripts/browser-overlay.js`: modo edición (resaltado al pasar el mouse con etiqueta y componente,
  clic marca con número sin disparar la página, Alt+clic el padre, Esc sale), datos de cada marca
  (selector único, HTML, estilos calculados, posición, componente y archivo fuente de React —
  `_debugSource` o la pila de React 19 —, Vue 2/3, Svelte y Angular), detección de recarga en caliente,
  y la estructura de la página como texto para el agente.
- Frontend: hoja `browser` en el modelo (se guarda en la sesión), `src/browser/BrowserView.tsx`
  (barra con URL, Editar, Todo el sitio, errores de consola; marcas como chips; pedido con a qué
  terminal va; "Armando… / Trabajando… / Te necesita / Listo ✓"), se esconde si un menú o modal se
  le superpone o al cambiar de pestaña. Se abre con Ctrl+Shift+U, desde Servidores («Abrir en el
  navegador», al lado de la pestaña donde nació) o por la API.
- API/MCP: `browser_open/list/navigate/reload/screenshot/snapshot/click/type/key/scroll/eval/
  console/marks`; la captura vuelve como imagen por MCP. Hook Stop de Claude Code (`agent_stop`), en
  `claude-guardian.json` y en `claude-stop.json` (si no está el guardián).
- Arreglo de paso: con un WebView hijo, Tauri ya no cuenta la ventana en `webview_windows()`; la API
  de control, el guardián y el cierre de ventanas pasaron a `app.windows()`.

### Prueba en la app (release aparte con datos propios, CDP en 9339)
Sitio de prueba con recarga automática y un "agente" falso (lee el pegado, muestra un spinner 4 s y
cambia el color del botón en el HTML):
- Abierto por la API como lo haría un agente: panel al lado de su terminal, capa inyectada, función
  `__alphaterm` viva, recarga en caliente detectada.
- Modo edición: el clic marca y no dispara el `onclick` de la página; dos marcas con componente
  `SubmitButton` y archivo `src/components/SubmitButton.tsx:12` (fibra simulada); chips en la UI.
- Pedido: el agente recibió el texto con las rutas; "Trabajando…" a los 0,5 s, "Listo ✓" a los 7,8 s,
  el botón quedó azul (la página se recargó sola) y las marcas se limpiaron. Capturas correctas
  (vista con números y recorte del botón).
- Herramientas de agente: snapshot con selectores, clic real ("clic 1"), texto con ñ y tilde,
  Ctrl+A, scroll, eval, captura entera y de un elemento, error de consola, selector inexistente con
  error claro; por MCP la captura llega como imagen.
- Hook Stop simulado (mismo JSON que manda Claude Code): pasa a "Listo" mientras el agente sigue.
- Pedido global: incluye la captura de la página entera.
- Se esconde con Novedades abierto y en otra pestaña; vuelve al cerrar o volver.
- Cerrar y reabrir: el panel vuelve con su URL y su dueño.

### Pendiente / no verificado
- Claude Code de verdad recibiendo un pedido (no se gastó una tarea real): se probó el hook con su
  JSON y el pegado con un programa que pide bracketed paste.
- React/Vue reales (la detección se probó con una fibra simulada); páginas con iframes (la capa
  solo marca el documento principal).
- Arrastrar un divisor sobre el navegador: mientras se arrastra, el navegador se esconde.

### Stats
- Tests: Rust 77 (+6 ignorados), Vitest 122. Todos en verde.

## Predicciones de comandos (21/11/2026, rama `predicciones`)

Pedido de Bruno: "un sistema predictivo de comandos en la shell, manteniendo el historial si apreto
hacia arriba y que me aparezca un menú de posibles carpetas desde donde estoy parado si pongo cd"
(y con `ping`, las IPs más comunes; "así con todos los comandos"). Diseño y plan en
`docs/es/specs/2026-11-21-predicciones-*.md`. Enfoque elegido: menú propio con fuentes propias
(carpetas, historial, catálogo) + completados de la propia sesión de PowerShell.

### Qué se hizo
- `src/suggest/`: leer la línea del prompt de la pantalla (desde el 133;B hasta el cursor), separar
  palabras con comillas (en cmd solo `"`), catálogo propio en español (~60 comandos: archivos, red,
  sistema, git, npm, docker, winget, agentes…; los internos de cmd que en PowerShell son alias de
  cmdlets van solo para cmd), motor que junta historial, catálogo, carpetas, PATH y PowerShell con
  orden y sin repetidos, inserción con retrocesos y comillas, teclas del menú, controlador y menú.
- PowerShell: `alphaterm.ps1` registra el atajo `F12,e` con PSReadLine; corre `TabExpansion2` y
  contesta en una OSC 7717 invisible con un nonce por sesión (`ALPHATERM_NONCE`, se borra del
  entorno). Se pide tras 150 ms sin teclas, nunca para comandos del catálogo ni rutas de red ni
  después de Tab/Ctrl+R; si una respuesta tarda más de 300 ms, esa pestaña solo pide con Ctrl+Espacio.
- Rust (`suggest.rs`): listar carpetas (caché 3 s, sin ocultas, máx. 500), puerta de enlace
  (`GetBestRoute` a 8.8.8.8), ejecutables del PATH, scripts de npm y procesos.
- cmd ahora guarda historial: la línea se lee al Enter y `running` pasa a true hasta el próximo
  prompt (también lo ven el estado de la pestaña, el de agentes y Servidores).
- Teclas: ↑ es siempre el historial salvo navegando el menú; ↓ navega; Tab inserta; Enter ejecuta
  (inserta solo si se navegó); Esc cierra; Ctrl+Espacio abre a mano (en PowerShell reemplaza a
  `MenuComplete` mientras las sugerencias estén activadas).
- Configuración → Terminal: activadas / al escribir o solo con Ctrl+Espacio / completados de PowerShell.

### Prueba en la app
- Riesgo 1 (atajo escondido por ConPTY) verificado primero con un test de integración real
  (`powershell_completa_con_f12`): llega, contesta `Get-ChildItem` y las carpetas para `cd `, y el
  nonce no queda en el entorno.
- Versión de desarrollo y release aparte (`target\prueba`, datos y WebView2 propios, CDP en 9333,
  sin tocar la AlphaTerm abierta):
  - PowerShell: `cd ` con carpetas, `..` y `~`; Tab baja a subcarpetas; ↓ + Enter inserta sin
    ejecutar; Enter ejecuta; ↑ trae el historial y no abre el menú; Esc cierra sin borrar la línea;
    `Get-Ch` y `Get-ChildItem -Fi` con resultados de la propia sesión; Ctrl+Espacio; nada de menú
    dentro de `node`.
  - cmd: `ping ` con 8.8.8.8, 1.1.1.1, el router (192.168.1.1, leído en vivo), localhost y opciones;
    nada de menú mientras corre `ping`; `cd 3d` → `cd "3D Objects\\"` y sigue bajando; historial de cmd
    guardado tal cual se tipeó.
  - Pantalla limpia: el atajo escondido no deja nada visible.
- Arreglos que salieron de la prueba real (cada uno con su test que falló primero): el menú quedaba
  una tecla atrás (un aviso de salida antes del eco consumía la marca; ahora se compara la línea);
  el historial de `cd` de otras carpetas tapaba las carpetas; el título de cmd metía un espacio de
  más en el historial; lo de PowerShell ganaba al catálogo en la primera palabra y repetía `.exe`;
  `dir /` en cmd listaba la raíz del disco en vez de las opciones.
- Revisión de toda la rama por un revisor aparte ("con arreglos", nada crítico). Arreglado, cada uno con
  su test: una inserción pendiente podía escribirse después del Enter (ahora se cancela y nunca se
  escribe fuera del prompt); la espera del eco pasó a comparar la línea esperada (una salida ajena ya
  no cuenta como eco); nada con caracteres de control se ofrece (un script de npm "x\rcalc\r" se
  habría ejecutado); entre comillas la barra final va doblada (`"AI PROJECTS\\"`: con una sola, git
  o node reciben el argumento roto, verificado en esta PC; cd y Set-Location aceptan la doble); los
  valores que ya traen comillas no se vuelven a entrecomillar; caché de 4 s en los generadores (git,
  docker, procesos) en vez de un proceso por tecla; el historial de otras carpetas vuelve para los
  comandos que el catálogo no conoce. Los menores quedaron anotados (ver abajo).

### Pendiente / no verificado
- PowerShell 7 (no está instalado en casa) y PSReadLine con predicciones propias (2.2+), que pueden
  dibujar texto en gris después del cursor: el menú no aparece si hay algo escrito después del cursor.
- Probarlo en el uso diario de Bruno (rama `predicciones`, acceso directo «AlphaTerm prueba
  (predicciones).bat» en el escritorio, con datos aparte).
- Líneas largas envueltas y comandos de varias líneas: cubierto por tests, no probado a mano.
- Menores de la revisión sin hacer: carpetas de más de 500 entradas (se cortan antes de filtrar),
  aceptar un comando del menú no abre el siguiente menú, el primer ↓ solo marca la fila 1, el
  nonce va a todos los perfiles, sin aviso visible cuando una pestaña deja de preguntarle a
  PowerShell, detalles del catálogo (cd /d en PowerShell, chdir/mklink/title/ver/for), y anotar en
  CLAUDE.md el protocolo 7717/F12,e y que toda escritura a la shell va por `toShell`.

### Stats
- Tests: Rust 84 (+6 ignorados), Vitest 206. Todos en verde.

## Paneles: barrita, mover y divisores (23/11/2026, rama `paneles`)

Pedido de Bruno: "poner split view de multiples ventanas", y después "agregá los botones de dividir
y cerrar, tambien el poder moverlas como si fuera snap, osea cambiar el orden o el tamaño". Diseño y
plan en `docs/es/specs/2026-11-23-pane-bar-and-snap-*.md`. Enfoque elegido por Bruno: una
barrita fija arriba de cada panel (en vez de botones flotantes).

### Qué se hizo
- Barrita de 22 px en cada panel de terminal: nombre (agente o shell · carpeta), ⇥ dividir a la
  derecha, ⤓ dividir abajo, × cerrar. Resaltada en el panel enfocado. Clic derecho: Dividir a la
  derecha, Dividir abajo, Igualar tamaños, Cerrar panel. El navegador suma el agarre ⋮⋮ y ⇥ ⤓.
- × y «Cerrar panel» preguntan si hay algo corriendo (agente o comando), con una pregunta propia
  dentro de la app (`askConfirm`): `window.confirm` no pregunta en AlphaTerm (ver Pendiente).
- Mover: se arrastra la barrita (umbral de 5 px); sobre la mitad de otro panel queda de ese lado,
  en el centro se intercambian; se pinta dónde va a quedar. Esc, perder el foco o pointercancel
  cancelan. El navegador se esconde mientras se arrastra.
- Divisores: zona de 9 px, se frenan en ⅓, ½ y ⅔ (a 12 px o menos), doble clic deja mitad y mitad.
- Modelo con tests: `movePane`, `swapPanes`, `equalize`, `paneAt`, `dropZone`, `zoneRect`,
  `snapRatio`; `paneBusy`; el controlador del arrastre (`paneDrag.ts`) con tests propios.

### Prueba en la app (exe de debug + Vite, datos y WebView2 propios, CDP en 9333)
- ⇥ y ⤓ dividen el panel de esa barrita; el nuevo queda resaltado; × sin nada corriendo cierra.
- Con `ping -t localhost` corriendo, × y «Cerrar panel» preguntan («¿Cerrar este panel? Se corta lo
  que está corriendo en él (PING · Br1).»), con el foco en Cancelar; Esc y Cancelar no cierran.
- Arrastrar el panel del ping a la mitad izquierda de otro: queda a la izquierda, es el mismo nodo
  de la terminal (marca en el DOM intacta) y el proceso PING sigue vivo. Centro intercambia. Esc,
  blur y un clic sin mover no cambian nada y dejan el body limpio.
- Esc a mitad de arrastre no llega a la shell (una línea escrita en PowerShell sigue ahí; un Esc
  directo sí la borra).
- Con un navegador: durante el arrastre se esconde y se pinta la zona; al cancelar vuelve. El
  navegador se mueve por su agarre.
- Divisor: cerca de ⅓ queda en 0,3333; a 9 px de ⅔ queda en 0,6667; lejos queda donde se suelta
  (0,42); doble clic 0,5; «Igualar tamaños» 0,5.
- Cerrar la ventana de prueba y volver a abrirla recupera la distribución movida.
- Hallazgo: `window.confirm` está reemplazado por el plugin de diálogos de Tauri (función async →
  promesa, siempre "sí") y la app no tiene el permiso: ninguno de los `confirm()` de la app
  pregunta. Para no mostrar preguntas después de actuar, no se agregó el permiso.

### Pendiente / no verificado
- Arreglado a pedido de Bruno: los 13 `confirm()` viejos (detener un servidor, aunque no lo haya
  lanzado AlphaTerm; borrar contenedor de Docker; volver la configuración a fábrica; cambiar la
  statusline de Claude Code; borrar temas, recetas, presets de Docker y agentes del catálogo;
  cambiar de rama con cambios; crear repo; vaciar modificaciones; descartar edición; cerrar carpeta
  de pestañas) pasaron a `askConfirm`, con un botón que dice qué hace («Detener», «Borrar»,
  «Volver a fábrica»…). `scripts/no-confirm.test.mjs` falla si vuelve a aparecer uno suelto.
- Probarlo en el uso diario de Bruno (acceso directo «AlphaTerm prueba (paneles).bat»).
- Con un agente real trabajando (Claude Code) mientras se mueve su panel: probado con `ping`, no con
  un agente.

### Stats
- Tests: Vitest 229 (+23: modelo 11, sesión 1, estado 1, arrastre 7, confirmación 3, guardia de
  `confirm()` 1). Sin cambios de Rust.

## Idiomas: español, inglés y portugués (24/11/2026, rama `i18n`, versión 0.7.0)

Pedido de Bruno: que AlphaTerm se pueda usar entera en español, inglés o portugués, con la
documentación, las Novedades y las descripciones de la API también en los tres, para publicar el repo
como open source.

### Qué se hizo
- Base (`src/i18n/index.ts`): `t("texto en español")` traduce al idioma actual (una señal de Solid:
  en JSX se actualiza solo al cambiar el idioma), `k()` marca textos de constantes, `locale()` para
  fechas y números. Diccionarios por área en `src/i18n/en|pt/*.json` con el texto en español como
  clave. `scripts/i18n-check.mjs` (con test) revisa faltantes, sobrantes, {variables} y choques.
- Configuración: sección nueva «Idioma» (primera de la lista, con 🌐) con Español / English /
  Português; el cambio se aplica en vivo en todas las ventanas. Instalación nueva: el idioma de
  Windows; configuración de antes: español.
- Interfaz completa: 1179 textos traducidos al inglés y al portugués (configuración y atajos,
  agentes, paneles laterales, ventana y pestañas, navegador, terminal, consumo, guardián,
  predicciones con todo su catálogo, Novedades).
- Backend Rust (`src-tauri/src/i18n.rs`): ~195 mensajes con sus tres versiones (errores, guardián,
  consumo, API de control, pedido del navegador). `set_locale` desde el frontend; al arrancar se lee
  de settings.json. Las pestañas nuevas reciben `ALPHATERM_LANG`.
- Scripts para agentes: el servidor MCP (27 herramientas, ~62 textos), el hook del guardián y la capa
  del navegador, en los tres idiomas.
- Novedades: los 60 commits anteriores traducidos (`src/i18n/changelog/en|pt.json`, clave = asunto);
  `changelog.mjs --faltan` y `release.mjs` frena si falta una traducción.
- Documentación en inglés y portugués (`docs/en|pt`, `CLAUDE.en.md`, `CLAUDE.pt.md`, avisos
  de ConPTY) y sus PDF (`generate_pdfs.py` ahora genera por idioma: `python docs/generate_pdfs.py
  en pt`), README en tres idiomas (con capturas de la interfaz en inglés), licencia MIT y avisos de terceros.
- Se trabajó en paralelo por áreas (diez agentes, cada uno con sus archivos y sus diccionarios);
  la integración unificó traducciones repetidas y arregló lo que cruzaba áreas: el atajo de cada panel
  se busca por id (antes comparaba etiquetas), y las etiquetas de consumo, las decisiones del guardián
  y "Símbolo del sistema" quedan en español como ids y se traducen al mostrarlas.

### Pendiente / no verificado
- Revisión de las traducciones por una persona que hable inglés o portugués.

### Stats
- Tests: Vitest 241 (+12), cargo 86 ok + 6 ignorados (+2). tsc sin errores.

## Linux (25/11/2026, rama `linux`, versión 0.8.0)

Pedido: sacar la siguiente versión con soporte para Linux y la misma funcionalidad, verificando que
todo funcione antes de publicarla. Se hizo en Ubuntu 26.04 (GNOME), con Rust 1.100 y Node 22.

### Qué se hizo
- Backend: `os.rs` reúne lo que depende del sistema (HOME, `~/.config/AlphaTerm`, temporales en
  `$XDG_RUNTIME_DIR/AlphaTerm`, xdg-open y «mostrar en el gestor de archivos» por D-Bus). Perfiles
  bash, zsh y fish con integración (OSC 133/633/7): bash con `--init-file`, zsh con un `ZDOTDIR`
  propio que vuelve al del usuario, fish con `--init-command`. Por defecto, la shell de `$SHELL`.
- Puertos desde `/proc/net/tcp[6]` con el dueño por los fd de `/proc`, y detener por árbol
  (SIGTERM y después SIGKILL); fuentes con fc-list; gateway de `/proc/net/route`; agentes sin
  extensiones y con las carpetas típicas (`~/.local/bin`, nvm…); entorno persistente desde
  `/etc/environment` y `environment.d`; Docker Desktop para Linux.
- Navegador integrado sobre WebKitGTK (`webkit.rs`, `scripts/browser-linux.js`): eval con promesas,
  capturas (visible, página entera y recortes de cada marca), recarga, consola y errores, clics,
  texto y teclas como eventos del DOM. Se ubica como capa de un GtkOverlay sobre la interfaz. La
  página habla por el IPC de Tauri con un plugin inline (`browser-page`) y permiso solo para los
  navegadores.
- Frontend: `platform.ts` (sistema por el user agent), rutas `/…` en la salida y en la barra de
  ubicación, OSC 7 tal cual, comillas de sh y de fish al lanzar agentes, y predicciones en bash, zsh
  y fish (familia `sh`, con su catálogo de comandos de Linux; los de Windows se marcaron como tales).
  Textos que hablaban de Windows tienen su versión para Linux (96 textos nuevos, en los tres idiomas).
- Configuración por plataforma (`tauri.windows.conf.json`, `tauri.linux.conf.json`); `build.rs` copia
  ConPTY solo para Windows. `install.mjs` y `release.mjs` funcionan en Linux, con `build-release.sh`.
- Windows: todo lo suyo quedó detrás de `cfg(windows)`; se verificó que siga compilando con
  `cargo check --tests --target x86_64-pc-windows-msvc`.

### Bugs encontrados al probar (arreglados)
- Tauri pone los webviews hijos en la GtkBox de la ventana: el navegador quedaba debajo de la
  interfaz y la achicaba a la mitad. Ahora es una capa del overlay, con el rectángulo exacto.
- Con un script message handler propio, wry contestaba cada mensaje con un `console.error`, el hook
  de consola lo reenviaba y se armaba un bucle (167.000 mensajes, CPU al 50 %). Se pasó al IPC de Tauri.
- Enter enviaba el formulario dos veces (WebKit ya lo envía con el keypress sintético) y el eval de
  sentencias dejaba un «Script error.» en la consola de la página.
- sysinfo lista los hilos como procesos: el título de la pestaña mostraba «Thread-8 (…)» y el panel
  de sistema iba a sumar la memoria una vez por hilo.
- `git_root` devolvía la ruta con `\` y el panel de Git quedaba vacío; el OSC 7 de bash salía con
  doble barra; las claves de rutas del panel de modificaciones ignoraban mayúsculas.

### Prueba en la app (build de debug en Xvfb, datos propios, API de control, clics con XTest)
- Terminal: bash con prompt, carpeta, título con rama, `run` con salida y código de salida.
  Sesión restaurada al reabrir (pestañas, paneles y navegador). Dividir y ventana nueva.
- Navegador (17 comprobaciones por la API): eval (expresión, sentencias, promesa, error), clic,
  escribir, Enter que envía una sola vez, Backspace, Tab, Ctrl+A, scroll, consola sin ruido,
  capturas (visible, elemento de 200×120, página entera), link, título y atrás. Modo edición con
  clics reales: marcas, barra del pedido y «Pedir al agente» (capturas, `pedido.md` y el texto en la
  terminal).
- Paneles: servidores (el de la pestaña marcado «AlphaTerm»), proyectos, git, historial, Docker (no
  instalado), agentes (Claude Code detectado y consumo en vivo leído de `claude /usage`).
- Predicciones en bash (`cd sr` → `src/`, `src-tauri/`), configuración con los textos de Linux,
  guardián con el hook de Claude Code (un `rm -rf` simulado: pregunta, «Bloquear» → `deny`).
- zsh 5.9 y fish 4.2: marcas, código de salida y OSC 7 en PTY real; cargan los archivos del usuario.

### Pendiente / no verificado
- Codex, Antigravity y OpenCode no están instalados acá: su consumo en vivo en Linux no se probó.
- Docker no está instalado: el panel solo se vio en el estado «no instalado».
- Pegar imágenes del portapapeles en Linux (Wayland) no se probó.
- Los clics y teclas de los agentes en el navegador no son eventos de confianza: puede haber sitios
  que no reaccionen.
- Los PDF de la guía de código no se regeneraron: `generate_pdfs.py` usa Segoe UI y Consolas, que
  solo están en Windows. Regenerarlos ahí (`python docs/generate_pdfs.py es en pt`).

### Stats
- Tests: Vitest 256 (+15), cargo 98 ok + 6 ignorados (+12; en Linux corren los de bash, zsh y fish con
  PTY real en vez de los de cmd y PowerShell). tsc sin errores. Windows: `cargo check` sin errores ni warnings.
- Release en Linux: binario de 17 MB; arranque hasta el primer prompt ~1,2 s y ~265 MB de memoria (PSS de
  AlphaTerm y los procesos de WebKit), en Xvfb con render por software. Las metas de <120 MB y <500 ms
  tampoco se cumplen en Linux.

## Reordenar pestañas arrastrando (26/11/2026)

Pedido de Bruno: "quiero que también el poder cambiar el orden de las tabs, en horizontal o
vertical, arrastrándolas". La barra ya tenía un arrastre con drag and drop de HTML5, pero no
funcionaba: en Windows la ventana de Tauri se queda con el arrastre para soltar archivos
(`dragDropEnabled`) y esos eventos no le llegan a la página.

### Qué se hizo
- El arrastre de pestañas pasa a ser por puntero, como el de los paneles: `startPointerDrag`
  (genérico, sacado de `paneDrag.ts`: umbral de 5 px; Esc, perder el foco o pointercancel cancelan;
  `resizing` en el body), que ahora usa también `startPaneDrag`.
- Anda igual con la barra arriba, a la izquierda y plegada. Una línea del color de acento marca
  dónde va a caer (antes o después de una pestaña, antes de una carpeta, o al final); los lugares
  que no cambian nada no se marcan. Con muchas pestañas, la lista se desplaza sola al acercarse a
  un borde.
- Carpetas: junto a una pestaña, la arrastrada toma su carpeta (o ninguna); en la cabecera de una
  carpeta, la primera mitad la deja suelta justo antes y la segunda la mete adentro, primera (se
  resalta la cabecera), también si está plegada; más allá de la última queda suelta al final. La
  carpeta que queda vacía desaparece.
- Modelo con tests: `TabDrop`, `placeInOrder`, `dropChanges`, `dropTab`; `tabDrag.ts`
  (`tabDropAt`, `autoScrollStep`) con tests propios.

### Prueba en la app (release aparte con datos y WebView2 propios, CDP en 9333)
- Barra arriba: la primera pestaña soltada en la mitad derecha de la tercera queda tercera; la
  última, en el borde izquierdo de la primera, queda primera. Durante el arrastre el body tiene
  `resizing tab-dragging` y la pestaña destino la marca; al soltar, el body queda limpio.
- Esc a mitad de arrastre no mueve nada; un clic sin mover sigue seleccionando la pestaña.
- Barra a la izquierda: la primera al final y la última antes de la segunda, con la marca abajo o
  arriba de la pestaña destino.
- Carpetas (creada desde el menú de la pestaña): soltar en la segunda mitad de la cabecera la mete;
  en la primera mitad la saca y la deja antes; después de la última de la carpeta entra al final;
  sobre la cabecera plegada entra; sobre el botón + queda suelta al final.

### Pendiente / no verificado
- Con el mouse de verdad: se probó con eventos de mouse por CDP (generan los mismos eventos de
  puntero).
- Los paneles laterales del mosaico (`dock-drop` en `Workspace.tsx`) siguen con drag and drop de
  HTML5: por lo mismo, probablemente no anden. No se tocaron.

### Stats
- Tests: Vitest 268 (+12: arrastre de pestañas 11, arrastre genérico 1). Sin cambios de Rust.

## La última fila de la terminal ya no queda cortada (26/11/2026)

Pedido de Bruno: con AlphaTerm maximizada en el monitor vertical, la última línea de la terminal
(«auto mode on» de Claude Code) salía cortada por la mitad; en el horizontal se veía bien.

### Qué se hizo
- Causa: FitAddon calcula filas y columnas con el alto y el ancho del padre de la terminal, con su
  padding incluido, y solo descuenta el padding del elemento de xterm. El padre era `.term-host`, con
  6/4/4/12 px de margen: según el tamaño entraba una fila de más (la última quedaba debajo del pie) y
  siempre una o dos columnas de más (la última quedaba en el borde o bajo la regla de desplazamiento).
- Arreglo: xterm se abre en una caja interna sin padding (`.term-fit`) dentro de `.term-host`, que
  conserva el margen. No se tocó xterm.

### Prueba en la app (release aparte con datos y WebView2 propios, CDP en 9333)
- Maximizada en el monitor vertical (1080×1849 de área útil), antes: la grilla medía 1764 px para
  1755 disponibles (9 px debajo del pie). Después: 1746 de 1755. Con 140 líneas de salida, el prompt
  queda entero como última fila.
- Barrido de 150 tamaños (por CDP, de 500 a 1849 px de alto y 600 a 1080 de ancho): antes, la última
  fila cortada en 75 y la grilla pasada de ancho en los 150; después, en ninguno.
- Maximizada en el monitor horizontal: entra con 19 px de sobra.

### Stats
- Tests: Vitest 268 (sin cambios: es de medidas del navegador, se probó en la app).
