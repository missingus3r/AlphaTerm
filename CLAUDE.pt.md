# AlphaTerm (antes NovaTerm) — contexto para o Claude Code

> Traduzido do original em espanhol (`CLAUDE.md`). A versão em espanhol é a fonte de verdade.

Terminal própria no estilo Warp, mais leve, voltada a trabalhar com agentes de IA.
O plano está em `Documentacion/pt/Plano_do_Terminal.txt` (com adendos no final: ambiente de casa e AlphaTerm);
o guia de código em `Documentacion\pt\Guia_de_Codigo.txt` (e seu PDF); o registro de cada fase em
`Documentacion\pt\Relatorio_de_Processo.md`.

## Estado
- F0 a F9 concluídas, mais os extras pedidos (API de controle para agentes + MCP, Docker, Guardião,
  painéis em mosaico, histórico, sessão, caminhos com visualização prévia, pastas e cor das abas…).
- Renomeada para AlphaTerm: binário `alphaterm.exe`, identificador `uy.alphaterm.app`, dados em
  `%APPDATA%\AlphaTerm` (a do NovaTerm é copiada na primeira vez). A pasta do projeto é
  `Desktop\AlphaTerm` (renomeada em 18/11/2026; antes `Desktop\NovaTerm`).
- Navegador integrado com marcação (20/11/2026): painel de navegador (folha com `browser` no modelo)
  com modo de edição para marcar elementos e pedir alterações ao agente da aba. Veja Gotchas.
- Pendente: decidir se, além da instalação por versão (`compilar-version.bat`), é preciso um
  instalador NSIS; testar o Docker com um contêiner real e o Claude Code com uma tarefa real passando pelo
  Guardião; as metas de RAM (<120 MB) e de inicialização (<500 ms) não são cumpridas (~225 MB e 1,2–1,4 s,
  dominados pelo WebView2).

## Rodar e testar
- Desenvolvimento: `npx tauri dev`. Release: `npx tauri build --no-bundle` → `src-tauri\target\release\alphaterm.exe`.
- Versão nova: clique duas vezes em `compilar-version.bat` (ou `npm run release`, que é `scripts/release.mjs`).
  Sobe a versão sozinho (patch por padrão; `--minor`, `--major`, ou `--misma` para recompilar sem subir)
  em `package.json`, `tauri.conf.json`, `Cargo.toml` e `Cargo.lock`, faz o commit "Versión X" e a tag
  anotada `vX`, compila (em `target\prueba` se `target\release\alphaterm.exe` estiver aberto) e instala com
  `scripts/instalar.mjs` em `%LOCALAPPDATA%\AlphaTerm\versiones\<v>` (atalho "AlphaTerm <v>" na
  área de trabalho, renomeia o anterior, e a fixação na barra de tarefas). Se falhar, desfaz o commit e a
  tag. Dá para fazer com o AlphaTerm aberto. `npm run instalar -- --desde <pasta>` instala um build já feito.
  Os .bat, com CRLF. O rodapé mostra a versão (tooltip: commit, "+" se havia alterações sem commit,
  data e caminho do exe) e o botão "Novidades" (changelog por versão).
- Changelog: `scripts/changelog.mjs` o gera a partir do git (tags `vX.Y.Z`) em `src/generated/changelog.json`
  (ignorado pelo git); são executados por `npm run dev`, `build` e `typecheck`. Lógica pura em
  `scripts/changelog-lib.mjs` (testes em `scripts/changelog.test.mjs`). Os commits anteriores às tags
  ficam na versão mais antiga (0.1.0 = tudo até 18/11/2026).
- Testes: `cargo test` em `src-tauri` (anteponha `~/.cargo/bin` ao PATH), `npx vitest run`, `npx tsc --noEmit`.
- Inspecionar o WebView: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
  antes de abrir o app e falar com ele por CDP (Runtime.evaluate, Input.dispatchMouseEvent). Se já houver
  um AlphaTerm aberto sem essa flag, o WebView2 não inicia (compartilham a pasta de dados).
- API de controle: `node %APPDATA%\AlphaTerm\alphaterm-mcp.mjs list` (ou `call <método> '<json>'`).
- Medir a inicialização: `ALPHATERM_BENCH=<arquivo>` anota os ms até o primeiro prompt.

## Gotchas
- Painéis de terminal: são iterados por id e posicionados por retângulos (aninhá-los remonta as
  terminais e mata a shell). O mesmo vale para os painéis laterais do mosaico: iterar ids, não objetos.
  Cada um tem em cima a barrinha de 22 px (`PaneBar`) e a terminal fica em `.pane-body`. Mover um
  painel (`movePane`) é só mudar a árvore: a folha é a mesma e a terminal não é recriada.
  O arraste usa a classe `resizing` do body (esconde o navegador e tira o ponteiro dos
  painéis) mais `pane-dragging`; o Esc é interceptado na captura para não chegar à terminal.
- `window.confirm` NÃO pergunta: o plugin de diálogos do Tauri o substitui por uma função async
  (devolve uma promise, que sempre é "sim") e falta a permissão `dialog:allow-confirm`. Use
  `askConfirm` (`src/widgets/confirm.ts`), que pergunta dentro do app (`ConfirmModal`, montado
  no Workspace e na janela de configurações). O teste `scripts/sin-confirm.test.mjs` falha se
  voltar a aparecer um `confirm(` solto em `src`.
- Com `npx tauri dev`/Vite, o hot reload de `Workspace.tsx` deixa viva a instância antiga
  (continua respondendo à API de controle e pode sobrescrever a sessão): recarregue a página antes de testar.
- Escritas na PTY por `WriteQueue` (se não, as teclas se invertem). Nunca atalhos com Ctrl+Alt (AltGr).
- Solid: dentro de um `createEffect`, uma função que lê e altera um sinal o dispara de novo em
  loop (aconteceu no rodapé: 180 MB). Use `untrack` ou `on`. E em `<Show>` com callback, não leia `m()`
  depois de fechar (por isso o menu aplica a ação antes de fechar).
- Enter para a shell: `String.fromCharCode(13)`, nunca uma quebra de linha literal em um template.
- Scripts de patch: escreva-os com Write em um .py; os heredoc do bash engolem `\\` e `\n`.
- A configuração abre dentro da mesma janela (`settingsOpen` em `src/settings/store.ts`,
  `.settings-overlay` por cima de `.workspace`); com ela aberta, os atalhos não mexem nas abas.
  A janela separada "settings" (`settings_open`) ficou sem uso.
- O esquema de settings vive em `src/settings/schema.ts`; o backend guarda JSON opaco.
- Janelas transparentes: o fundo é pintado pelo body; xterm com viewport transparente por CSS.
- O Codex guarda sessões como `.jsonl.zst`. agy: nunca pelo Git Bash (o MSYS converte `/quota`).
- agy sempre com `AGY_CLI_DISABLE_AUTO_UPDATE=true` (exatamente "true"): se não, cada consulta pode
  iniciar seu atualizador fora do console escondido e aparece uma janela de cmd por um instante.
- Uso em tempo real (`usage_live.rs`, como o System dashboard): o `/usage` do claude e o `/status` do codex
  são lidos abrindo-os em uma ConPTY sem janela + `vt100`. Não responda a `ESC[6n`: com o modo de entrada
  da ConPTY a resposta chega ao programa como texto digitado. O Claude vai com `--strict-mcp-config`
  e `disableAllHooks`. `ALPHATERM_PROBE_DUMP=<pasta>` guarda as telas lidas.
- Claude: entre consultas em tempo real, o uso vem da statusline (as credenciais não são lidas).
- Testes de Rust: o manifesto do Windows (controles comuns v6) é incorporado pelo linker
  (`build.rs` + `windows-app-manifest.xml`), não pelo tauri-build: sem ele o binário de teste não inicia
  (STATUS_ENTRYPOINT_NOT_FOUND, TaskDialogIndirect).
- Painel de alterações (`changes.rs`): hook Pre/PostToolUse do Claude + cópia e vigia da
  pasta de cada aba com um agente. No Solid, os cartões são iterados por id (se não, uma lista
  nova remonta tudo e perde-se o que está sendo editado).
- Colar imagens (`clip.rs`): sem texto na área de transferência, a imagem é salva como PNG em
  `%TEMP%\AlphaTerm\pegadas` e seu caminho é colado (o Claude Code e o Codex a anexam).
- Testar uma versão nova com outro AlphaTerm aberto: compile com `CARGO_TARGET_DIR=target\prueba`
  (o cargo o toma relativo a `src-tauri`, então fica em `src-tauri\target\prueba`; ou um caminho
  absoluto) e abra-a com `ALPHATERM_DATA_DIR` e `WEBVIEW2_USER_DATA_FOLDER` próprios (não toca na
  sessão nem na configuração do que está aberto).
- `alphaterm-mcp.mjs` lê `%APPDATA%\AlphaTerm\control.json` mesmo com `ALPHATERM_DATA_DIR`: para
  falar com um AlphaTerm de teste, passe `ALPHATERM_CONTROL_URL` e `ALPHATERM_CONTROL_TOKEN` do
  `control.json` da pasta de dados dele (se não, fala-se com o do Bruno).
- Opções de inicialização de agentes: catálogo em `src/panels/agentLaunch.ts` (levantado dos `--help`;
  revise-o quando um agente for atualizado). Listas de modelos em tempo real: `agent_models` em `agents.rs`.
- computer use: a área de trabalho às vezes fica na frente e bloqueia cliques; use CDP para a interface.
- As shells não herdam o ambiente de quem abriu o AlphaTerm (`src-tauri/src/pty/env.rs`): o Claude Code
  coloca NO_COLOR=1 e dezenas de CLAUDE_CODE_* (com tokens) nas suas ferramentas. Eles são respeitados se estiverem
  no ambiente persistente do Windows.
- `build.rs`: caminhos com `std::env::var("CARGO_MANIFEST_DIR")`, não `env!()` (fica fixo ao compilar o
  build script e quebra ao mover a pasta).

- Navegador integrado (`src-tauri/src/browser.rs`, `src/browser/`): um WebView2 filho
  (`Window::add_child`, feature `unstable` do tauri) posto por cima do `.bp-view` do seu painel; o
  frontend lhe manda o retângulo a cada 150 ms e o esconde se algo flutuante da interface se
  sobrepuser a ele (`FLOATING` em `src/browser/marks.ts`: adicione ali as classes de menus/modais novos,
  porque nada da interface pode cobrir o WebView2). É controlado por CDP com
  `CallDevToolsProtocolMethod` (bloqueia: nunca a partir da thread principal; `add_child` também não).
  A camada de marcação é `scripts/browser-overlay.js` (initialization_script) e fala com o backend
  por `Runtime.addBinding("__alphaterm")`. O pedido é colado na terminal do dono com
  `term.paste` (bracketed paste) e o Enter vai à parte 350 ms depois. "Pronto": hook Stop do Claude
  Code (`claude-stop.json` ou dentro de `claude-guardian.json` → `agent_stop`); os demais agentes,
  pelo silêncio da terminal depois de terem trabalhado. Com `--remote-debugging-port`, o
  navegador filho aparece como outro target em `/json` (serve para testar).

## Idiomas (espanhol, inglês e português, desde 0.7.0)
- Interface: todo texto visível passa por `t("texto em espanhol")` (`src/i18n/index.ts`); em
  constantes de módulo é marcado com `k("…")` e traduzido com `t(valor)` ao ser exibido. Variáveis
  entre chaves: `t("Cerrar {n} pestañas", { n })`, nunca concatenando. Traduções em
  `src/i18n/en/*.json` e `src/i18n/pt/*.json` (um arquivo por área; chave = o texto em espanhol
  EXATO). Mudar um texto em espanhol é mudar a chave nos dois idiomas: `node scripts/i18n-check.mjs`
  (e seu teste) falha se faltar, sobrar, as {variáveis} não baterem ou um texto tiver duas traduções.
  Termos e estilo: `src/i18n/GLOSARIO.md`. Datas e números com `locale()`.
- Rust: `tr("…", "…", "…")` e `tr!(…)` de `src-tauri/src/i18n.rs` (es, en, pt). O idioma chega por
  `set_locale` e é lido do settings.json ao iniciar. Nos testes: `tr_in!`/`Lang::pick`, nunca mudar o
  global (outros testes esperam espanhol).
- Ficam em espanhol de propósito porque são comparados (traduzidos só ao exibir): os rótulos das
  janelas de uso ("5 h", "semana"…), as decisões do registro do Guardião ("bloqueado"…) e o perfil
  "Símbolo del sistema" (`profileLabel`).
- Scripts de agentes (MCP, hook do Guardião, camada do navegador): o idioma vem de `ALPHATERM_LANG`
  (as abas novas recebem) ou do settings.json.
- Idioma inicial: instalação nova = o do Windows; settings.json sem a chave `language` = espanhol.
- Novidades: a tradução de cada commit em `src/i18n/changelog/en|pt.json` (chave = assunto em
  espanhol). `node scripts/changelog.mjs --faltan` lista o que falta e o `release.mjs` não sobe a
  versão se algum commit desde a última tag não estiver traduzido.
- Documentação: as versões em inglês e português ficam em `Documentacion/en|pt`, `CLAUDE.en.md`,
  `CLAUDE.pt.md`, `README.md` (inglês), `README.es.md` e `README.pt.md`. Ao mudar um documento,
  atualize as três (e os PDFs: `python Documentacion/generar_pdfs.py es en pt`, precisa do fpdf2).
  As capturas do README (as mesmas para os três) mostram a interface em inglês, em
  `Documentacion/capturas/`.

## Decisões já tomadas (não rediscutir sem motivo)
- Tauri 2 + Rust; Vite + TypeScript + SolidJS 1.9; xterm.js 6 com WebGL (fallback DOM).
- Nome da aba: manual > título OSC do programa > resumo por modelo (opcional) > heurística.
- Saída da PTY agrupada por `tauri::ipc::Channel` binário com contrapressão.
- Git pela CLI. Docker pela CLI. Nada de shell no meio para comandos montados pelo app.

## Ambiente
- Casa (`C:\Users\Br1`): Rust 1.99.1 fora do PATH, Node 22, PowerShell 5.1 (sem pwsh), Docker
  Desktop instalado, Ollama sem modelos.
- PC do trabalho: inspeção SSL, o PowerShell bloqueia `.ps1`, sem Rust ao montar o plano.

## Forma de trabalho
- Cada fase fecha verificada e registrada no Relatório; o que não foi verificado é marcado como tal.
- O Bruno prefere respostas em espanhol, diretas, em parágrafos e com pushback honesto.
