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

**Máquina:** PC de casa (`C:\Users\Br1`), Windows 11 Pro 10.0.26300. El plan se armó en la PC del trabajo
(`C:\Users\usuario`); las diferencias quedaron en la adenda al final de `Plan_Terminal_NovaTerm.txt`.

### Hecho
- Plan exportado a txt (en la PC del trabajo, 17/11) y copiado a `NovaTerm\Plan_Terminal_NovaTerm.txt`.
- Adenda con el entorno de casa y el ajuste de versiones agregada al plan.
- `Documentacion\generar_pdfs.py`: genera `Especificación.pdf` (8 págs.) y `Plan.pdf` (3 págs.) desde
  el txt con fpdf2 2.8.7 y Segoe UI / Consolas de Windows. Regenerable: `python Documentacion\generar_pdfs.py`.
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
- Guía de código (`Documentacion\Guia_de_codigo.txt` y `Guía de código.pdf`), adenda en el plan.

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
- La carpeta del proyecto sigue siendo `Desktop\NovaTerm`: se renombra cuando esta sesión de Claude
  Code la suelte.

### Stats
- Commits: F3 `8b4a54b`, F4 `9ce06bc`, F5 `3b94920`, F6 `b617faf`, F7 `38c09ad`, F8 `de356a4`,
  renombre `85f31a8`, extras y F9 hasta `cef9654`.
- Tests: Rust 55 (+3 ignorados), Vitest 96. Todos en verde.
- Binario release: alphaterm.exe 14,9 MB (+ conpty.dll y OpenConsole.exe).
