# Paneles: barra con botones y mover como snap — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barrita con dividir/cerrar en cada panel, menú con clic derecho, mover paneles arrastrando (mitades o intercambio) y divisores que se frenan en ⅓, ½, ⅔.

**Architecture:** Todo en el frontend (sin cambios de Rust). Las operaciones sobre el árbol de paneles y la geometría de las zonas son funciones puras en `src/layout/model.ts` con tests; la barra y el menú son un componente nuevo (`PaneBar.tsx`); el arrastre es un controlador de eventos de puntero (`paneDrag.ts`) que Workspace conecta con el modelo. Mover = cambiar el árbol; los paneles se siguen iterando por id, así que ninguna terminal se vuelve a crear.

**Tech Stack:** SolidJS 1.9 + TypeScript, Vitest, Tauri 2 (sin tocar), xterm 6.

**Spec:** `docs/es/specs/2026-11-23-pane-bar-and-snap-design.md`

## Global Constraints

- Sin cambios en `src-tauri` (Rust). Rama de trabajo: `paneles`, desde `main`.
- Paneles de terminal: se iteran por id y se posicionan por rectángulos. Nunca envolver `TerminalView` en algo que se pueda volver a montar al cambiar el árbol (mata la shell y el agente).
- Nada de la interfaz puede tapar al WebView2 del navegador: lo flotante va en `FLOATING` (`src/browser/marks.ts`); durante un arrastre se usa la clase `resizing` del body, que ya lo esconde.
- El clic derecho dentro de la terminal sigue siendo copiar/pegar; el menú nuevo va en la barrita.
- No cambiar ni quitar atajos existentes. Nada con Ctrl+Alt.
- Textos de la interfaz en español rioplatense, con los textos exactos de este plan.
- Solid: en menús, aplicar la acción antes de cerrarlo (patrón `act` de `TabBar.tsx`); en efectos que leen y escriben, `untrack`/`on`.
- No cerrar la AlphaTerm de Bruno. Las pruebas de interfaz van en una instancia aparte (ver Task 6). Rust está fuera del PATH: anteponer `~/.cargo/bin`.
- Los `.bat`, con CRLF.

## Review Focus

1. Arrastrar por encima de un panel de navegador: el WebView2 se esconde durante el arrastre y vuelve a aparecer al soltar o cancelar (Task 4, prueba CDP).
2. El arrastre se corta sin `pointerup` (sale de la ventana, `pointercancel`, la ventana pierde el foco): no puede quedar el body con `resizing` y los paneles sin recibir clics (Task 4, prueba CDP con `blur`).
3. Clic en ⇥, ⤓ o ✕ no empieza un arrastre ni lo dispara el umbral (Task 3/4, prueba CDP).
4. «Cerrar panel» desde el menú con un comando corriendo también pregunta, igual que ✕ (Task 3, prueba CDP).
5. Una distribución movida sobrevive a cerrar y volver a abrir (sesión) (Task 1, test de sesión).

---

### Task 1: mover, intercambiar e igualar en el modelo

**Files:**
- Modify: `src/layout/model.ts`
- Test: `src/layout/model.test.ts`, `src/layout/session.test.ts`

**Interfaces:**
- Produces:
  - `export type DropZone = "left" | "right" | "top" | "bottom" | "center"`
  - `movePane(l: Layout, tabId: string, paneId: string, targetId: string, zone: DropZone): Layout`
  - `swapPanes(l: Layout, tabId: string, aId: string, bId: string): Layout`
  - `equalize(l: Layout, tabId: string): Layout`

- [ ] **Step 1: crear la rama** — `git switch -c paneles` en `Desktop\AlphaTerm`.
- [ ] **Step 2: tests que fallan** en `model.test.ts`, `describe("mover paneles")`:
  - «a la izquierda de otro»: A|B (`splitPane` row), `movePane(l, t, B, A, "left")` → `leaves` = `[B, A]`, `root.dir === "row"`, `root.ratio === 0.5`, `activePane === B`.
  - «abajo con tres paneles»: A | (B sobre C); mover A a `"bottom"` de C → `leaves` = `[B, C, A]`; `paneRects(root).get(A)` ≈ `{ x: 0, y: 0.75, w: 1, h: 0.25 }` (`toBeCloseTo`).
  - «el centro intercambia y no toca proporciones»: A|B|C con `setRatio` 0.3 en la raíz; `movePane(..., A, C, "center")` → `leaves` = `[C, B, A]` y la raíz sigue con `ratio === 0.3`.
  - «sobre sí mismo, con un panel solo o con ids que no existen no cambia nada»: el resultado es la misma referencia (`toBe(l)`).
  - «mover no crea paneles»: tras mover, `findLeaf(root, B.id)` es `toEqual` a la hoja original (mismo id, perfil, carpeta, startup).
  - «igualar»: A | (B | C) con proporciones de fábrica → `equalize` → los tres anchos de `paneRects` ≈ 1/3; A | (B sobre C) → anchos de A y de B ≈ 0.5, y B y C con alto ≈ 0.5.
- [ ] **Step 3: test de sesión que falla** en `session.test.ts`: «guarda la distribución movida»: A|B, `movePane(B → "left" de A)`, `restore(JSON.parse(JSON.stringify(serialize(l, () => undefined))), opts)` → `leaves` = `[B, A]`.
- [ ] **Step 4: correr** `npx vitest run src/layout` → FAIL (funciones no definidas).
- [ ] **Step 5: implementar** en `model.ts`. `movePane`: con `"center"` llama a `swapPanes`; si no, `removeLeaf` del panel y `replaceNode` del destino por una división nueva (`newId("s")`, ratio 0.5): `left` → row, a = movido; `right` → row, b = movido; `top` → column, a = movido; `bottom` → column, b = movido. Queda activo el movido. `swapPanes`: cambia las dos hojas de lugar en el árbol (las divisiones quedan igual). `equalize`: cada división toma `ratio = n(a) / (n(a) + n(b))`, donde n cuenta paneles a lo largo de su eje: hoja = 1; división en el mismo eje = suma; en el otro eje = máximo. Acotar a [0.1, 0.9] como `setRatio`.
- [ ] **Step 6: correr** `npx vitest run src/layout` → PASS.
- [ ] **Step 7: commit** «Paneles: mover, intercambiar e igualar en el modelo».

### Task 2: geometría de las zonas, frenado del divisor y panel ocupado

**Files:**
- Modify: `src/layout/model.ts`, `src/panels/agentState.ts`
- Test: `src/layout/model.test.ts`, `src/panels/agentState.test.ts`

**Interfaces:**
- Consumes: `DropZone`, `Rect` (Task 1 / existente).
- Produces:
  - `paneAt(rects: Map<string, Rect>, fx: number, fy: number): string | undefined` — el panel cuyo rectángulo contiene el punto (mismas unidades).
  - `dropZone(r: Rect, fx: number, fy: number): DropZone` — centro si `|u-0.5| <= 0.2 && |v-0.5| <= 0.2` (u, v = posición relativa dentro de `r`); si no, el borde más cercano.
  - `zoneRect(r: Rect, zone: DropZone): Rect` — la mitad del lado; `center` = `r` entero.
  - `export const SNAP_POINTS = [1 / 3, 1 / 2, 2 / 3]` y `snapRatio(ratio: number, extentPx: number, thresholdPx = 12): number` — el punto más cercano si está a `<= thresholdPx` píxeles; si no, `ratio`.
  - `paneBusy(p: AgentPaneInfo): boolean` en `agentState.ts` = `!p.exited && agentRunning(p)`.

- [ ] **Step 1: tests que fallan**:
  - `dropZone` con `{x:0,y:0,w:1,h:1}`: (0.05, 0.5) → left; (0.95, 0.5) → right; (0.5, 0.05) → top; (0.5, 0.95) → bottom; (0.5, 0.5) y (0.6, 0.62) → center. Con `{x:0.5,y:0,w:0.5,h:1}`: (0.55, 0.5) → left.
  - `zoneRect({x:0,y:0,w:1,h:1}, "right")` → `{x:0.5,y:0,w:0.5,h:1}`; `"top"` → `{x:0,y:0,w:1,h:0.5}`; `"center"` → el mismo.
  - `paneAt`: dos rectángulos lado a lado; (0.75, 0.5) → el segundo; (1.5, 0.5) → `undefined`.
  - `snapRatio(0.49, 800)` → 0.5; `snapRatio(0.47, 800)` → 0.47; `snapRatio(0.34, 600)` → 1/3; `snapRatio(0.9, 1000)` → 0.9.
  - `paneBusy`: integrada y corriendo → true; integrada y quieta → false; sin integración con `fgProcess: "ping"` → true; `exited: true` con `running: true` → false.
- [ ] **Step 2: correr** `npx vitest run src/layout src/panels/agentState.test.ts` → FAIL.
- [ ] **Step 3: implementar** las cinco funciones con esas firmas.
- [ ] **Step 4: correr** lo mismo → PASS.
- [ ] **Step 5: commit** «Paneles: zonas para soltar, frenado del divisor y panel ocupado».

### Task 3: barrita con dividir y cerrar, y menú del clic derecho

**Files:**
- Create: `src/layout/PaneBar.tsx`
- Modify: `src/layout/Workspace.tsx`, `src/browser/BrowserView.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `paneBusy` (Task 2), `equalize` (Task 1), `SplitDir`.
- Produces:
  - `PaneBar(props: { title: string; highlight: boolean; onSplit: (dir: SplitDir) => void; onClose: () => void; onGrab: (e: PointerEvent) => void; onMenu: (e: MouseEvent) => void })`
  - `PaneMenu(props: { x: number; y: number; onSplit: (dir: SplitDir) => void; onEqualize: () => void; onClose: () => void; onDismiss: () => void })` — usa la clase `.ctx-menu` (ya está en `FLOATING`), se cierra con clic afuera o Esc, aplica la acción antes de cerrarse.
  - En Workspace: `splitAt(tabId: string, paneId: string, dir: SplitDir | "auto")` (el cuerpo actual de `doSplit`, que pasa a llamarla con el panel activo), `askClose(tabId: string, paneId: string)`, `paneLabel(paneId: string): string` (sale de `targetsOf`, que pasa a usarla).
  - BrowserView: props opcionales nuevas `onSplit?: (dir: SplitDir) => void`, `onGrab?: (e: PointerEvent) => void`, `onMenu?: (e: MouseEvent) => void`.

- [ ] **Step 1: `PaneBar.tsx`** con la barra: título (con elipsis) a la izquierda y tres `icon-btn`: `⇥` title «Dividir a la derecha», `⤓` «Dividir abajo», `✕` «Cerrar el panel». Los botones cortan `pointerdown` (`stopPropagation`) para no empezar un arrastre. `pointerdown` en la barra → `onGrab`; `contextmenu` → `onMenu` (con `preventDefault`). Clase `highlight` cuando el panel está enfocado y hay 2 o más.
- [ ] **Step 2: `PaneMenu`** en el mismo archivo con los ítems, en este orden: «Dividir a la derecha», «Dividir abajo», «Igualar tamaños», «Cerrar panel» (clase `danger`).
- [ ] **Step 3: Workspace.** El `.pane` de terminal queda `<PaneBar/>` + `<div class="pane-body"><TerminalView …/></div>` (mismo `For` por id, sin otro nivel que se vuelva a montar). `onGrab` por ahora solo enfoca el panel. `askClose`: si `paneBusy(panes[paneId])`, `confirm("¿Cerrar este panel? Se corta lo que está corriendo en él (" + paneLabel(paneId) + ").")`; si no, cierra directo. ✕ y «Cerrar panel» usan `askClose`; Ctrl+Shift+W sigue con `closePane` directo. «Igualar tamaños» → `M.equalize`. Señal `paneMenu: { x; y; tabId; paneId } | null` con la posición acotada a la ventana como en `TabBar`.
- [ ] **Step 4: BrowserView.** Al principio de `.bp-bar`: `<span class="bp-grip" title="Arrastrar para mover el panel">⋮⋮</span>` con `onPointerDown={props.onGrab}` y `onContextMenu={props.onMenu}`; antes del ×, los botones ⇥ y ⤓ (`props.onSplit`). Workspace se los pasa (cerrar el navegador no pregunta).
- [ ] **Step 5: CSS.** `.pane-bar`: arriba, 22 px de alto, `var(--bar)`, borde de abajo `var(--line)`, texto 11.5 px `var(--muted)`, `cursor: grab`; `.pane-bar.highlight`: texto `var(--text)` y una línea de 2 px arriba con `var(--accent)`. `.pane-body`: `position: absolute; top: 22px; left: 0; right: 0; bottom: 0`. `.bp-grip`: `cursor: grab`, `var(--muted)`.
- [ ] **Step 6: verificar** `npx tsc --noEmit` y `npx vitest run` → sin errores, todo PASS.
- [ ] **Step 7: commit** «Paneles: barrita con dividir y cerrar, y menú del clic derecho».

### Task 4: mover paneles arrastrando la barrita

**Files:**
- Create: `src/layout/paneDrag.ts`
- Modify: `src/layout/Workspace.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `paneAt`, `dropZone`, `zoneRect` (Task 2), `movePane` (Task 1), `onGrab` de PaneBar/BrowserView (Task 3).
- Produces: `export const DRAG_THRESHOLD_PX = 5` y `startPaneDrag(o: { e: PointerEvent; container: HTMLElement; paneId: string; rects: () => Map<string, Rect>; onHover: (h: { target: string; zone: DropZone } | null) => void; onDrop: (target: string, zone: DropZone) => void; onClick: () => void }): void`

- [ ] **Step 1: `paneDrag.ts`.** Solo botón izquierdo. Escucha en `window` `pointermove`, `pointerup`, `pointercancel`, `keydown` (Esc) y `blur`. Hasta pasar 5 px (`Math.hypot`) no hace nada, y si se suelta antes llama a `onClick`. Al pasar el umbral: `body.classList.add("resizing", "pane-dragging")`. Cada movimiento: punto relativo al `container` (0..1), `paneAt`; si es otro panel → `onHover({ target, zone: dropZone(...) })`, si no `onHover(null)`. `pointerup` con destino → `onDrop`. Esc, `pointercancel` y `blur` cancelan sin mover. Siempre limpia las clases del body, los listeners y llama a `onHover(null)`.
- [ ] **Step 2: Workspace.** `onGrab` de cada panel (terminal y navegador) → `startPaneDrag` con el `.tab-view` de esa pestaña y `M.paneRects(tab.root)`; `onClick` enfoca el panel; `onDrop` → `update((x) => M.movePane(x, tabId, paneId, target, zone))`. Señal `dropHint: { tabId: string; rect: Rect; center: boolean } | null`, que pinta `<div class="pane-drop" classList={{ center }}>` en la `.tab-view` de esa pestaña, con `zoneRect` en porcentajes (`pct`).
- [ ] **Step 3: CSS.** `body.pane-dragging, body.pane-dragging * { cursor: grabbing !important; }`. `.pane-drop`: absoluto, `z-index: 6`, `pointer-events: none`, borde 2 px `var(--accent)`, fondo `color-mix(in srgb, var(--accent) 18%, transparent)`, `border-radius: 4px`, `transition` corta. `.pane-drop.center::after`: «⇄» centrado.
- [ ] **Step 4: verificar** `npx tsc --noEmit` y `npx vitest run` → OK.
- [ ] **Step 5: commit** «Paneles: mover arrastrando la barrita (mitades o intercambio)».

### Task 5: divisores más fáciles de agarrar, con frenado y doble clic

**Files:**
- Modify: `src/layout/Workspace.tsx` (`startDrag` y el `For` de divisores), `src/styles.css`

**Interfaces:**
- Consumes: `snapRatio` (Task 2), `setRatio` (existente).

- [ ] **Step 1:** en `startDrag`, la proporción pasa por `M.snapRatio(ratio, extentPx)` con `extentPx = box.width * area.rect.w` (row) o `box.height * area.rect.h` (column).
- [ ] **Step 2:** el divisor tiene `onDblClick` → `M.setRatio(x, tabId, area.id, 0.5)` y `title` «Arrastrar para cambiar el tamaño · doble clic: mitad y mitad».
- [ ] **Step 3: CSS.** Zona para agarrar de 9 px (`.divider.row { width: 9px; margin-left: -4px }`, `::before` en 4 px; lo mismo en column); al pasar el mouse la línea se ve de 3 px con `var(--accent)`.
- [ ] **Step 4: verificar** `npx tsc --noEmit` y `npx vitest run` → OK.
- [ ] **Step 5: commit** «Paneles: divisor más ancho, se frena en ⅓ ½ ⅔ y doble clic iguala».

### Task 6: prueba real, documentación y build para Bruno

**Files:**
- Modify: `docs/es/Process_Report.md`, `CLAUDE.md`, `docs/es/Code_Guide.txt`
- Create: `C:\Users\Br1\Desktop\AlphaTerm prueba (paneles).bat` (CRLF)

- [ ] **Step 1: build de prueba.** `npx tauri build --no-bundle` con `CARGO_TARGET_DIR=target\prueba` (y `~/.cargo/bin` al frente del PATH). Abrirlo con `ALPHATERM_DATA_DIR` y `WEBVIEW2_USER_DATA_FOLDER` propios en `%LOCALAPPDATA%\AlphaTerm\prueba-paneles` y `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`.
- [ ] **Step 2: pruebas por CDP** (Runtime.evaluate + Input.dispatchMouseEvent; diálogos con Page.handleJavaScriptDialog), cada una con su resultado anotado:
  - ⇥ y ⤓ dividen el panel de esa barrita; ✕ sin nada corriendo cierra sin preguntar.
  - Con `ping -t localhost` corriendo, ✕ y «Cerrar panel» del menú preguntan; Cancelar no cierra.
  - Marcar el `.xterm` de un panel con `dataset`, correr `ping -t localhost`, arrastrarlo a la mitad de otro panel: la marca sigue en el mismo nodo (no se volvió a montar) y el ping sigue escribiendo.
  - Soltar en el centro intercambia; Esc a mitad de arrastre no mueve nada; `blur` a mitad de arrastre deja el body sin `resizing` ni `pane-dragging`.
  - Con un navegador en la pestaña: durante el arrastre está escondido y al soltar vuelve a verse.
  - Clic en ⇥ no deja `pane-dragging` en el body.
  - El divisor soltado cerca de ⅓ queda en ⅓ exacto; doble clic lo deja en ½.
  - Cerrar y volver a abrir la prueba: la distribución movida se recupera.
- [ ] **Step 3: documentar.** Informe: entrada «23/11/2026 — Paneles: barrita, mover y divisores», con lo hecho y lo verificado (lo no verificado, marcado). `CLAUDE.md`: en Gotchas, la barrita de 22 px y `.pane-body`, y que el arrastre usa `resizing` para esconder el navegador. Guía de código: `PaneBar.tsx` y `paneDrag.ts`.
- [ ] **Step 4: verificación final** `npx vitest run` y `npx tsc --noEmit` → todo PASS.
- [ ] **Step 5: commit** «Informe: paneles con barrita, mover y divisores».
- [ ] **Step 6: el .bat** «AlphaTerm prueba (paneles).bat» en el escritorio, con CRLF, que abre `src-tauri\target\prueba\release\alphaterm.exe` con los datos de prueba (como el de predicciones). Avisarle a Bruno para que lo pruebe.
- [ ] **Step 7: si Bruno lo aprueba**, merge a `main` y `build-release.bat --minor` (0.6.0). Si no, se ajusta en la rama. Limpiar lo de prueba solo con su permiso.
