# Painéis: barra com botões e mover como snap — plano de implementação

> Traduzido do original em espanhol (`docs/es/specs/2026-11-23-pane-bar-and-snap-plan.md`). A versão em espanhol é a fonte de verdade.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barrinha com dividir/fechar em cada painel, menu com clique direito, mover painéis arrastando (metades ou troca) e divisores que param em ⅓, ½, ⅔.

**Architecture:** Tudo no frontend (sem mudanças no Rust). As operações sobre a árvore de painéis e a geometria das zonas são funções puras em `src/layout/model.ts` com testes; a barra e o menu são um componente novo (`PaneBar.tsx`); o arraste é um controlador de eventos de ponteiro (`paneDrag.ts`) que o Workspace conecta ao modelo. Mover = mudar a árvore; os painéis continuam sendo iterados por id, então nenhuma terminal é recriada.

**Tech Stack:** SolidJS 1.9 + TypeScript, Vitest, Tauri 2 (sem tocar), xterm 6.

**Spec:** `docs/pt/specs/2026-11-23-pane-bar-and-snap-design.md`

## Global Constraints

- Sem mudanças em `src-tauri` (Rust). Branch de trabalho: `paneles`, a partir de `main`.
- Painéis de terminal: são iterados por id e posicionados por retângulos. Nunca envolver `TerminalView` em algo que possa ser remontado ao mudar a árvore (mata a shell e o agente).
- Nada da interface pode cobrir o WebView2 do navegador: o que é flutuante vai em `FLOATING` (`src/browser/marks.ts`); durante um arraste usa-se a classe `resizing` do body, que já o esconde.
- O clique direito dentro da terminal continua sendo copiar/colar; o menu novo fica na barrinha.
- Não mudar nem remover atalhos existentes. Nada com Ctrl+Alt.
- Textos da interface em espanhol rioplatense, com os textos exatos deste plano.
- Solid: em menus, aplicar a ação antes de fechá-lo (padrão `act` de `TabBar.tsx`); em efeitos que leem e escrevem, `untrack`/`on`.
- Não fechar o AlphaTerm do Bruno. Os testes de interface vão em uma instância à parte (veja Task 6). O Rust está fora do PATH: anteponha `~/.cargo/bin`.
- Os `.bat`, com CRLF.

## Review Focus

1. Arrastar por cima de um painel de navegador: o WebView2 é escondido durante o arraste e volta a aparecer ao soltar ou cancelar (Task 4, teste CDP).
2. O arraste é interrompido sem `pointerup` (sai da janela, `pointercancel`, a janela perde o foco): o body não pode ficar com `resizing` e os painéis sem receber cliques (Task 4, teste CDP com `blur`).
3. Clique em ⇥, ⤓ ou ✕ não inicia um arraste nem o dispara o limiar (Task 3/4, teste CDP).
4. "Fechar painel" pelo menu com um comando rodando também pergunta, igual ao ✕ (Task 3, teste CDP).
5. Uma distribuição movida sobrevive a fechar e voltar a abrir (sessão) (Task 1, teste de sessão).

---

### Task 1: mover, trocar e igualar no modelo

**Files:**
- Modify: `src/layout/model.ts`
- Test: `src/layout/model.test.ts`, `src/layout/session.test.ts`

**Interfaces:**
- Produces:
  - `export type DropZone = "left" | "right" | "top" | "bottom" | "center"`
  - `movePane(l: Layout, tabId: string, paneId: string, targetId: string, zone: DropZone): Layout`
  - `swapPanes(l: Layout, tabId: string, aId: string, bId: string): Layout`
  - `equalize(l: Layout, tabId: string): Layout`

- [ ] **Step 1: criar o branch** — `git switch -c paneles` em `Desktop\AlphaTerm`.
- [ ] **Step 2: testes que falham** em `model.test.ts`, `describe("mover paneles")`:
  - "à esquerda de outro": A|B (`splitPane` row), `movePane(l, t, B, A, "left")` → `leaves` = `[B, A]`, `root.dir === "row"`, `root.ratio === 0.5`, `activePane === B`.
  - "embaixo com três painéis": A | (B sobre C); mover A para `"bottom"` de C → `leaves` = `[B, C, A]`; `paneRects(root).get(A)` ≈ `{ x: 0, y: 0.75, w: 1, h: 0.25 }` (`toBeCloseTo`).
  - "o centro troca e não mexe nas proporções": A|B|C com `setRatio` 0.3 na raiz; `movePane(..., A, C, "center")` → `leaves` = `[C, B, A]` e a raiz continua com `ratio === 0.3`.
  - "sobre si mesmo, com um painel só ou com ids que não existem não muda nada": o resultado é a mesma referência (`toBe(l)`).
  - "mover não cria painéis": depois de mover, `findLeaf(root, B.id)` é `toEqual` à folha original (mesmo id, perfil, pasta, startup).
  - "igualar": A | (B | C) com proporções de fábrica → `equalize` → as três larguras de `paneRects` ≈ 1/3; A | (B sobre C) → larguras de A e de B ≈ 0.5, e B e C com altura ≈ 0.5.
- [ ] **Step 3: teste de sessão que falha** em `session.test.ts`: "guarda a distribuição movida": A|B, `movePane(B → "left" de A)`, `restore(JSON.parse(JSON.stringify(serialize(l, () => undefined))), opts)` → `leaves` = `[B, A]`.
- [ ] **Step 4: rodar** `npx vitest run src/layout` → FAIL (funções não definidas).
- [ ] **Step 5: implementar** em `model.ts`. `movePane`: com `"center"` chama `swapPanes`; se não, `removeLeaf` do painel e `replaceNode` do destino por uma divisão nova (`newId("s")`, ratio 0.5): `left` → row, a = movido; `right` → row, b = movido; `top` → column, a = movido; `bottom` → column, b = movido. O movido fica ativo. `swapPanes`: troca as duas folhas de lugar na árvore (as divisões ficam iguais). `equalize`: cada divisão toma `ratio = n(a) / (n(a) + n(b))`, onde n conta painéis ao longo do seu eixo: folha = 1; divisão no mesmo eixo = soma; no outro eixo = máximo. Limitar a [0.1, 0.9] como `setRatio`.
- [ ] **Step 6: rodar** `npx vitest run src/layout` → PASS.
- [ ] **Step 7: commit** "Paneles: mover, intercambiar e igualar en el modelo".

### Task 2: geometria das zonas, freio do divisor e painel ocupado

**Files:**
- Modify: `src/layout/model.ts`, `src/panels/agentState.ts`
- Test: `src/layout/model.test.ts`, `src/panels/agentState.test.ts`

**Interfaces:**
- Consumes: `DropZone`, `Rect` (Task 1 / existente).
- Produces:
  - `paneAt(rects: Map<string, Rect>, fx: number, fy: number): string | undefined` — o painel cujo retângulo contém o ponto (mesmas unidades).
  - `dropZone(r: Rect, fx: number, fy: number): DropZone` — centro se `|u-0.5| <= 0.2 && |v-0.5| <= 0.2` (u, v = posição relativa dentro de `r`); se não, a borda mais próxima.
  - `zoneRect(r: Rect, zone: DropZone): Rect` — a metade do lado; `center` = `r` inteiro.
  - `export const SNAP_POINTS = [1 / 3, 1 / 2, 2 / 3]` e `snapRatio(ratio: number, extentPx: number, thresholdPx = 12): number` — o ponto mais próximo se estiver a `<= thresholdPx` pixels; se não, `ratio`.
  - `paneBusy(p: AgentPaneInfo): boolean` em `agentState.ts` = `!p.exited && agentRunning(p)`.

- [ ] **Step 1: testes que falham**:
  - `dropZone` com `{x:0,y:0,w:1,h:1}`: (0.05, 0.5) → left; (0.95, 0.5) → right; (0.5, 0.05) → top; (0.5, 0.95) → bottom; (0.5, 0.5) e (0.6, 0.62) → center. Com `{x:0.5,y:0,w:0.5,h:1}`: (0.55, 0.5) → left.
  - `zoneRect({x:0,y:0,w:1,h:1}, "right")` → `{x:0.5,y:0,w:0.5,h:1}`; `"top"` → `{x:0,y:0,w:1,h:0.5}`; `"center"` → o mesmo.
  - `paneAt`: dois retângulos lado a lado; (0.75, 0.5) → o segundo; (1.5, 0.5) → `undefined`.
  - `snapRatio(0.49, 800)` → 0.5; `snapRatio(0.47, 800)` → 0.47; `snapRatio(0.34, 600)` → 1/3; `snapRatio(0.9, 1000)` → 0.9.
  - `paneBusy`: integrada e rodando → true; integrada e parada → false; sem integração com `fgProcess: "ping"` → true; `exited: true` com `running: true` → false.
- [ ] **Step 2: rodar** `npx vitest run src/layout src/panels/agentState.test.ts` → FAIL.
- [ ] **Step 3: implementar** as cinco funções com essas assinaturas.
- [ ] **Step 4: rodar** o mesmo → PASS.
- [ ] **Step 5: commit** "Paneles: zonas para soltar, frenado del divisor y panel ocupado".

### Task 3: barrinha com dividir e fechar, e menu do clique direito

**Files:**
- Create: `src/layout/PaneBar.tsx`
- Modify: `src/layout/Workspace.tsx`, `src/browser/BrowserView.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `paneBusy` (Task 2), `equalize` (Task 1), `SplitDir`.
- Produces:
  - `PaneBar(props: { title: string; highlight: boolean; onSplit: (dir: SplitDir) => void; onClose: () => void; onGrab: (e: PointerEvent) => void; onMenu: (e: MouseEvent) => void })`
  - `PaneMenu(props: { x: number; y: number; onSplit: (dir: SplitDir) => void; onEqualize: () => void; onClose: () => void; onDismiss: () => void })` — usa a classe `.ctx-menu` (já está em `FLOATING`), fecha com clique fora ou Esc, aplica a ação antes de fechar.
  - No Workspace: `splitAt(tabId: string, paneId: string, dir: SplitDir | "auto")` (o corpo atual de `doSplit`, que passa a chamá-la com o painel ativo), `askClose(tabId: string, paneId: string)`, `paneLabel(paneId: string): string` (sai de `targetsOf`, que passa a usá-la).
  - BrowserView: novas props opcionais `onSplit?: (dir: SplitDir) => void`, `onGrab?: (e: PointerEvent) => void`, `onMenu?: (e: MouseEvent) => void`.

- [ ] **Step 1: `PaneBar.tsx`** com a barra: título (com reticências) à esquerda e três `icon-btn`: `⇥` title "Dividir a la derecha", `⤓` "Dividir abajo", `✕` "Cerrar el panel". Os botões cortam o `pointerdown` (`stopPropagation`) para não iniciar um arraste. `pointerdown` na barra → `onGrab`; `contextmenu` → `onMenu` (com `preventDefault`). Classe `highlight` quando o painel está em foco e há 2 ou mais.
- [ ] **Step 2: `PaneMenu`** no mesmo arquivo com os itens, nesta ordem: "Dividir a la derecha", "Dividir abajo", "Igualar tamaños", "Cerrar panel" (classe `danger`).
- [ ] **Step 3: Workspace.** O `.pane` de terminal fica `<PaneBar/>` + `<div class="pane-body"><TerminalView …/></div>` (mesmo `For` por id, sem outro nível que seja remontado). `onGrab` por enquanto só dá foco ao painel. `askClose`: se `paneBusy(panes[paneId])`, `confirm("¿Cerrar este panel? Se corta lo que está corriendo en él (" + paneLabel(paneId) + ").")`; se não, fecha direto. ✕ e "Cerrar panel" usam `askClose`; Ctrl+Shift+W continua com `closePane` direto. "Igualar tamaños" → `M.equalize`. Sinal `paneMenu: { x; y; tabId; paneId } | null` com a posição limitada à janela como em `TabBar`.
- [ ] **Step 4: BrowserView.** No começo de `.bp-bar`: `<span class="bp-grip" title="Arrastrar para mover el panel">⋮⋮</span>` com `onPointerDown={props.onGrab}` e `onContextMenu={props.onMenu}`; antes do ×, os botões ⇥ e ⤓ (`props.onSplit`). O Workspace os passa (fechar o navegador não pergunta).
- [ ] **Step 5: CSS.** `.pane-bar`: em cima, 22 px de altura, `var(--bar)`, borda de baixo `var(--line)`, texto 11.5 px `var(--muted)`, `cursor: grab`; `.pane-bar.highlight`: texto `var(--text)` e uma linha de 2 px em cima com `var(--accent)`. `.pane-body`: `position: absolute; top: 22px; left: 0; right: 0; bottom: 0`. `.bp-grip`: `cursor: grab`, `var(--muted)`.
- [ ] **Step 6: verificar** `npx tsc --noEmit` e `npx vitest run` → sem erros, tudo PASS.
- [ ] **Step 7: commit** "Paneles: barrita con dividir y cerrar, y menú del clic derecho".

### Task 4: mover painéis arrastando a barrinha

**Files:**
- Create: `src/layout/paneDrag.ts`
- Modify: `src/layout/Workspace.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `paneAt`, `dropZone`, `zoneRect` (Task 2), `movePane` (Task 1), `onGrab` de PaneBar/BrowserView (Task 3).
- Produces: `export const DRAG_THRESHOLD_PX = 5` e `startPaneDrag(o: { e: PointerEvent; container: HTMLElement; paneId: string; rects: () => Map<string, Rect>; onHover: (h: { target: string; zone: DropZone } | null) => void; onDrop: (target: string, zone: DropZone) => void; onClick: () => void }): void`

- [ ] **Step 1: `paneDrag.ts`.** Só botão esquerdo. Escuta em `window` `pointermove`, `pointerup`, `pointercancel`, `keydown` (Esc) e `blur`. Até passar 5 px (`Math.hypot`) não faz nada, e se soltar antes chama `onClick`. Ao passar o limiar: `body.classList.add("resizing", "pane-dragging")`. A cada movimento: ponto relativo ao `container` (0..1), `paneAt`; se for outro painel → `onHover({ target, zone: dropZone(...) })`, se não `onHover(null)`. `pointerup` com destino → `onDrop`. Esc, `pointercancel` e `blur` cancelam sem mover. Sempre limpa as classes do body, os listeners e chama `onHover(null)`.
- [ ] **Step 2: Workspace.** `onGrab` de cada painel (terminal e navegador) → `startPaneDrag` com o `.tab-view` dessa aba e `M.paneRects(tab.root)`; `onClick` dá foco ao painel; `onDrop` → `update((x) => M.movePane(x, tabId, paneId, target, zone))`. Sinal `dropHint: { tabId: string; rect: Rect; center: boolean } | null`, que pinta `<div class="pane-drop" classList={{ center }}>` no `.tab-view` dessa aba, com `zoneRect` em porcentagens (`pct`).
- [ ] **Step 3: CSS.** `body.pane-dragging, body.pane-dragging * { cursor: grabbing !important; }`. `.pane-drop`: absoluto, `z-index: 6`, `pointer-events: none`, borda 2 px `var(--accent)`, fundo `color-mix(in srgb, var(--accent) 18%, transparent)`, `border-radius: 4px`, `transition` curta. `.pane-drop.center::after`: "⇄" centralizado.
- [ ] **Step 4: verificar** `npx tsc --noEmit` e `npx vitest run` → OK.
- [ ] **Step 5: commit** "Paneles: mover arrastrando la barrita (mitades o intercambio)".

### Task 5: divisores mais fáceis de agarrar, com freio e clique duplo

**Files:**
- Modify: `src/layout/Workspace.tsx` (`startDrag` e o `For` de divisores), `src/styles.css`

**Interfaces:**
- Consumes: `snapRatio` (Task 2), `setRatio` (existente).

- [ ] **Step 1:** em `startDrag`, a proporção passa por `M.snapRatio(ratio, extentPx)` com `extentPx = box.width * area.rect.w` (row) ou `box.height * area.rect.h` (column).
- [ ] **Step 2:** o divisor tem `onDblClick` → `M.setRatio(x, tabId, area.id, 0.5)` e `title` "Arrastrar para cambiar el tamaño · doble clic: mitad y mitad".
- [ ] **Step 3: CSS.** Zona para agarrar de 9 px (`.divider.row { width: 9px; margin-left: -4px }`, `::before` em 4 px; o mesmo em column); ao passar o mouse a linha aparece com 3 px com `var(--accent)`.
- [ ] **Step 4: verificar** `npx tsc --noEmit` e `npx vitest run` → OK.
- [ ] **Step 5: commit** "Paneles: divisor más ancho, se frena en ⅓ ½ ⅔ y doble clic iguala".

### Task 6: teste real, documentação e build para o Bruno

**Files:**
- Modify: `docs/es/Process_Report.md`, `CLAUDE.md`, `docs/es/Code_Guide.txt`
- Create: `C:\Users\Br1\Desktop\AlphaTerm prueba (paneles).bat` (CRLF)

- [ ] **Step 1: build de teste.** `npx tauri build --no-bundle` com `CARGO_TARGET_DIR=target\prueba` (e `~/.cargo/bin` na frente do PATH). Abri-lo com `ALPHATERM_DATA_DIR` e `WEBVIEW2_USER_DATA_FOLDER` próprios em `%LOCALAPPDATA%\AlphaTerm\prueba-paneles` e `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`.
- [ ] **Step 2: testes por CDP** (Runtime.evaluate + Input.dispatchMouseEvent; diálogos com Page.handleJavaScriptDialog), cada um com seu resultado anotado:
  - ⇥ e ⤓ dividem o painel dessa barrinha; ✕ sem nada rodando fecha sem perguntar.
  - Com `ping -t localhost` rodando, ✕ e "Cerrar panel" do menu perguntam; Cancelar não fecha.
  - Marcar o `.xterm` de um painel com `dataset`, rodar `ping -t localhost`, arrastá-lo para a metade de outro painel: a marca continua no mesmo nó (não foi remontado) e o ping continua escrevendo.
  - Soltar no centro troca; Esc no meio de um arraste não move nada; `blur` no meio de um arraste deixa o body sem `resizing` nem `pane-dragging`.
  - Com um navegador na aba: durante o arraste está escondido e ao soltar volta a aparecer.
  - Clique em ⇥ não deixa `pane-dragging` no body.
  - O divisor solto perto de ⅓ fica em ⅓ exato; clique duplo o deixa em ½.
  - Fechar e voltar a abrir o teste: a distribuição movida é recuperada.
- [ ] **Step 3: documentar.** Relatório: entrada "23/11/2026 — Paneles: barrita, mover y divisores", com o que foi feito e verificado (o não verificado, marcado). `CLAUDE.md`: em Gotchas, a barrinha de 22 px e `.pane-body`, e que o arraste usa `resizing` para esconder o navegador. Guia de código: `PaneBar.tsx` e `paneDrag.ts`.
- [ ] **Step 4: verificação final** `npx vitest run` e `npx tsc --noEmit` → tudo PASS.
- [ ] **Step 5: commit** "Informe: paneles con barrita, mover y divisores".
- [ ] **Step 6: o .bat** "AlphaTerm prueba (paneles).bat" na área de trabalho, com CRLF, que abre `src-tauri\target\prueba\release\alphaterm.exe` com os dados de teste (como o de sugestões). Avisar o Bruno para que ele teste.
- [ ] **Step 7: se o Bruno aprovar**, merge em `main` e `build-release.bat --minor` (0.6.0). Se não, ajusta-se no branch. Limpar o que é de teste só com a permissão dele.
