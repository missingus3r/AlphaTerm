# Predicciones de comandos en la terminal — diseño

Fecha: 21/11/2026. Estado: borrador para aprobar.

## Para qué

Bruno quiere que AlphaTerm le sugiera qué escribir mientras tipea en cmd o PowerShell: con `cd`,
las carpetas de donde está parado; con `ping`, las IPs y hosts típicos; y lo mismo para los demás
comandos. Lo que pidió explícitamente: "un sistema predictivo de comandos en la shell, manteniendo
el historial si apreto hacia arriba, y que me aparezca un menú de posibles carpetas desde donde
estoy parado si pongo cd".

Lectura propia (no la dijo él): el valor está en escribir menos los comandos de todos los días
(historial, carpetas) y en no tener que acordarse de la sintaxis de los que usa poco (catálogo con
opciones explicadas).

## Objetivos

- Un menú que aparece debajo del cursor mientras se escribe en el prompt de **cmd** y de
  **PowerShell (5.1 y 7)**, con sugerencias para el comando y para sus argumentos.
- `cd ` muestra enseguida las carpetas de la carpeta actual (y `..`), filtradas por lo que se
  va escribiendo; al elegir una se puede seguir bajando (`cd src\` → subcarpetas de `src`).
- Predicción desde el historial: si lo escrito es el comienzo de un comando ya usado
  (`git p` → `git push origin main`), aparece como sugerencia, con prioridad si fue en esta carpeta.
- Valores típicos por comando desde un catálogo propio (ej. `ping` → 8.8.8.8, 1.1.1.1, el router,
  localhost, google.com y los hosts que ya se usaron).
- En PowerShell, además, lo que sabe la propia shell (todos los cmdlets, sus parámetros, módulos
  instalados, variables, rutas) pidiéndole los completados a la sesión abierta.
- La flecha arriba sigue siendo el historial de la shell, como hoy.

## No objetivos (v1)

- Git Bash, WSL y perfiles custom: sin menú (la base queda lista para sumarlos después).
- Predicción en gris al lado del cursor (estilo fish/Warp). Se descartó como enfoque; puede
  sumarse después.
- Sugerencias dentro de programas que corren en la terminal (Claude Code, Codex, python, ssh…).
- Usar las predicciones de PSReadLine o actualizar PSReadLine.
- Importar catálogos ajenos (ej. las specs de Fig): el catálogo es propio y en español.
- Cursor en el medio de la línea: el menú solo aparece con el cursor al final de lo escrito.

## Anti-objetivos (si pasa esto, falló aunque "ande")

- Que la flecha arriba deje de traer el historial cuando uno no está navegando el menú.
- Que el menú aparezca o que AlphaTerm mande teclas mientras corre un programa o un agente.
- Que escribir se sienta más lento o que se inviertan teclas (gotcha conocido: todo pasa por
  `WriteQueue`).
- Que Esc, Tab o Enter hagan algo distinto de lo de siempre cuando el menú no está abierto.
- Que el menú tape el navegador integrado (nada de la interfaz puede tapar al WebView2 hijo).

## Lo que ya existe y condiciona el diseño

- Integración de shell (`src-tauri/shell/alphaterm.ps1`, `src-tauri/src/pty/integration.rs`):
  PowerShell emite OSC 133 A/B/C/D, 633;E (texto del comando) y OSC 7 (carpeta). cmd solo tiene la
  variable PROMPT: 133;D sin código, 9;9 con la carpeta, 133;A/B alrededor del prompt. **cmd no
  avisa qué comando se corrió ni cuándo arranca.**
- `TerminalView.tsx` parsea esas marcas (`parse133`, `parse633`, `parseOsc7/9`), conoce la carpeta
  actual (`cwdNow`), si hay un comando corriendo (`running`) y si la shell tiene integración.
  Las teclas van de `term.onData` directo a `session.write` (con `WriteQueue`); los atajos se
  interceptan en `attachCustomKeyEventHandler`.
- Historial: `history.rs` (`history_add`, `history_search`), en `%APPDATA%\AlphaTerm\history.jsonl`.
  Lo alimenta `Workspace.tsx` cuando una pestaña pasa de `running` a no `running` con un
  `lastCommand`. Hoy tiene solo comandos de PowerShell.
- PowerShell 5.1 de casa trae PSReadLine 2.0.0 (sin predicciones propias).
- Navegador integrado: los menús nuevos van en `FLOATING` (`src/browser/marks.ts`) para que el
  WebView2 se esconda si se le superponen.
- Configuración: esquema en `src/settings/schema.ts`, vista en `SettingsView.tsx`.
- Git y Docker por la CLI, sin shell en el medio (`git.rs`, `docker.rs`).

## Enfoques considerados

1. **Menú propio con fuentes propias**: AlphaTerm lee la línea de la pantalla y arma las opciones
   con carpetas/archivos, historial y un catálogo escrito a mano. Igual en cmd y PowerShell; el
   catálogo cubre los comandos comunes, no "todos".
2. **Preguntarle a PowerShell**: como VS Code, un atajo de teclado escondido hace que la sesión
   abierta corra `TabExpansion2` y devuelva los completados por una secuencia invisible. Sabe todo
   lo de PowerShell; solo sirve en PowerShell y exige cuidar la sincronía con lo tipeado.
3. **Una predicción en gris** al lado del cursor: rápida para repetir, pero no da la lista de
   carpetas. Descartada como enfoque principal.
- Descartado también: activar las predicciones de una PSReadLine más nueva (solo PowerShell, solo
  historial, sin carpetas).
- Variante evaluada para el 2: un PowerShell escondido aparte al que preguntarle. No necesita
  mandar teclas, pero no conoce lo de la sesión (variables, funciones, módulos cargados) y suma un
  proceso (~60–80 MB, con la meta de RAM ya incumplida). Queda solo como plan B si el atajo
  escondido no funciona a través de ConPTY.

**Elegido por Bruno: 1 + 2.** El 1 es la base en las dos shells; en PowerShell se suman los
completados de la propia sesión.

## Cómo funciona

### Cuándo se puede mostrar (estado "en el prompt")

Una pestaña está *en el prompt* si se cumple todo esto:
- el perfil es `cmd`, `powershell` o `pwsh`, y llegó al menos un 133;B (integración viva);
- después del último 133;B no se mandó ningún Enter a la shell. Cuenta cualquier Enter: tecla,
  comando del panel de agentes, `send` del historial, texto pegado con salto de línea. El chequeo
  va en un solo lugar por donde pasan todas las escrituras de la pestaña, no solo en `onData`;
- no está activo el buffer alternativo (`term.buffer.active.type !== "alternate"`);
- `running` es falso.

El estado se vuelve a poner en verdadero con el próximo 133;B. Si no está en el prompt, el menú se
cierra y AlphaTerm no manda nada a la shell.

### Leer lo que se está escribiendo

- Al llegar 133;B se guarda la posición exacta donde termina el prompt: un marcador de línea de
  xterm más `cursorX` en ese momento (el handler de OSC corre sincrónico con el parseo, así que el
  cursor está ahí).
- Después de cada escritura de la shell (`onWriteParsed`) se arma la línea actual: el texto desde
  esa posición **hasta el cursor**, uniendo las líneas envueltas (`isWrapped`). Lo que haya
  después del cursor se ignora.
- Si el cursor no está al final de lo escrito, o la entrada tiene más de una línea lógica
  (continuación `>>` de PowerShell), no hay menú.
- La línea se separa en palabras respetando comillas. La palabra actual es la que toca el cursor.
  Sirve para saber si se completa el comando (primera palabra) o un argumento, y de qué comando.

### Fuentes de sugerencias

Cada sugerencia tiene: texto a insertar, rótulo visible, descripción corta en español, tipo
(carpeta, archivo, historial, comando, opción, valor, PowerShell) y puntaje.

1. **Carpetas y archivos** (Rust, comando nuevo): lista la carpeta a la que apunta lo escrito,
   relativa a la carpeta actual o absoluta (`C:\`, `..\`, `~`). Solo carpetas para `cd`, `pushd`,
   `mkdir` y `rd`; carpetas y archivos para el resto. Hasta 500 entradas, con caché corta por
   carpeta (unos segundos). Las ocultas o de sistema se omiten, salvo que lo escrito empiece con `.`.
2. **Historial**: los comandos que empiezan con la línea escrita, con más peso si se usaron en esta
   carpeta y si son recientes o frecuentes. También los argumentos ya usados con el mismo comando
   (ej. hosts de `ping`/`ssh`/`tracert`/`curl` anteriores).
   - **Historial de cmd (nuevo)**: cuando se manda Enter estando en el prompt de cmd, se lee la
     línea y se hace `patch({ lastCommand, running: true })`. El 133;D del próximo prompt ya pone
     `running: false`, así que `Workspace.tsx` lo guarda como hoy (código de salida vacío,
     porque cmd no lo da).
3. **Catálogo propio** (`src/suggest/catalog/`, TypeScript): por comando, descripción, subcomandos,
   opciones (con su explicación) y argumentos con *generadores* de valores. Cada entrada se marca
   para cmd, PowerShell o las dos (ej. `dir /s` solo cmd). Lista inicial:
   - archivos: cd, dir/ls, mkdir/md, rmdir/rd, del/rm, copy/cp, move/mv, ren, type/cat, tree,
     start, explorer, code, notepad;
   - red: ping, tracert, nslookup, ipconfig, netstat, arp, curl, ssh, scp;
   - sistema: tasklist, taskkill, where, set, echo, cls, exit, shutdown, systeminfo, whoami, sfc,
     chkdsk, winget, wsl;
   - desarrollo: git, npm, npx, node, python/py, pip, docker, cargo, claude, codex, agy, opencode.

   Generadores con datos en vivo, todos sin shell en el medio:
   - hosts: 8.8.8.8 (DNS de Google), 1.1.1.1 (Cloudflare), puerta de enlace de la red (el router,
     desde Rust), 127.0.0.1/localhost, google.com, más los hosts del historial;
   - ramas y remotos de git (CLI de git, como `git.rs`);
   - scripts del `package.json` de la carpeta (`npm run …`);
   - contenedores e imágenes de Docker (CLI, como `docker.rs`), solo si Docker responde rápido;
   - procesos para `taskkill /IM` (nombres de los procesos abiertos).
4. **Nombres de comandos**: para la primera palabra, el catálogo, el historial y los ejecutables del
   PATH (`.exe`, `.cmd`, `.bat`, `.ps1` en PowerShell; lista cacheada, se puede reusar
   `agents_path_env`). En cmd también sus comandos internos.
5. **PowerShell (enfoque 2)**: ver abajo.

### Completados de la propia sesión de PowerShell

- `alphaterm.ps1` registra, si existe PSReadLine, un atajo de dos teclas que nadie usa (propuesta:
  `F12,e`; el builder puede cambiarlo) con `Set-PSReadLineKeyHandler`. Cuando llega:
  1. lee el buffer y el cursor con `[Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState`;
  2. corre `TabExpansion2 -inputScript $buffer -cursorColumn $cursor`;
  3. escribe con `[Console]::Write` una OSC propia e invisible con un JSON en base64: el buffer y el
     cursor usados, `ReplacementIndex`, `ReplacementLength` y hasta 100 resultados (texto, rótulo,
     tipo, tooltip);
  4. no toca el buffer ni la pantalla.
- Al cargar, el script avisa con otra OSC que el atajo está disponible. Sin ese aviso, AlphaTerm
  nunca lo manda.
- AlphaTerm manda la secuencia del atajo por la `WriteQueue` de la pestaña solo si está *en el
  prompt*, la sesión avisó que lo tiene, y pasaron ~150 ms sin teclas.
- La respuesta se descarta si su buffer no coincide con la línea leída en ese momento (respuesta
  vieja). Las fuentes locales se muestran enseguida; lo de PowerShell se mezcla cuando llega.
- **Ojo, frena el tipeo mientras corre**: el handler de PSReadLine corre en el mismo hilo que dibuja
  lo que se tipea, así que mientras `TabExpansion2` trabaja las teclas se acumulan (no se pierden,
  aparecen juntas al terminar). Medido en la PowerShell 5.1 de casa (`-NoProfile`, 21/11/2026):
  la primera llamada tarda 100–150 ms; después, `Get-` 55–70 ms, `cd ` 35–50 ms, `git `/`ping `
  ~30 ms, `cd A` 3 ms, parámetros (`Get-ChildItem -`) ~1 ms. Es del orden de una tecla, pero para
  no pedir de más:
  - no se pide si el comando está en el catálogo (sus resultados se ignorarían igual);
  - no se pide para rutas de red (`\\servidor\…`) ni para la primera palabra con menos de 3 letras;
  - AlphaTerm mide cuánto tarda cada respuesta en esa pestaña; si una pasa de 300 ms, esa pestaña
    deja de pedir sola y solo pide con Ctrl+Espacio (se avisa con un tooltip en el menú);
  - sin "calentamiento" al arrancar la shell (empeoraría el primer prompt, cuya meta ya no se cumple).
- Para comandos que no son de PowerShell (ej. `ping`), `TabExpansion2` devuelve archivos de la
  carpeta: si el comando está en el catálogo, manda el catálogo y no se le pregunta a PowerShell.

### Mezcla y orden

- Se filtra por la palabra actual sin distinguir mayúsculas: primero lo que empieza igual, después
  lo que la contiene. Las letras que coinciden se resaltan.
- Primera palabra: historial de líneas completas > catálogo > PowerShell (cmdlets, alias,
  funciones) > PATH.
- Argumentos: si el comando está en el catálogo, sus valores y opciones más el historial de ese
  comando; si no, lo de PowerShell; las carpetas y archivos siempre que el argumento sea una ruta.
- Sin repetidos (el mismo texto a insertar aparece una sola vez, con la fuente de más peso).

### El menú

```
PS C:\Users\Br1\desktop> cd al█
                           ┌────────────────────────────────────────┐
                           │ ▸ 📁 AlphaTerm\                carpeta │
                           │   📁 aa-disney\                carpeta │
                           │   📁 aa-netflix\               carpeta │
                           │   🕘 cd AlphaTerm\src     ayer, acá    │
                           └────────────────────────────────────────┘

C:\Users\Br1> ping █
              ┌──────────────────────────────────────────┐
              │ ▸ 8.8.8.8           DNS de Google        │
              │   1.1.1.1           DNS de Cloudflare    │
              │   192.168.1.1       tu router            │
              │   localhost         esta PC              │
              │   -t                hasta Ctrl+C         │
              └──────────────────────────────────────────┘
```

- `div` absoluto dentro del panel de la terminal, alineado a la columna donde empieza la palabra,
  debajo de la línea del cursor (arriba si no entra). El tamaño de celda se calcula del panel y
  `cols/rows`. Hasta 8 filas visibles con scroll. Respeta el tema de la terminal.
- Su clase se agrega a `FLOATING` en `src/browser/marks.ts`.
- Se cierra al perder foco la terminal, al cambiar de pestaña, con Esc o si deja de estar en el prompt.

### Teclas (propuesta, decisión de diseño)

Con el menú abierto siempre hay una fila resaltada (la primera, en tono suave):

| Tecla | Menú abierto, sin haber navegado | Menú abierto, navegando (después de ↓) | Menú cerrado |
|---|---|---|---|
| ↑ | cierra el menú y pasa a la shell (historial) | sube; desde la primera fila deja de navegar | shell |
| ↓ | empieza a navegar (baja una fila) | baja | shell |
| Tab | inserta la resaltada | inserta la resaltada | shell (el Tab de siempre) |
| Enter | pasa a la shell (ejecuta lo escrito) | inserta la resaltada (no ejecuta) | shell |
| Esc | cierra el menú (no le llega a la shell) | cierra el menú | shell |
| Ctrl+Espacio | — | — | abre el menú a mano |

- El menú aparece solo: enseguida después del espacio en comandos con argumentos conocidos
  (`cd `, `ping `, `git `), con 1 letra en argumentos de ruta, y con 2 letras para la primera
  palabra, siempre que haya coincidencias. Los umbrales quedan en constantes ajustables.
- Interceptar las teclas va en `attachCustomKeyEventHandler`. Se agrega antes del chequeo de atajos
  solo cuando el menú está abierto, y nunca con Ctrl+Alt (AltGr).
- **Ctrl+Espacio en PowerShell** hoy es `MenuComplete` de PSReadLine (modo de edición Windows, el de
  Bruno). Decisión propia: con las sugerencias activadas, AlphaTerm se lo queda, porque su menú
  muestra los mismos completados de PowerShell y además los demás. Con las sugerencias
  desactivadas, Ctrl+Espacio le vuelve a llegar a PSReadLine como siempre. En cmd hoy no hace nada.
- El menú se abre solo después de caracteres tipeados, no después de traer una línea con ↑/↓ ni de
  un Tab propio de la shell (así ↓ y el ciclo de Tab de PSReadLine siguen andando).
- El atajo escondido nunca se manda justo después de Tab, Ctrl+R u otras teclas de PSReadLine que
  esperan una segunda tecla.

### Insertar una sugerencia

- Se reemplaza la palabra actual: se mandan tantos retrocesos como caracteres tenga lo escrito de
  esa palabra y después el texto nuevo, todo por la `WriteQueue`. En PowerShell, con un resultado de
  `TabExpansion2`, la parte a reemplazar es `ReplacementIndex/Length` (tiene que terminar en el cursor).
- Rutas con espacios van entre comillas (`"…"` en cmd, lo que devuelva `TabExpansion2` o `'…'` en
  PowerShell). Si la palabra ya abría comillas, se respetan.
- Si se insertó una carpeta, termina en `\` y el menú se vuelve a abrir con sus subcarpetas. Si
  fue otra cosa, termina en espacio y el menú se cierra.
- Una línea de historial elegida reemplaza la línea entera (y no se ejecuta).

### Configuración

En `schema.ts` + `SettingsView.tsx`, sección de terminal:
- "Sugerencias de comandos": activadas (por defecto) / desactivadas.
- "Mostrar": al escribir (por defecto) / solo con Ctrl+Espacio.
- "Pedirle completados a PowerShell": sí (por defecto) / no.

## Riesgos: verificar primero

1. **El atajo escondido a través de ConPTY**: que la secuencia de F12 que escribe AlphaTerm le
   llegue a PSReadLine 2.0 como `F12,e`, que el handler corra y que la OSC de respuesta llegue a
   xterm sin ensuciar la pantalla. Si no funciona, se usa el plan B (PowerShell escondido aparte) o
   se deja el 2 afuera, y se le avisa a Bruno antes de seguir.
2. **Leer la línea**: que la posición de 133;B más el cursor den bien la línea en las dos shells,
   con los redibujos de PSReadLine y con líneas envueltas.
3. **Insertar con retrocesos**: que funcione en cmd y en PSReadLine sin dejar basura en la pantalla.

Estos tres van primero en el plan, antes de construir el resto.

## Decisiones de la revisión (tomadas, no de Bruno)

- El `running: true` nuevo de cmd también alimenta el estado de la pestaña, el de agentes y el
  panel de servidores: es lo buscado (hoy cmd nunca dice que algo corre).
- Las sugerencias del historial se filtran por shell (la sintaxis de cmd y PowerShell difiere).
- Antes de insertar se cuentan las teclas mandadas que la shell todavía no mostró, para que los
  retrocesos no borren lo que no corresponde.
- El aviso de "atajo disponible" solo se acepta de un perfil de PowerShell y con un código por
  sesión que AlphaTerm le pasa al script, para que ninguna salida de otro programa lo pueda imitar.

## Lo que queda para quien lo construye

- Algoritmo exacto de puntaje (recencia, frecuencia, carpeta) y los umbrales de aparición.
- Estructura de archivos dentro de `src/suggest/` y nombres de los comandos de Rust nuevos.
- Número de la OSC propia y formato exacto del JSON.
- Cómo obtener la puerta de enlace en Rust (API de Windows o tabla de rutas).
- Íconos y estilo del menú, dentro del tema actual.
- El contenido de cada entrada del catálogo (opciones y descripciones en español).

## Cómo se da por terminado

- Tests: `npx vitest run` (separar palabras, leer la línea, mezcla y orden, máquina de estados de
  teclas, generadores del catálogo), `cargo test` (listar carpetas, puerta de enlace, caché) y
  `npx tsc --noEmit`.
- Prueba real en una AlphaTerm de prueba (`CARGO_TARGET_DIR=target\prueba`, `ALPHATERM_DATA_DIR` y
  `WEBVIEW2_USER_DATA_FOLDER` propios, CDP), **sin cerrar la AlphaTerm de Bruno**: `cd` con
  carpetas en cmd y PowerShell, `ping`, historial con ↑ intacto, cmdlets de PowerShell, nada de
  menú dentro de Claude Code, y que cmd ahora guarde historial.
- Registro en `Documentacion/Informe_Proceso_y_Stats.md`, marcando lo no verificado.
- Versión nueva con `compilar-version.bat --minor` (0.5.0).
