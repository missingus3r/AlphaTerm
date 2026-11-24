# Sugestões de comandos — plano de implementação

> Traduzido do original em espanhol (`Documentacion/specs/2026-11-21-predicciones-plan.md`). A versão em espanhol é a fonte de verdade.

> Para quem executar: tarefas em ordem, com caixas `- [ ]`. Branch `predicciones`.

**Objetivo:** menu de sugestões embaixo do cursor no cmd e no PowerShell (pastas, histórico,
catálogo próprio e completamentos da sessão do PowerShell), sem mexer em ↑ nem em Tab/Enter/Esc fora do menu.

**Arquitetura:** lógica pura em `src/suggest/` (ler a linha, catálogo, motor, teclas, inserção,
mensagens do PowerShell), um controlador que a conecta ao xterm do `TerminalView`, um componente
de menu, comandos novos em `src-tauri/src/suggest.rs` e um handler do PSReadLine em `alphaterm.ps1`.

**Tecnologia:** SolidJS 1.9 + xterm 6, Tauri 2 / Rust, PowerShell 5.1 + PSReadLine 2.0, vitest.

**Design:** `Documentacion/pt/specs/2026-11-21-sugestoes-de-comandos.md` (ler junto com este plano).

## Restrições globais

- Todas as escritas na shell por `PtySession.write` (WriteQueue). Nunca atalhos com Ctrl+Alt.
- Enter = `String.fromCharCode(13)`; backspace = `"\x7f"` (o que o xterm envia).
- Só perfis `cmd`, `powershell`, `pwsh`. Cursor no fim do que foi digitado; uma só linha lógica.
- Sem shell no meio para o que o app monta (git/docker pela CLI, como hoje).
- Descrições e textos visíveis em espanhol.
- Atalho escondido: `F12,e` (o xterm envia F12 como `\x1b[24~`). OSC própria `7717`:
  `ESC]7717;ready;<nonce>BEL` e `ESC]7717;c;<nonce>;<base64 de JSON UTF-8>BEL`.
  JSON: `{"b":buffer,"c":cursor,"i":ReplacementIndex,"l":ReplacementLength,"r":[{"t":CompletionText,"s":ListItemText,"k":ResultType,"d":ToolTip≤200}]}`, até 100 resultados.
- Nonce: variável `ALPHATERM_NONCE` que a view envia ao iniciar a shell; o script a lê e a apaga.
- Limiares: pedir ao PowerShell após 150 ms sem teclas; rebaixar a aba para "só Ctrl+Espaço" se uma
  resposta demorar > 300 ms; primeira palavra com ≥ 2 letras (≥ 3 para pedir ao PowerShell);
  argumentos de caminho com ≥ 1 letra; 8 linhas visíveis; 500 entradas por pasta; cache de pasta 3 s.
- Não fechar o AlphaTerm do Bruno. Testes de interface com `CARGO_TARGET_DIR=target\prueba` e
  `ALPHATERM_DATA_DIR`/`WEBVIEW2_USER_DATA_FOLDER` próprios.

## Foco de revisão (o que mais pode morder)

1. Enter com o menu aberto sem navegar: tem que executar, e o `keypress` do Enter não pode
   escapar quando o menu o tomou (o xterm processa `keypress` à parte) → teste na Tarefa 5.
2. Teclas digitadas que a shell ainda não mostrou ao aceitar uma sugestão → a inserção espera o
   eco (Tarefa 7).
3. Um programa ou agente rodando no cmd (iniciado pelo painel de agentes, que escreve com Enter) →
   o estado "no prompt" é desligado por qualquer Enter escrito (Tarefa 7).
4. Pastas com espaços e aspas já abertas → Tarefa 6.
5. Respostas do PowerShell antigas ou falsas (outro texto com 7717) → nonce e buffer (Tarefa 2).

---

### Task 1: handler do PowerShell e teste real pela ConPTY (risco 1, vai primeiro)

**Arquivos:** `src-tauri/shell/alphaterm.ps1`, teste em `src-tauri/src/pty/mod.rs` (`integration_tests`).

- [ ] Teste `powershell_completa_con_f12`: `spawn_env` de `powershell` com `ALPHATERM_NONCE=abc123`
  e cwd com uma pasta conhecida; esperar `\x1b]7717;ready;abc123`; escrever `Get-ChildIt` e
  depois `\x1b[24~e`; esperar `\x1b]7717;c;abc123;`, decodificar o base64 e verificar
  `b == "Get-ChildIt"`, `c == 11`, e que `r` tenha `Get-ChildItem`. Segundo caso: `cd ` + atalho →
  há pelo menos um `ProviderContainer`. Que `$env:ALPHATERM_NONCE` fique vazio na sessão.
- [ ] Rodá-lo: falha (não há handler).
- [ ] Handler com `Set-PSReadLineKeyHandler -Chord 'F12,e'` (só se existir o PSReadLine e houver nonce),
  `GetBufferState` + `TabExpansion2`, `ConvertTo-Json -Compress -Depth 4`, `[Console]::Write` da OSC.
  `ready` é emitido a cada prompt (dentro de `prompt`) se o handler ficou registrado.
- [ ] Rodá-lo: passa. **Se não passar pela ConPTY, parar e avisar o Bruno (plano B ou sem a abordagem 2).**
- [ ] Commit.

### Task 2: mensagens do PowerShell no frontend

**Arquivos:** `src/suggest/pwsh.ts`, `src/suggest/pwsh.test.ts`.
**Produz:** `parse7717(data: string, nonce: string): PsMsg | null` com
`PsMsg = { type: "ready" } | { type: "completions"; buffer: string; cursor: number; index: number; length: number; results: PsResult[] }`,
`PsResult = { text: string; label: string; kind: string; tip: string }`. `PS_CHORD = "\x1b[24~e"`.

- [ ] Testes: ready válido; nonce diferente → null; base64 quebrado → null; JSON com 2 resultados → campos mapeados.
- [ ] Implementar e passar. Commit.

### Task 3: ler a linha e separar palavras

**Arquivos:** `src/suggest/line.ts`, `src/suggest/line.test.ts`.
**Produz:**
- `readInput(buf: BufLike, start: { line: number; x: number }, cur: { line: number; x: number }, cols: number): string | null`
  (`BufLike = { getLine(i): { isWrapped: boolean; translateToString(trim: boolean, s?: number, e?: number): string } | undefined }`);
  null se o cursor está antes do início ou há uma linha não quebrada no meio.
- `parseLine(line: string): Parsed` com `Parsed = { words: Word[]; current: Word; index: number }`,
  `Word = { raw: string; value: string; start: number; quote: '"' | "'" | null; closed: boolean }`
  (a atual é vazia com `start = line.length` se a linha termina em espaço fora de aspas).

- [ ] Testes: `"cd "` → current vazia índice 1; `cd "Mis Doc` → value `Mis Doc`, quote `"`, closed false;
  `cd 'a b\'` → value `a b\`, closed true; linha quebrada em 2 linhas de tela; linha não quebrada no meio → null.
- [ ] Implementar e passar. Commit.

### Task 4: backend de sugestões (Rust)

**Arquivos:** `src-tauri/src/suggest.rs` (novo), `src-tauri/src/lib.rs` (registrar).
**Produz (comandos):**
- `suggest_list_dir(cwd: String, dir: String, dirs_only: bool, hidden: bool) -> Vec<DirEntry { name, dir }>`:
  `dir` relativo a `cwd`, absoluto ou com `~`; `\\…` → vazio; máx. 500, ordem alfabética sem distinguir maiúsculas, cache 3 s.
- `suggest_gateway() -> Option<String>`: `GetBestRoute` rumo a 8.8.8.8, próximo salto IPv4 (cache 60 s).
- `suggest_path_commands() -> Vec<String>`: executáveis do PATH completo (`agents::agents_path_env()`),
  extensões de `PATHEXT` + `.ps1`, sem extensão e sem repetir, cache 60 s.
- `suggest_npm_scripts(cwd: String) -> Vec<(String, String)>`: `scripts` do `package.json`.
- `suggest_processes() -> Vec<String>`: nomes de processos (sysinfo), sem repetir.

- [ ] Testes (`cargo test suggest`): pasta temporária com `a/`, `B/`, `c.txt`, `.oculta/` → ordem e filtros;
  `~` e `..`; caminho de rede vazio; `package.json` com 2 scripts; o gateway devolve IPv4 válido ou None.
- [ ] Implementar e passar. Commit.

### Task 5: teclas do menu

**Arquivos:** `src/suggest/keys.ts`, `src/suggest/keys.test.ts`.
**Produz:** `menuKey(e: KeyLike, st: { open: boolean; navigating: boolean; enabled: boolean }): MenuKey`
com `MenuKey = "pass" | "up" | "down" | "accept" | "close" | "open" | "toShell"` (`toShell` = fechar e deixar passar).
`KeyLike` de `src/terminal/keys.ts`.

- [ ] Testes: a tabela de teclas do design completa; Ctrl+Espaço com `enabled: false` → pass;
  Ctrl+Alt+qualquer coisa → pass; `keypress`/`keyup` → pass (quem o engole é o controlador, Tarefa 7).
- [ ] Implementar e passar. Commit.

### Task 6: catálogo, motor e inserção

**Arquivos:** `src/suggest/catalog.ts`, `src/suggest/engine.ts`, `src/suggest/insert.ts` e seus `.test.ts`.
**Produz:**
- `CmdSpec = { names: string[]; desc: string; shells?: Shell[]; subs?: CmdSpec[]; opts?: Opt[]; args?: ArgSource }`,
  `Opt = { name: string; desc: string; arg?: ArgSource }`, `ArgSource = GenName | Value[]`,
  `GenName = "folders" | "paths" | "hosts" | "gitBranches" | "gitRemotes" | "npmScripts" | "dockerContainers" | "dockerImages" | "processes"`,
  `Value = { v: string; desc?: string }`, `Shell = "cmd" | "ps"`. `findSpec(name, shell): CmdSpec | null`
  (sem distinguir maiúsculas, sem `.exe`). Lista de comandos do design.
- `Suggestion = { insert: string; label: string; desc?: string; kind: Kind; score: number; replace: "word" | "line"; dir?: boolean; hits?: number[] }`,
  `Kind = "folder" | "file" | "history" | "command" | "option" | "value" | "pwsh"`.
- `Sources = { listDir(dir: string, dirsOnly: boolean, hidden: boolean): Promise<{ name: string; dir: boolean }[]>; history(): Promise<HistEntry[]>; pathCommands(): Promise<string[]>; gen(name: GenName, cwd: string): Promise<Value[]> }`.
- `analyze(p: Parsed, shell: Shell): Analysis` (primeira palavra ou argumento, comando, spec, fonte do
  argumento, se convém pedir ao PowerShell, se aparece sozinho) e
  `collect(a: Analysis, ctx: { line: string; cwd: string; shell: Shell }, src: Sources, ps?: PsMsg): Promise<Suggestion[]>`
  com filtro, ordem e sem repetidos do design. Histórico filtrado por shell (`shell` contém
  "PowerShell" → ps; "Símbolo" ou "cmd" → cmd; null → as duas).
- `insertion(line: string, s: Suggestion, cur: Word, shell: Shell): string`: backspaces + texto; aspas
  se necessário (`"` no cmd, `'` no PowerShell); pasta → termina em `\`; o resto → espaço; `line` →
  apaga a linha inteira. Para resultados do PowerShell, backspaces = `cursor - index`.

- [ ] Testes: `ping ` → 8.8.8.8 e `-t` (com `gen` falso); `cd al` com pastas falsas → só pastas,
  primeiro as que começam com "al"; `git checkout ` → branches; `git p` com histórico → `git push origin main`
  primeiro, com mais pontuação se for da mesma pasta; histórico do cmd não aparece no ps; `Get-Ch` no ps →
  analysis pede ao PowerShell, `cd x` no ps → não; resultados do PowerShell + pastas locais sem repetir;
  inserção de `Mis Documentos` no cmd → `"Mis Documentos\"`, no ps → `'Mis Documentos\'`; substituição de
  palavra com aspas fechadas; linha de histórico → apaga tudo.
- [ ] Implementar e passar. Commit.

### Task 7: controlador, menu e conectá-lo à terminal

**Arquivos:** `src/suggest/controller.ts`, `src/suggest/SuggestMenu.tsx`, `src/suggest/generators.ts`,
`src/terminal/TerminalView.tsx`, `src/layout/Workspace.tsx`, `src/styles.css`, `src/browser/marks.ts`.
**Produz:** `createSuggest(o: { term: Terminal; profileId: string; write(s: string): void; cwd(): string | undefined; settings(): SuggestSettings; patchCmdCommand(line: string): void }): SuggestCtl`
com `SuggestCtl = { onPromptEnd(): void; onCommandStart(): void; onParsed(): void; onWrite(data: string): void; key(e: KeyboardEvent): boolean; onOsc7717(data: string): boolean; nonce: string; menu: Accessor<MenuView | null>; pick(i: number): void; dispose(): void }`.

- [ ] `TerminalView`: um único `write()` para tudo o que vai para a shell (onData, `send`, `runStartup`)
  que avisa `onWrite`; `ALPHATERM_NONCE` no env ao iniciar; `registerOscHandler(7717)`; `key()`
  antes de `props.match`; engolir o `keypress` que seguir a uma tecla tomada; renderizar `<SuggestMenu>`.
- [ ] cmd: Enter no prompt com linha não vazia → `running = true` + `patch({ lastCommand, running: true })`.
- [ ] Estado "no prompt" do design; eco pendente: se algo foi digitado depois do último `onWriteParsed`,
  a inserção espera o próximo (máx. 300 ms).
- [ ] Pedido ao PowerShell: debounce de 150 ms, nunca depois de Tab/Ctrl+R/teclas F, medir e rebaixar.
- [ ] `.suggest-menu` em `FLOATING`; estilos com as variáveis do tema.
- [ ] `npx tsc --noEmit` e `npx vitest run` passam. Commit.

### Task 8: configuração

**Arquivos:** `src/settings/schema.ts`, `src/settings/SettingsView.tsx`, `src/settings/settings.test.ts`.
**Produz:** `SuggestSettings = { enabled: boolean; mode: "auto" | "manual"; pwsh: boolean }` em
`Settings.terminal.suggest` (padrão `{ enabled: true, mode: "auto", pwsh: true }`).

- [ ] Teste: normalize de um settings antigo sem `suggest` → valores padrão; valores inválidos → padrão.
- [ ] Implementar, linhas em "Terminal e interfaz", passar. Commit.

### Task 9: teste real, relatório e build para o Bruno

- [ ] `cargo test`, `npx vitest run`, `npx tsc --noEmit`.
- [ ] Build `npx tauri build --no-bundle` com `CARGO_TARGET_DIR=target\prueba`; abri-lo com dados próprios e
  CDP; testar no cmd e no PowerShell: `cd ` com pastas, `ping `, ↑ intacto, `Get-Ch` com cmdlets, nada de
  menu dentro de um programa, histórico do cmd guardado. Capturas.
- [ ] Atalho para que o Bruno teste essa build com uma cópia da sua configuração e histórico.
- [ ] Entrada em `Documentacion/Informe_Proceso_y_Stats.md` (o não verificado, marcado). Commit.
- [ ] Se o Bruno aprovar: merge em `main` e `compilar-version.bat --minor` (0.5.0). Se não: voltar a `main`
  e apagar o branch (com a permissão dele).
