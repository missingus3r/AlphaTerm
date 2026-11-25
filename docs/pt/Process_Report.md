# NovaTerm — Relatório de processo e stats (Playbook)

> Traduzido do original em espanhol (`docs/es/Process_Report.md`). A versão em espanhol é a fonte de verdade.

Registro de cada fase: o que foi feito, como foi verificado, quanto tempo levou e o que ficou pendente.
Regra de honestidade: o que não estiver verificado com dados reais da máquina é marcado como **NÃO VERIFICADO**.

## Resumo das fases

| Fase | Estado | Data | Verificação |
|---|---|---|---|
| F0 — Preparação | Concluída | 17/11/2026 | Toolchain testado, PDFs gerados, gate aprovado |
| F1 — Núcleo terminal | Concluída | 17/11/2026 | Testada no app; throughput no nível do Windows Terminal |
| F2 — Layout | Concluída | 18/11/2026 | Testada no app: abas, splits, multi-janela, integração e títulos |
| F3 — Configurações e temas | Concluída | 18/11/2026 | Testada no app: temas, Mica/Acrylic, fontes, ligaduras, atalhos, edição manual do arquivo |
| F4 — Agentes | Concluída | 18/11/2026 | Claude Code iniciado pelo painel, estados e detecção reais |
| F5 — Widgets | Concluída | 18/11/2026 | CPU/RAM e uso com dados reais (agy exato, Codex e Claude com sua idade) |
| F6 — Servidores/Portas | Concluída | 18/11/2026 | Servidor em aba detectado, receita salva, parar e iniciar |
| F7 — Projetos | Concluída | 18/11/2026 | Projetos do Claude/Codex e árvore com .gitignore |
| F8 — Git | Concluída | 18/11/2026 | Diff, stage e commit pelo painel em um repositório de teste |
| F9 — Polimento | Concluída | 18/11/2026 | Resumo por modelo (servidor de teste), medições, guia de código |
| Extras — AlphaTerm | Concluída | 18/11/2026 | Pedidos durante a implementação: API para agentes, Docker, Guardião, mosaico, sessão… |

---

## F0 — Preparação (17/11/2026)

**Máquina:** PC de casa (`C:\Users\Br1`), Windows 11 Pro 10.0.26300. O plano foi montado no PC do
trabalho; as diferenças ficaram no adendo ao final de `docs/es/Terminal_Plan.txt`.

### Feito
- Plano exportado para txt (no PC do trabalho, 17/11) e copiado para `NovaTerm\docs/es/Terminal_Plan.txt`.
- Adendo com o ambiente de casa e o ajuste de versões adicionado ao plano.
- `docs\generate_pdfs.py`: gera `Specification.pdf` (8 págs.) e `Plan.pdf` (3 págs.) a partir
  do txt com fpdf2 2.8.7 e Segoe UI / Consolas do Windows. Regenerável: `python docs\generate_pdfs.py`.
- Este Relatório iniciado.

### Ambiente verificado

| Ferramenta | Versão | Nota |
|---|---|---|
| rustc / cargo | 1.99.1 / 1.99.1 | toolchain `stable-x86_64-pc-windows-msvc`, em `~/.cargo/bin` fora do PATH |
| Node / npm | 22.22.2 / 11.14.1 | |
| Git | 2.56.0 | |
| Python | 3.11.3 (fpdf2 2.8.7) | 3.14.5 também instalado, sem fpdf2 |
| Visual Studio | 2022 e 2019 | linker MSVC: `cargo run` de um hello world linka e roda |
| WebView2 | 157.0.4341.60 | |

### Rede

| Destino | Resultado |
|---|---|
| index.crates.io | 200 em 0,17 s |
| static.crates.io | 200 em 0,23 s |
| registry.npmjs.org | 200 em 0,19 s |

Sem inspeção SSL nem proxy nesta rede. Não foi preciso `~/.cargo/config.toml`.

### Teste de dependências Rust
`cargo check` de um crate de teste com as dependências do plano: **OK em 1 min 32 s** (a frio).

| Crate | Versão resolvida |
|---|---|
| tauri | 2.12.6 |
| portable-pty | 0.9.0 |
| sysinfo | 0.40.4 |
| tokio | 1.54.1 |
| reqwest | 0.13.5 (`native-tls`, `json`, `system-proxy`) |
| windows | 0.62.2 (`Win32_NetworkManagement_IpHelper`, `Win32_Networking_WinSock`) |
| ignore / notify | 0.4.34 / 8.2.2 |

Tropeço: o reqwest 0.13 não tem mais o feature `rustls-tls`; usa-se `native-tls` (schannel), que além disso
respeita os certificados do sistema como o plano pedia para a rede do trabalho.

### Versões do frontend (decididas, são instaladas na F1)
- SolidJS **1.9.19**, não 2.0: o `vite-plugin-solid` 2.11.16 só declara `solid-js ^1.7.2`.
- xterm.js **6.0.0** com `@xterm/addon-webgl` 0.19; o addon canvas (0.7) só suporta o xterm 5, então
  o fallback do WebGL é o renderer DOM do xterm.
- Vite 8.3.8, TypeScript 7.0.2, Vitest 5.1.0, Tauri CLI/API 2.12.5.

### O que muda em relação ao plano original
- O Rust não precisou ser instalado; o fallback para o Electron fica descartado.
- Shells disponíveis: Windows PowerShell 5.1 (perfil padrão), cmd, Git Bash e WSL. O pwsh
  (PowerShell 7) não está instalado e não é necessário. A shell integration é escrita compatível com a 5.1.
- Agentes instalados: claude, codex, opencode e **agy (Antigravity CLI 1.4.12)**, que substituiu o
  Gemini CLI.
- Uso do agy, **verificado**: `agy -p /quota --output-format json` devolve a fração restante
  das janelas de 5 h e semanal por grupo de modelos, com a hora do reset, sem rodar um turno
  (`num_turns: 0`, `total_tokens: 0`). O provider do Gemini deixa de ser "estimado".
- Tropeço: pelo Git Bash, `/quota`, `/usage` e `/credits` foram convertidos em caminhos do Windows
  (MSYS) e o agy os tomou como prompts. Foram 6 turnos reais (uns 50 mil tokens) que gastaram cota
  do grupo "Claude and GPT models" (ficou em 86 % da janela de 5 h e 93 % da semanal).
  Lição: executar o agy como processo direto ou pelo PowerShell/cmd.

### Gate
Aprovado pelo Bruno em 17/11/2026 ("Sí, arrancá F1").

### Stats
- Duração da F0 em casa: uma sessão curta (verificação do ambiente + documentos).

---

## F1 — Núcleo terminal (17/11/2026)

### Feito
- Projeto Tauri 2.12 + Vite 8 + SolidJS 1.9 + xterm.js 6 em `NovaTerm\` (repositório git iniciado, sem commits).
- Backend `src-tauri\src\pty\`:
  - `mod.rs`: sessões ConPTY (portable-pty 0.9) com três threads por sessão (leitor, agrupador, vigia).
    O vigia fecha o pseudoconsole quando o processo termina, porque sem isso a ConPTY não dá EOF.
  - `batcher.rs`: agrupamento da saída. O primeiro pedaço depois de um tempo parado sai de imediato
    (eco de teclas sem demora); em rajada junta 4 ms ou 64 KB. Contrapressão com marca alta de
    2 MB e baixa de 512 KB: o frontend confirma os bytes quando o xterm terminou de processá-los.
  - `profiles.rs`: Windows PowerShell, PowerShell 7, cmd, Git Bash e WSL, com detecção.
- Saída por `tauri::ipc::Channel` binário (`InvokeResponseBody::Raw`, chega como ArrayBuffer).
- Frontend: xterm com WebGL (fallback DOM), fit, unicode11, links que abrem o navegador,
  copiar/colar como o Windows Terminal (Ctrl+C com seleção copia e sem seleção interrompe;
  Ctrl+V e Ctrl+Shift+C/V; clique direito copia ou cola), reinício com Enter ao terminar a shell.

### Testes
- Rust: 9 testes (agrupamento, contrapressão, perfis, ConPTY real com cmd e código de saída, kill).
- Vitest: 8 testes (atalhos de copiar/colar e agrupamento de acks).

### Teste no app (conduzido com computer use)
| Teste | Resultado |
|---|---|
| Prompt do PowerShell 5.1 | OK |
| Cor de 24 bits, negrito, sublinhado, acentos, ✓ e CJK de largura dupla | OK |
| `ping -t` + Ctrl+C | OK, corta de imediato |
| `git log --graph --color` | OK |
| vim (destaque, tela alternativa, sair sem salvar) | OK |
| Claude Code (TUI, setas, Esc) e título OSC na barra | OK |
| Mudança de tamanho (238×54 → 135×37 visto pelo PowerShell) | OK |
| ssh (`ssh -T git@github.com` conecta; rejeita por falta de chave neste PC) | OK como transporte; sessão interativa não testada |
| Copiar seleção com Ctrl+C (verificado lendo a área de transferência) | OK |
| Colar (bracketed paste no vim e no bash) | OK |
| Git Bash: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=NovaTerm` | OK |
| `exit 3` informa o código 3 e Enter reinicia | OK |
| Fechar a janela não deixa shells órfãs | OK |

### Bugs encontrados e corrigidos
- Ao trocar de perfil, o aviso de fim da sessão antiga sobrescrevia a barra de estado da nova.
- A ConPTY começa perguntando a posição do cursor (`ESC[6n`) e espera a resposta: o xterm a
  responde sozinho, mas o teste de Rust teve que respondê-la à mão.
- O vite-plugin-solid põe o jsdom como ambiente padrão do Vitest: `vitest.config.ts` fixa node.

### Medições (release, 17/11/2026)
- Executável: 9,1 MB. Build release: 3 min 41 s.
- Bundle do frontend: 495 KB (132 KB gzip); quase tudo é xterm + WebGL.
- RAM em repouso com 1 aba: **181 MB de memória privada** (NovaTerm 6 MB, WebView2 o resto).
  Working set somado: 376 MB (conta várias vezes o que é compartilhado). **Meta do plano (< 120 MB): NÃO É CUMPRIDA.**
- Throughput medido sem frontend (bench `bench_conpty`, ConPTY do sistema):
  - `type` de 20 MB: 0,98 MB/s.
  - `seq 1 300000` (MSYS): 0,08 MB/s.
  - No app, o `seq` dá umas 10 mil linhas/s: o limite é a ConPTY do sistema, não o IPC nem o xterm.
    Com os dois testes há uns 240 lotes/s, como se a ConPTY entregasse por quadros.

### ConPTY da Microsoft (sideload) e comparação com o Windows Terminal
- Com permissão do Bruno baixou-se o `Microsoft.Windows.Console.ConPTY` 1.25.261109001 do NuGet (1,76 MB,
  MIT). Assinaturas Authenticode de `conpty.dll` e `OpenConsole.exe`: válidas, Microsoft Corporation.
  Ficam em `src-tauri\conpty\`; o `build.rs` os copia ao lado do exe (e para `deps\` para os testes) e
  o instalador os inclui. O portable-pty os usa só por estarem ao lado do executável
  (verificado: o processo filho passa a ser `OpenConsole.exe` em vez de `conhost.exe`).
- Diagnóstico com `bench_raw` (leitura crua da ConPTY, sem agrupador nem frontend):

| Produtor | ConPTY nova | ConPTY do Windows |
|---|---|---|
| Python escreve 20 MB de uma vez | 5,37 MB/s (1.823 leituras) | 5,60 MB/s |
| `seq 1 300000` (MSYS, uma escrita por linha) | 0,11 MB/s (299 mil leituras) | 0,11 MB/s |
| `type` 20 MB | 1,27 MB/s (279 mil leituras) | 1,24 MB/s |

  Conclusão: o teto é o custo de cada escrita que passa pela ConPTY (~70 µs), não o NovaTerm (o
  agrupador junta 279 mil leituras em ~3.700 lotes). Neste PC (Windows 11 build 26300) a ConPTY
  nova não é mais rápida que a do sistema. Mantém-se mesmo assim: é a mesma que o Windows Terminal
  e o Warp trazem, e em Windows mais antigos (por exemplo, o PC do trabalho) a do sistema é bem pior.
- Comparação com o mesmo script (`bench.ps1`, cronômetro do PowerShell) nas duas terminais:

| Teste | Windows Terminal (120×30) | NovaTerm release (135×37) |
|---|---|---|
| `seq 1 300000` | 22,9 s | 22,4 s |
| Python, 20 MB de uma vez | 2,73 s | 2,92 s |
| `type` 20 MB | 14,2 s | 13,5 s |

  **Meta "throughput comparável ao Windows Terminal": é cumprida** (medido com 20 MB; o `type` de
  100 MB fica para o benchmark da F9).

### Pendente para as fases seguintes
- RAM: 181 MB privados contra a meta de 120 MB (quase tudo WebView2). Revisar na F9.
- `term.onBinary` (modo de mouse X10 de alguns programas antigos) ainda não é reenviado.
- ssh interativo não testado (não há servidor nem chave neste PC).
- o clippy não está instalado no toolchain deste PC (`rustup component add clippy`).
- ~~Nada commitado ainda no repositório git.~~ Commit `b5d6529` (18/11/2026).

### Stats
- Testes: Rust 9 + 2 benchmarks ignorados (`bench_conpty`, `bench_raw`); Vitest 8. Todos verdes.
- Build release: 3 min 41 s; debug: 1 min 9 s.

---

## F2 — Layout (18/11/2026)

### Feito
- **Modelo** (`src\layout\model.ts`, funções puras): abas com uma árvore de painéis (folhas e
  divisões em duas), adicionar/fechar/alternar/mover/renomear abas, dividir e fechar painéis,
  proporções, retângulos de cada painel e vizinho por direção para se mover pelo teclado.
- **Renderização sem remontar**: os painéis são desenhados planos, posicionados por retângulos, e iterando
  por id (texto). Se fossem aninhados como componentes, dividir um painel voltaria a criar sua terminal e
  mataria a shell.
- **Abas ocultas**: continuam recebendo e carregando dados no buffer, mas sem WebGL (o
  contexto é solto ao ocultar e carregado de novo ao mostrar). Os navegadores limitam os contextos
  WebGL a ~16, então com muitas abas isso evita perder a renderização.
- **Barra de abas** em cima ou à esquerda (Ctrl+Shift+B; preferência no localStorage até a
  F3), arrastar para reordenar, clique do meio fecha, clique duplo ou Ctrl+Shift+R renomeia (vazio
  volta ao nome automático), ponto de estado (em espera / executando / falhou / terminou) e número
  de painéis. Seletor de perfil para as abas novas.
- **Marquee**: o nome rola se não couber, pausa com o mouse em cima, respeita
  prefers-reduced-motion (fica com reticências) e o tooltip mostra o texto inteiro mais
  pasta, shell, PID, renderer e último comando.
- **Multi-janela** (Ctrl+Shift+N ou botão): cada janela tem suas abas e suas sessões. Cada
  sessão guarda sua janela dona: ao fechar uma janela morrem só as suas shells; ao recarregar a
  view matam-se só as dessa janela. Sem abas, a janela se fecha.
- **Atalhos** (`src\layout\shortcuts.ts`): Ctrl+Shift+T/N/W, Alt+Shift++ / - / D (dividir), Alt+setas,
  Ctrl+Tab, Ctrl+1…9, Ctrl+Shift+R/B/O, Ctrl+Shift+↑/↓. **Nunca Ctrl+Alt**: em teclado espanhol é
  AltGr e é usado para escrever @ # [ ].
- **Saída limpa** (`exit` com código 0) fecha o painel, como o Windows Terminal; com erro fica a
  mensagem e Enter reinicia.
- **Shell integration** (`src-tauri\shell\` + `src-tauri\src\pty\integration.rs`):
  - PowerShell 5.1/7: script por `-EncodedCommand` (a política de execução não o barra). Envolve
    `prompt` e `PSConsoleHostReadLine`. OSC 133 A/B/C/D;código, 633;E;comando, 7;pasta. Força
    saída UTF-8. Compatível com a 5.1 (`[char]27`).
  - Git Bash: `--init-file` que primeiro carrega /etc/profile e ~/.bash_profile (o que o
    --login faria). PS0 com o truque do subscrito aritmético para marcar o início do comando.
  - cmd: variável PROMPT com 133;A/B/D (sem código) e 9;9;pasta. Sem clink.
  - WSL: sem integração (pendente).
- **Blocos no estilo Warp**: marca verde/vermelha à esquerda de cada prompt e na régua lateral conforme
  o código de saída (com tooltip), pular para o comando anterior/seguinte (Ctrl+Shift+↑/↓) e copiar
  a saída do último comando (Ctrl+Shift+O).
- **Título-resumo** (`src\layout\title.ts`): manual > título OSC do programa (só enquanto roda
  um comando, ou se não há integração e não é um título de shell) > heurística (comando em andamento +
  pasta + branch do git). Para o cmd aproveita-se o título "cmd.exe - comando" que o próprio cmd coloca.
  O backend dá o processo em primeiro plano (descendente mais novo da shell, sem conhost nem
  OpenConsole, com sysinfo; é consultado a cada 2 s e pausa com a janela minimizada) e o branch
  git (lendo `.git/HEAD`, com suporte a worktrees).

### Testes
- Rust: 17 (+2 benchmarks). Novos: integração real com PowerShell e Git Bash (chegam 133;B,
  633;E, 133;C e 133;D com o código correto), script codificado, bash com finais LF, processo em
  primeiro plano (inclui PID reciclado) e branch git.
- Vitest: 32. Novos: modelo de abas e painéis (inclui vizinhos em uma grade 2x2), atalhos
  (inclui que o AltGr não dispare nada), título e heurística, parsing de OSC 133/633/7/9, fila de
  escrita.

### Teste no app (computer use)
| Teste | Resultado |
|---|---|
| Nome pela pasta ("Br1") e título da janela | OK |
| Repositório git: "NovaTerm (main)"; com comando em andamento: "ping -n 6 · …" | OK |
| Marcas verde/vermelha por código de saída | OK |
| Splits (auto, abaixo), foco com Alt+setas, borda do painel ativo | OK |
| Aba nova, Ctrl+Tab, a aba oculta continua rodando e é repintada direito | OK |
| Renomear com nome longo: o marquee rola | OK |
| Barra à esquerda | OK |
| Janela nova; `exit` fecha painel, aba e janela; as shells da outra janela continuam (5 → 4) | OK |
| Claude Code dentro de um painel | OK |
| Título OSC de um programa enquanto roda ("✳ Refactor del login…") e volta para a pasta | OK (simulado) |
| Ctrl+Shift+O copia exatamente a saída do último comando (lido da área de transferência) | OK |
| Git Bash com integração no app (título com comando, marca vermelha em um `cd` que falhou) | OK |
| cmd: pasta por OSC 9;9 e "ping -n 8 · NovaTerm (main)" enquanto roda | OK |
| Arrastar divisor | OK (depois da correção) |

### Bugs encontrados e corrigidos
- **Teclas invertidas** ("cmd" chegava como "cdm"): cada tecla ia em um `invoke` independente e o
  backend podia atendê-los em outra ordem. `WriteQueue` envia uma de cada vez e junta o que é digitado
  enquanto espera. É o bug mais sério da fase.
- O Enter que confirma a renomeação também chegava à shell (prompt vazio a mais).
- O divisor não arrastava: com os eventos delegados do Solid, `currentTarget` não é o elemento.
- Ao escrever os scripts de shell com um heredoc, cada `\\` ficou como `\`: o prompt do
  PowerShell falhava (mostrava `PS>`). Foi detectado pelo teste de integração real.
- Com `cd X; ping …` o título mostrava o `cd`: agora toma-se o último trecho da cadeia.

### Pendente / não verificado
- **Título real do Claude Code**: não foi testado com uma tarefa real (para não gastar cota); o
  mecanismo foi testado simulando o título OSC. Ao tentar, um comando de teste chegou ao Claude
  Code como mensagem (os Ctrl+C não o tinham fechado) e consumiu um turno (~77 mil tokens, quase tudo
  contexto inicial) até ser interrompido com Esc.
- Se o `cd` e o programa vão na mesma linha, a pasta do título é a anterior até que
  volte o prompt.
- Quando o NovaTerm é iniciado a partir de uma sessão do Claude Code, as shells herdam variáveis
  `CLAUDE_CODE_*` (o Claude Code lá dentro avisa "Transcript saving is off"). Iniciado normalmente isso não acontece.
- WSL sem integração; cmd sem código de saída nem texto do comando (seria preciso o clink).
- A preferência de barra vertical vive no localStorage até a F3.

### Stats
- Arquivos novos: 13 (6 de lógica com testes, 4 componentes, 2 scripts de shell, 1 módulo Rust).
- Testes: Rust 17 (+2 ignorados), Vitest 32. Todos verdes.

---

## F3 — Configurações e temas (18/11/2026)

### Feito
- **Persistência** em `%APPDATA%\NovaTerm\settings.json`. O backend (`settings.rs`) não conhece o
  esquema: guarda o objeto de forma atômica (arquivo temporário + rename), avisa todas as janelas
  com o evento `settings-changed` (com a janela de origem, para não sobrescrever o que está sendo
  editado) e vigia o arquivo a cada 1 s para aplicar edições feitas à mão. Se o arquivo está
  quebrado, não o sobrescreve sem antes copiá-lo para `settings.json.bak`.
- **Esquema e normalização** no frontend (`settings/schema.ts`): qualquer arquivo (antigo, editado
  à mão ou com lixo) dá uma configuração completa; corta números fora de faixa, descarta
  opções inválidas e conserva as chaves que não conhece (para as fases seguintes).
- **Janela de configurações** própria (Ctrl+, ou o botão ⚙), carregada sob demanda (21 KB):
  tema e cores, fonte e cursor, fundo, terminal e interface, atalhos e "próximas fases".
- **Temas**: 11 de fábrica (Nova escuro/claro, Campbell, One Half Dark/Light, Solarized Dark/Light,
  Dracula, Tokyo Night, Gruvbox Dark, Nord), modo escuro / claro / conforme o Windows com um tema para
  cada modo, duplicar e editar as 21 cores, apagar, e **importar** esquemas do Windows Terminal
  (ou seu settings.json inteiro, com comentários), `.itermcolors` do iTerm2 e temas do xterm.js.
  A barra de abas e a de título tomam as cores do tema.
- **Fundo**: Mica, Mica alternativo, Acrylic e desfoque (API de efeitos do Tauri 2, sem crate
  extra), opacidade, e imagem com opacidade e ajuste. A imagem é copiada para `%APPDATA%\NovaTerm\fondos`
  e o backend só lê dessa pasta. As janelas passaram a ser transparentes.
- **Fontes**: lista de monoespaçadas instaladas (registro do Windows + medição em canvas; as
  de símbolos são excluídas), ou um nome à mão; tamanho, entrelinha, espaçamento, espessura, cursor
  (bloco/barra/sublinhado) e piscar. **Ligaduras** com `@xterm/addon-ligatures` 0.10: o addon
  pede a fonte com a API de fontes locais (que no WebView pediria permissão); nós a substituímos
  por uma que lê o arquivo a partir do backend. É carregado só ao ativá-las (191 KB à parte).
- **Atalhos configuráveis**: 18 comandos com suas combinações (são adicionadas gravando-as, removidas,
  voltam "ao padrão de fábrica"), conflitos marcados em vermelho, Ctrl+Alt rejeitado (AltGr), aviso para
  Ctrl+letra sem Shift. Ctrl+1…9 ficam fixos. Atalho novo: Ctrl+, abre as configurações.
- **Terminal e interface**: posição da barra, shell padrão, linhas de histórico e a cada
  quanto tempo se detecta o programa em uso.
- A preferência de barra vertical da F2 (localStorage) é migrada sozinha para o arquivo na primeira vez.

### Testes
- Rust: 24 (+2 benchmarks). Novos: salvar e reler, arquivo inexistente, arquivo quebrado (aviso com
  linha e cópia .bak antes de sobrescrever), BOM, nomes de imagem seguros e decodificação, parsing de
  nomes de fonte do registro e leitura real do registro (Consolas → consola.ttf).
- Vitest: 51. Novos: normalização (lixo, faixas, chaves desconhecidas, temas próprios), temas de
  fábrica válidos, claro/escuro, paleta com opacidade, importação (Windows Terminal, seu settings.json
  com comentários, formato próprio, iTerm2, erros), ids de temas, atalhos configuráveis (combinação
  a partir do evento, forma canônica, rejeições, substituição, conflitos, ajuda).

### Teste no app (computer use + depuração remota do WebView2)
| Teste | Resultado |
|---|---|
| Trocar de tema na janela de configurações: aplica-se na hora na terminal e na barra | OK |
| Ctrl+, abre (ou traz para a frente) as configurações | OK |
| Opacidade 75 % sem efeito: vê-se a área de trabalho | OK (depois da correção) |
| Mica (tom do papel de parede) e Acrylic (desfocado) | OK |
| Cascadia Code com ligaduras na visualização prévia e na terminal (WebGL), sem pedido de permissão | OK |
| Gravar Ctrl+Shift+Y para "Nova aba" e usá-lo; Ctrl+Alt+T rejeitado com explicação | OK |
| Editar settings.json à mão (tamanho 18, modo claro): aplica-se sozinho, barra de título clara | OK |
| Arquivo quebrado: aviso com linha e coluna; as terminais continuam com o último que funcionava | OK |
| Modo "conforme o Windows" com o Windows no escuro → tema escuro | OK |
| Ctrl+Shift+B muda a barra em todas as janelas; janela nova com a configuração atual | OK |
| Imagem de fundo (cópia em `fondos`, nome com ñ) visível atrás do texto | OK (imagem injetada no seletor) |
| Importar um esquema do Windows Terminal e editar seu fundo: muda nas duas janelas | OK (arquivo injetado no seletor) |
| A terminal continua em WebGL com transparência e ligaduras | OK |
| Release: a barra vertical salva na F2 passou sozinha para o settings.json | OK |

### Bugs encontrados e corrigidos
- **Fundo preto com transparência**: o xterm pinta seu viewport opaco mesmo que o tema seja transparente;
  foi visto lendo os estilos com a depuração remota do WebView2. É forçado transparente por CSS
  (a cor é posta pelo body).
- O Wingdings 2 aparecia como monoespaçada (passa no teste de largura): as de símbolos são excluídas.
- O aviso de arquivo quebrado dizia "usam-se os valores padrão" também quando o app continua com
  a última configuração válida: agora a mensagem depende do caso.
- O addon de ligaduras somava 190 KB à inicialização: passou a ser carregado só ao ativá-las.

### Pendente / não verificado
- **O seletor de arquivos nativo** não pôde ser conduzido com computer use (a captura o cobre): a
  imagem e o tema foram testados injetando o arquivo no mesmo `<input>`, que roda o mesmo
  código. Ao tentar, o caminho foi escrito na terminal e o PowerShell abriu a imagem no Fotos.
- **Mudança em tempo real do Windows claro ↔ escuro** com o modo automático: não foi testada mudando o tema
  do sistema (é uma configuração do Windows); foi verificado que toma o modo atual.
- **RAM**: 195 MB privados com uma aba (release, medido com um script que soma o NovaTerm e seus
  processos de WebView2). Na F1 foram medidos 181 MB; parte pode ser a janela transparente e parte o
  método. A meta de 120 MB continua sem ser cumprida: fica para a F9.
- As opções de agentes, uso, CPU/RAM e resumo por LLM chegam com a F4, F5 e F9 (a seção
  "Próximas fases" diz isso).

### Stats
- Arquivos novos: 10 (2 módulos Rust, 5 de lógica/estado, 1 componente, 1 folha de estilos, 1 de testes).
- Bundle principal: 557 KB (533 KB na F2); configurações 21 KB e ligaduras 191 KB à parte, sob demanda.
- Testes: Rust 24 (+2 ignorados), Vitest 51. Todos verdes.

---

## F4 a F9 e extras (18/11/2026)

O Bruno pediu para seguir direto até o final e testar tudo ao terminar; no meio adicionou funções
(veja o adendo do plano) e a mudança de nome para **AlphaTerm**. Cada fase ficou em seu commit.

### F4 — Agentes
- Catálogo editável (Claude Code, Codex, Antigravity, OpenCode e próprios) com comando, variáveis e
  ocultar. Detecção sem executar nada: PATH do processo + do registro + pastas habituais
  (encontrou os quatro: `.local\bin\claude.exe`, `npm\codex.cmd`, `agy\bin\agy.exe`, `npm\opencode.cmd`).
- Iniciar abre uma aba com a shell padrão e escreve o comando no primeiro prompt (o agente
  roda dentro da shell). Estados: iniciando, trabalhando (há saída), aguardando input
  (silêncio), precisa de você (sino), terminou (com código). Também no ponto da aba.
- Bug encontrado: o Enter era escrito como uma quebra de linha literal (em um template JS vira
  `\n` e o PowerShell o toma como linha incompleta). Bug da F1 que apareceu aqui: se o painel
  era ajustado enquanto a sessão iniciava, o tamanho novo se perdia e as TUI eram desenhadas deslocadas.

### F5 — Widgets
- CPU e RAM com sparkline de 60 s; clique: top de processos e uso de cada aba (árvore da shell).
- Uso: **agy** exato por `/quota` (0 tokens, executado sem shell); **Codex** do último
  `rate_limits` de suas sessões, que agora vêm comprimidas (`.jsonl.zst`, são lidas com ruzstd);
  **Claude** da statusline do Claude Code (credenciais não são lidas: decisão que já estava no
  Claude Control Panel). Sem statusline, estimativa em tokens. Cada dado diz fonte e idade.
- Descoberta: a statusline do Claude Code aponta para `Desktop\claude-control-panel\statusline.js`, que já
  não existe; a configuração avisa isso e oferece instalar a do AlphaTerm (com cópia do arquivo).
  Não foi mexido: muda a configuração do Claude Code e é decisão do Bruno.

### F6 — Servidores e portas
- Portas em escuta por GetExtendedTcpTable (IPv4 e IPv6), com processo, comando, pasta e uptime;
  marca as que nasceram em uma aba. Parar com taskkill /T (mais confirmação se não é do
  AlphaTerm; nunca PID ≤ 4). Receitas automáticas (comando por OSC 633 + pasta + portas) ou à mão.

### F7 — Projetos
- A partir dos transcripts do Claude Code (`cwd`) e das sessões do Codex (`session_meta`), mais os
  adicionados à mão e as pastas recentes. Árvore preguiçosa com `.gitignore` (crate ignore) e vigia
  das pastas abertas (notify).

### F8 — Git
- CLI do git sem console nem prompts: status porcelain v2, diff unificado ou lado a lado, stage por
  arquivo ou todos, commit (Ctrl+Enter), histórico com grafo, branches, fetch/pull --ff-only/push (com -u
  se faltar upstream), clone e init. Contador de alterações em cada aba.

### F9 — Polimento
- Resumo de aba com um modelo (endpoint compatível com OpenAI; desligado por padrão). Ordem do
  nome: manual > título do programa > modelo > heurística.
- Guia de código (`docs\es\Code_Guide.txt` e `Code_Guide.pdf`), adendo no plano.

### Extras pedidos
Histórico de comandos global, localização atual no rodapé, uso do agente ativo destacado,
restaurar a sessão, caminhos clicáveis com visualização prévia, pastas e cor das abas, título da
janela, **API de controle** (HTTP local + token, servidor MCP e CLI `alphaterm-mcp.mjs`), **Docker**,
**Guardião** e painéis laterais em **mosaico** (vários ao mesmo tempo, redimensionáveis e reordenáveis).

### Testes
- Rust: 55 (+3 ignorados). Novos: detecção de agentes, sysmon, uso (datas, Codex, agy,
  statusline), portas (tabela real), projetos (árvore com .gitignore), git (ciclo real em um repositório
  temporário), histórico, sessão, Docker (argumentos sem shell), Guardião (classificador e hook),
  migração da pasta, resumo por modelo.
- Vitest: 96. Novos: estado de agentes, formatos, receitas, projetos, diff, caminhos, sessão, pastas
  de abas, uso, mosaico.

### Teste no app (release, CDP + computer use)
| Teste | Resultado |
|---|---|
| Iniciar o Claude Code pelo painel (com `--mcp-config` e `--settings`), estado "aguardando input" e "terminou (código 1)" | OK |
| API: ping, list, open_tab, split, open_window (subjanela), run com espera (saída exata e código 7), read, send, close; token inválido → 401 | OK |
| MCP por stdio como cliente: initialize, tools/list (14), tools/call, erro em painel inexistente | OK |
| Guardião pela API (Remove-Item): diálogo nas duas janelas, Bloquear → a API recebe o bloqueio | OK |
| Hook do Claude Code (simulado com o JSON que o Claude envia): Edit com diff → permitir; rm -rf → deny | OK |
| Docker: engine desligado detectado, "Abrir Docker Desktop" o inicia, versão 29.7.2 no painel e na API | OK (sem contêineres: veja pendentes) |
| Servidor Python em uma aba: marcado como do AlphaTerm, receita salva, parar e voltar a iniciar (HTTP 200) | OK |
| Git: diff numerado, stage de um arquivo, commit só desse arquivo | OK |
| Histórico com comandos das duas janelas e códigos | OK |
| Projetos e árvore sem node_modules/dist/target | OK |
| Cor e pasta de aba, recolher, título da janela | OK (depois de corrigir o menu) |
| Restaurar a sessão ao reabrir: título, 5 abas, divisão, pastas, painel | OK |
| Caminhos na saída: visualização prévia de imagem (3840 px) e de pasta | OK |
| Resumo por modelo contra um servidor de teste: 3 pedidos por rodada, nome limpo | OK |
| Mosaico: 3 painéis ao mesmo tempo, mover para cima de outro e para uma coluna nova, largura e altura, salvo | OK |
| Saltos ao início/fim com 300 linhas | OK |
| Rodapé: agy 7 % semanal (coincide com /quota), Codex e Claude marcados como antigos | OK |
| Configurações: as 8 seções são desenhadas; detecta a statusline quebrada | OK |

### Bugs encontrados no teste final e corrigidos
- **Rodapé em loop**: `load()` lia um sinal dentro do seu efeito → 60 layouts por segundo, nós
  crescendo e o renderer em 180 MB (RAM total 373 MB). Com `untrack` o renderer cai para ~45 MB.
- A API lia as últimas linhas da tela (vazias) em vez de até o cursor.
- A integração só era marcada com o primeiro comando: `run` não podia esperar em uma aba nova.
- O menu da aba fechava antes de aplicar a ação (o Solid não deixa ler seu valor já fechado).
- Linha clara à direita da terminal: a borda do "overview ruler" do xterm.

### Medições (release, 18/11/2026)
| Medição | Resultado | Meta do plano |
|---|---|---|
| Inicialização até o primeiro prompt | 1,2–1,4 s (o PowerShell 5.1 sozinho leva ~0,18 s) | < 500 ms — **não** |
| RAM privada com 1 aba (AlphaTerm + WebView2) | ~225 MB (renderer 45, GPU 108) | < 120 MB — **não** |
| Throughput | no nível do Windows Terminal (F1: o limite é a ConPTY) | comparável — sim |
| Latência de tecla | não medida | < 10 ms — sem dado |

A RAM e a inicialização são dominadas pelo WebView2 (o processo de GPU cresce com a janela transparente e o WebGL).
Baixar disso pediria outro motor de interface: não foi feito.

### Pendente / não verificado
- **Docker com um contêiner real**: não há imagens na máquina e baixar uma é um download
  (pergunta-se antes).
- **Claude Code com uma tarefa real** passando pelo hook: foi testado o script com o mesmo JSON que
  o Claude envia e que o Claude aceita as duas flags; não foi aceito o "confiar na pasta" (muda sua
  configuração) nem foi dada uma tarefa (gasta cota).
- Codex e agy iniciados pelo painel; o modo de aprovação do Codex com `-s read-only -a on-request`.
- Resumo com um modelo de verdade (no Ollama não há modelos; baixar um é um download).
- Os seletores de pasta nativos (não podem ser conduzidos com computer use).
- A sessão não guarda tamanho nem posição das janelas.
- Empacotamento (exe solto ou instalador NSIS): decisão do Bruno.
- ~~A pasta do projeto continua sendo `Desktop\NovaTerm`~~: renomeada para `Desktop\AlphaTerm` em
  18/11/2026 (com a sessão do Claude Code fora da pasta e o app fechado).

### Stats
- Commits: F3 `8b4a54b`, F4 `9ce06bc`, F5 `3b94920`, F6 `b617faf`, F7 `38c09ad`, F8 `de356a4`,
  renomeação `85f31a8`, extras e F9 até `cef9654`.
- Testes: Rust 55 (+3 ignorados), Vitest 96. Todos verdes.
- Binário release: alphaterm.exe 14,9 MB (+ conpty.dll e OpenConsole.exe).

---

## Depois da entrega (18/11/2026)

- **Claude Code sem cores dentro do AlphaTerm** (visto pelo Bruno): o AlphaTerm tinha sido aberto a partir
  desta sessão do Claude Code e as shells herdavam seu ambiente: `NO_COLOR=1` (desliga as cores) e
  ~30 variáveis `CLAUDE_CODE_*`, incluindo tokens e a marca de sessão filha (daí o aviso
  "Transcript saving is off"). Agora as shells são criadas sem essas variáveis, a menos que estejam no
  ambiente persistente do Windows. Verificado: abrindo o AlphaTerm a partir da mesma sessão, a shell
  fica sem NO_COLOR nem CLAUDE_*, e o Claude Code é visto com cores.
- O `build.rs` deixou de copiar a ConPTY depois de renomear a pasta (o caminho ficava fixo no build
  script compilado): agora o lê ao rodar.
- Testes: Rust 56 (+3 ignorados), Vitest 96.

---
## Uso em tempo real, alterações de arquivos e ajustes (20/11/2026)

Pedidos do Bruno, em ordem:

1. **Janela de cmd que aparecia e sumia a cada tantos minutos.** Causa: `agy -p /quota` (a consulta
   de cota do rodapé, a cada 10 min) iniciava o atualizador do agy ("Spawned background update
   process", no seu log) fora do console escondido. O System dashboard já o evitava com
   `AGY_CLI_DISABLE_AUTO_UPDATE=true` (o agy só aceita "true"); o AlphaTerm faz o mesmo. Verificado
   com um vigia de processos e janelas sobre o AlphaTerm novo: 0 janelas de console em 3 minutos
   com uma rodada completa de consultas (Claude, Codex e agy).
2. **Uso como o System dashboard, sem precisar usar o agente.** `usage_live.rs`: ao abrir o
   AlphaTerm e a cada N minutos (Configurações, 15 por padrão) abrem-se `claude` e `codex` em uma ConPTY
   sem janela, escreve-se `/usage` ou `/status` e lê-se a tela com `vt100`; o agy continua com seu
   `/quota` em JSON. Vence o dado mais novo entre a consulta e os arquivos (statusline, sessões do
   Codex). O Claude vai com `--strict-mcp-config` e `disableAllHooks` (não sobe servidores MCP nem hooks).
   Tropeço: responder `ESC[6n` (onde está o cursor) fazia o Codex receber a resposta como
   texto digitado; sem responder funciona, como no dashboard. Tempos medidos: Claude 9 s, Codex 16 s,
   agy 5 s. Não ficam processos pendurados.
3. **Painel de alterações** (Ctrl+Shift+M, `changes.rs` + `ChangesPanel.tsx`): o que os
   agentes mudam em arquivos de texto, código e PDF (pelo seu texto), com ou sem git (etiqueta "em git"),
   lado a lado ou unificado, abrir um ou todos, recolher todos. Fontes: hook Pre/PostToolUse do
   Claude Code iniciado a partir do AlphaTerm (exato) e, para qualquer agente, a pasta da sua aba
   (cópia ao iniciar + vigia). O que não entrou na cópia é comparado com o último commit ou é
   mostrado inteiro. É guardado por 7 dias em `changes.json`.
4. **Editar e salvar a partir desse painel**: respeita a codificação (UTF-8 com ou sem BOM, UTF-16, ANSI) e
   o fim de linha, e não salva se o arquivo mudou desde que foi aberto.
5. **RAM em porcentagem** (botão, detalhe, e por aba e processo).
6. **Uso detalhado no painel de agentes**: embaixo de cada agente, plano, modelo, cada janela
   com seu reinício (contagem regressiva e hora), por modelo (Claude: semana por modelo e "o que mais
   consome"; agy: grupos com seus modelos), uso extra e previsão semanal no ritmo de agora.
7. **Barra de abas vertical recolhível** (ficam o estado e a inicial de cada aba).
8. **CPU e RAM na barra vertical**: o gráfico vai embaixo de cada número; com a barra recolhida
   ficam só os números (antes o widget se escondia ao recolher).
9. **Versão no rodapé** (`v0.2.0`; tooltip com commit, data de compilação e caminho do exe) e em
   Configurações → Sobre. A versão passa a 0.2.0.
10. **Instalar por versão e atualizar o atalho**: `npm run release` compila e roda
    `scripts/install.mjs`, que copia para `%LOCALAPPDATA%\AlphaTerm\versiones\<versão>` e aponta para lá o
    atalho da área de trabalho e a fixação na barra de tarefas. Antes apontavam para
    `target\release\alphaterm.exe`, que não pode ser sobrescrito enquanto o AlphaTerm está aberto.
11. **`build-release.bat`** na pasta do projeto (clique duplo): compila (em `target\prueba`
    se `target\release\alphaterm.exe` estiver aberto) e instala, deixando na área de trabalho o atalho
    "AlphaTerm <versão>" (renomeia o anterior). Com CRLF.
12. **Colar imagens**: Ctrl+V (ou clique direito) com uma imagem na área de transferência e sem texto a
    salva como PNG em `%TEMP%\AlphaTerm\pegadas` e cola seu caminho; o Claude Code e o Codex a anexam.

Outros: os binários de teste do Rust não iniciavam (STATUS_ENTRYPOINT_NOT_FOUND: TaskDialogIndirect
precisa dos controles comuns v6); o manifesto agora é incorporado pelo linker para todos os binários.
`ALPHATERM_DATA_DIR` permite abrir uma versão nova ao lado da que está em uso.

### Teste no app (release à parte, CDP)
- Rodapé com dados em tempo real ao abrir (Claude 5 h e semana, Codex semana, agy). Painel de agentes com
  o detalhe dos três. Sem janelas de console.
- Hook: o script real (`guardian-hook.mjs`) com a entrada do Claude Code: Edit de um `.md` (+2 −1),
  Write de um arquivo novo ("novo") e de um PDF (−"Total: 100", +"Total: 250"). Abrir todos, diff.
- Edição: Ctrl+S salva em disco ("editado à mão"); se o arquivo muda enquanto se edita, não
  salva e explica.
- Bug encontrado no teste: não eram vigiadas pastas dentro do AppData (excluía todo o AppData, e o
  projeto de teste estava no Temp). Agora são excluídas só as raízes (usuário, AppData, Temp).
- Vigia de pastas, já corrigido: com o Codex aberto no projeto, `plan.txt` novo (+3) e
  `compras.txt` (+2 −1) ficam em nome do Codex; `node_modules` e um temporário são ignorados; apagar
  `plan.txt` é registrado.
- CPU/RAM: na barra vertical, o gráfico embaixo do número; recolhida, só os números.
- `build-release.bat` de ponta a ponta: compilou em `target\prueba` (a antiga estava aberta),
  instalou a 0.2.0, renomeou o atalho para "AlphaTerm 0.2.0" e atualizou a fixação. A versão
  instalada mostra "v0.2.0+" no rodapé.

### Pendente / não verificado
- Colar uma imagem com uma captura real (a área de transferência do Bruno não foi tocada; o salvamento do PNG
  tem teste).
- O hook com uma sessão real do Claude Code editando (foi testado com o script real e a mesma entrada).

### Stats
- Testes: Rust 72 (+6 ignorados: consultas reais ao Claude, Codex e agy), Vitest 104. Todos verdes.
- Binário release: alphaterm.exe 17,4 MB (+ conpty.dll e OpenConsole.exe). Versão 0.2.0.


## Barra vertical ajustável e opções de inicialização dos agentes (20/11/2026, tarde)

1. **Botão de recolher a barra vertical**: o `«`/`»` passa a ser um ícone de barra lateral desenhado
   (moldura arredondada com um tracinho à esquerda, o mesmo nos dois estados).
2. **Largura da barra vertical**: arrasta-se sua borda direita (160 a 480 px, e deixa pelo menos 360 px
   para as terminais). É guardada ao soltar em `tabBar.width`; clique duplo volta a 220 px. Recolhida
   continua em 48 px e ao expandir recupera a largura escolhida.
3. **Opções de inicialização dos agentes** (no lugar do botão de editar do painel de agentes): um
   botão com controles deslizantes abre, colado à linha do agente, modelo (lista que filtra ao digitar),
   esforço (controle deslizante; a primeira posição é "padrão"), permissões e modos, caixas de sessão
   (continuar, retomar, worktree, primeira mensagem) e "Mais opções" (pastas extras, system prompt,
   ferramentas, Chrome, debug, etc.), com a linha de comando que vai rodar. O que havia antes (nome,
   comando, variáveis, ocultar, apagar) ficou em "Avançado".
   - Catálogo em `src/panels/agentLaunch.ts`, levantado do `--help` das versões instaladas
     (Claude Code 2.1.329, Codex 0.170.0, agy 1.5.13, OpenCode 1.19.1) e da documentação oficial.
     O OpenCode 2.x mudou as flags da sua interface (sem --model nem --agent): o catálogo é o da 1.x.
   - Modelos em tempo real: comando `agent_models` (Rust). Codex a partir de `~/.codex/models_cache.json` (com
     os níveis de raciocínio de cada modelo: o controle deslizante muda conforme o modelo), agy com
     `agy models` e OpenCode com `opencode models`, sem janela e uma vez por sessão (↻ para reler).
     O Claude não tem lista: é fixa (aliases e nomes completos).
   - Opções que conflitam (ex. Codex `--approve-for-me` com `--sandbox`, Claude
     `--dangerously-skip-permissions` com `--permission-mode`): a que fica de fora aparece cinza, com
     "Não se usa junto com …", e não é enviada. As perigosas, em vermelho.
   - Aspas conforme a shell do perfil (PowerShell 5.1, pwsh, cmd, bash). No PowerShell 5.1 as
     aspas duplas internas vão como `\"` (se não, perdem-se ao passar o argumento ao .exe).
   - A primeira mensagem vai primeiro (antes de flags como `--add-dir`, que engolem o que vem depois). No
     Codex, retomar é o subcomando `resume`, que vai antes de tudo.
   - São guardadas por agente em `agents[].launch` e valem para cada "Iniciar" (painel, Projetos e ao
     reabrir a sessão; ao reabrir não se repetem as de sessão, porque já se retoma).
   - Codex: se as opções já dizem como aprovar, o AlphaTerm não soma `-s read-only -a on-request`.
4. **Bug encontrado e corrigido**: o painel de agentes iterava objetos e cada mudança da
   configuração remontava a linha (perdia-se o foco e o que estava aberto). Agora itera ids.

### Teste no app (release à parte com dados próprios, CDP + API de controle do de teste)
- Ícone igual ao pedido; arraste a 331 px salvo, limites 160 e 480, clique duplo a 220, recolher e
  expandir.
- Claude: opus + high + plan → a linha, o resumo sob o nome e o salvo coincidem; iniciado,
  mostra "Opus 5.5 with high effort" e "plan mode on". Pular permissões deixa cinza o que conflita.
- Codex: 10 modelos do cache; com gpt-6-luna o controle deslizante perde "ultra". Iniciado com
  `-c model_reasoning_effort=xhigh --approve-for-me --search`: inicia sem erro e sem o `-s` do
  Guardião.
- agy: 23 modelos (2 s). Iniciado com `--model gemini-4-neon --effort xhigh --mode auto --sandbox
  --settings '{\"toolPermission\":\"proceed-in-sandbox\"}'` no PowerShell 5.1: mostra "Gemini 4 Neon
  (XHigh)" e "Auto mode".
- OpenCode: 121 modelos (2 s). Não foi iniciado.

### Pendente / não verificado
- OpenCode iniciado com opções; a primeira mensagem (não foi enviada para não gastar); aspas no cmd e
  no Git Bash (têm teste, sem teste no app).

### Stats
- Testes: Rust 74 (+6 ignorados), Vitest 111. Todos verdes.

## Navegador integrado com marcação de elementos (20/11/2026)

Pedido: uma visualização de navegador dentro do AlphaTerm onde o agente veja o app que subiu,
interaja, tire capturas, e onde o usuário marque elementos (como a primeira versão do Claude
Design) para pedir alterações em tempo real. Decisões do Bruno: o pedido vai ao agente que já
trabalha no projeto, na sua aba, como se fosse digitado (opção 1); o navegador é um WebView2
filho dentro da janela (opção A, em vez de janela colada ou Chrome transmitido como vídeo); é
um tipo de painel novo; Claude Code com aviso exato de "pronto", os demais por silêncio.

### O que foi feito
- `src-tauri/src/browser.rs`: WebView2 filho (`Window::add_child`, feature `unstable`) sobre o
  retângulo do painel; CDP por `CallDevToolsProtocolMethod` (capturas da visualização, da página inteira e
  recortes; clique, texto, teclas, scroll, eval); eventos `Runtime.bindingCalled` (marcas),
  `consoleAPICalled` e `exceptionThrown` (console da página); janelas novas abrem no mesmo
  painel; o pedido monta `pedido.md`, `marcas.json` e as capturas em `%TEMP%\AlphaTerm\navegador`.
- `scripts/browser-overlay.js`: modo de edição (destaque ao passar o mouse com etiqueta e componente,
  clique marca com número sem disparar a página, Alt+clique o pai, Esc sai), dados de cada marca
  (seletor único, HTML, estilos calculados, posição, componente e arquivo-fonte do React —
  `_debugSource` ou a pilha do React 19 —, Vue 2/3, Svelte e Angular), detecção de hot reload,
  e a estrutura da página como texto para o agente.
- Frontend: folha `browser` no modelo (é guardada na sessão), `src/browser/BrowserView.tsx`
  (barra com URL, Editar, Site inteiro, erros do console; marcas como chips; pedido com para qual
  terminal vai; "Montando… / Trabalhando… / Precisa de você / Pronto ✓"), é escondido se um menu ou modal
  se sobrepuser a ele ou ao trocar de aba. É aberto com Ctrl+Shift+U, a partir de Servidores ("Abrir no
  navegador", ao lado da aba onde nasceu) ou pela API.
- API/MCP: `browser_open/list/navigate/reload/screenshot/snapshot/click/type/key/scroll/eval/
  console/marks`; a captura volta como imagem pelo MCP. Hook Stop do Claude Code (`agent_stop`), em
  `claude-guardian.json` e em `claude-stop.json` (se o Guardião não estiver).
- Correção de passagem: com um WebView filho, o Tauri já não conta a janela em `webview_windows()`; a API
  de controle, o Guardião e o fechamento de janelas passaram para `app.windows()`.

### Teste no app (release à parte com dados próprios, CDP na 9339)
Site de teste com recarga automática e um "agente" falso (lê o que foi colado, mostra um spinner 4 s e
muda a cor do botão no HTML):
- Aberto pela API como um agente faria: painel ao lado da sua terminal, camada injetada, função
  `__alphaterm` viva, hot reload detectado.
- Modo de edição: o clique marca e não dispara o `onclick` da página; duas marcas com componente
  `SubmitButton` e arquivo `src/components/SubmitButton.tsx:12` (fibra simulada); chips na UI.
- Pedido: o agente recebeu o texto com os caminhos; "Trabalhando…" aos 0,5 s, "Pronto ✓" aos 7,8 s,
  o botão ficou azul (a página recarregou sozinha) e as marcas foram limpas. Capturas corretas
  (visualização com números e recorte do botão).
- Ferramentas de agente: snapshot com seletores, clique real ("clic 1"), texto com ñ e acento,
  Ctrl+A, scroll, eval, captura inteira e de um elemento, erro de console, seletor inexistente com
  erro claro; pelo MCP a captura chega como imagem.
- Hook Stop simulado (mesmo JSON que o Claude Code envia): passa a "Pronto" enquanto o agente continua.
- Pedido global: inclui a captura da página inteira.
- É escondido com Novidades aberto e em outra aba; volta ao fechar ou ao voltar.
- Fechar e reabrir: o painel volta com sua URL e seu dono.

### Pendente / não verificado
- Claude Code de verdade recebendo um pedido (não se gastou uma tarefa real): foi testado o hook com seu
  JSON e o colar com um programa que pede bracketed paste.
- React/Vue reais (a detecção foi testada com uma fibra simulada); páginas com iframes (a camada
  só marca o documento principal).
- Arrastar um divisor sobre o navegador: enquanto se arrasta, o navegador é escondido.

### Stats
- Testes: Rust 77 (+6 ignorados), Vitest 122. Todos verdes.

## Sugestões de comandos (21/11/2026, branch `predicciones`)

Pedido do Bruno: "um sistema preditivo de comandos na shell, mantendo o histórico se eu apertar
para cima e que me apareça um menu de possíveis pastas de onde estou se eu digitar cd"
(e com `ping`, os IPs mais comuns; "assim com todos os comandos"). Design e plano em
`docs/pt/specs/2026-11-21-command-suggestions*.md`. Abordagem escolhida: menu próprio com fontes próprias
(pastas, histórico, catálogo) + completamentos da própria sessão do PowerShell.

### O que foi feito
- `src/suggest/`: ler a linha do prompt a partir da tela (do 133;B até o cursor), separar
  palavras com aspas (no cmd só `"`), catálogo próprio em espanhol (~60 comandos: arquivos, rede,
  sistema, git, npm, docker, winget, agentes…; os internos do cmd que no PowerShell são aliases de
  cmdlets vão só para o cmd), motor que junta histórico, catálogo, pastas, PATH e PowerShell com
  ordem e sem repetidos, inserção com backspaces e aspas, teclas do menu, controlador e menu.
- PowerShell: `alphaterm.ps1` registra o atalho `F12,e` com o PSReadLine; roda `TabExpansion2` e
  responde em uma OSC 7717 invisível com um nonce por sessão (`ALPHATERM_NONCE`, é apagado do
  ambiente). É pedido após 150 ms sem teclas, nunca para comandos do catálogo nem caminhos de rede nem
  depois de Tab/Ctrl+R; se uma resposta demora mais de 300 ms, essa aba só pede com Ctrl+Espaço.
- Rust (`suggest.rs`): listar pastas (cache 3 s, sem ocultas, máx. 500), gateway
  (`GetBestRoute` a 8.8.8.8), executáveis do PATH, scripts do npm e processos.
- o cmd agora guarda histórico: a linha é lida no Enter e `running` passa a true até o próximo
  prompt (também o veem o estado da aba, o de agentes e Servidores).
- Teclas: ↑ é sempre o histórico exceto navegando pelo menu; ↓ navega; Tab insere; Enter executa
  (insere só se navegou); Esc fecha; Ctrl+Espaço abre à mão (no PowerShell substitui o
  `MenuComplete` enquanto as sugestões estiverem ativadas).
- Configurações → Terminal: ativadas / ao digitar ou só com Ctrl+Espaço / completamentos do PowerShell.

### Teste no app
- Risco 1 (atalho escondido pela ConPTY) verificado primeiro com um teste de integração real
  (`powershell_completa_con_f12`): chega, responde `Get-ChildItem` e as pastas para `cd `, e o
  nonce não fica no ambiente.
- Versão de desenvolvimento e release à parte (`target\prueba`, dados e WebView2 próprios, CDP na 9333,
  sem tocar no AlphaTerm aberto):
  - PowerShell: `cd ` com pastas, `..` e `~`; Tab desce para subpastas; ↓ + Enter insere sem
    executar; Enter executa; ↑ traz o histórico e não abre o menu; Esc fecha sem apagar a linha;
    `Get-Ch` e `Get-ChildItem -Fi` com resultados da própria sessão; Ctrl+Espaço; nada de menu
    dentro do `node`.
  - cmd: `ping ` com 8.8.8.8, 1.1.1.1, o roteador (192.168.1.1, lido em tempo real), localhost e opções;
    nada de menu enquanto o `ping` roda; `cd 3d` → `cd "3D Objects\\"` e continua descendo; histórico do cmd
    guardado tal como foi digitado.
  - Tela limpa: o atalho escondido não deixa nada visível.
- Correções que saíram do teste real (cada uma com seu teste que falhou primeiro): o menu ficava
  uma tecla atrás (um aviso de saída antes do eco consumia a marca; agora compara-se a linha);
  o histórico de `cd` de outras pastas cobria as pastas; o título do cmd metia um espaço a
  mais no histórico; o que vinha do PowerShell ganhava do catálogo na primeira palavra e repetia `.exe`;
  `dir /` no cmd listava a raiz do disco em vez das opções.
- Revisão de todo o branch por um revisor à parte ("com correções", nada crítico). Corrigido, cada um com
  seu teste: uma inserção pendente podia ser escrita depois do Enter (agora é cancelada e nunca é
  escrita fora do prompt); a espera do eco passou a comparar a linha esperada (uma saída alheia já
  não conta como eco); nada com caracteres de controle é oferecido (um script do npm "x\rcalc\r" teria
  sido executado); entre aspas a barra final vai dobrada (`"AI PROJECTS\\"`: com uma só, git
  ou node recebem o argumento quebrado, verificado neste PC; cd e Set-Location aceitam a dobrada); os
  valores que já trazem aspas não são entre-aspeados de novo; cache de 4 s nos geradores (git,
  docker, processos) em vez de um processo por tecla; o histórico de outras pastas volta para os
  comandos que o catálogo não conhece. Os menores ficaram anotados (veja abaixo).

### Pendente / não verificado
- PowerShell 7 (não está instalado em casa) e PSReadLine com predições próprias (2.2+), que podem
  desenhar texto em cinza depois do cursor: o menu não aparece se houver algo escrito depois do cursor.
- Testá-lo no uso diário do Bruno (branch `predicciones`, atalho "AlphaTerm prueba
  (predicciones).bat" na área de trabalho, com dados à parte).
- Linhas longas quebradas e comandos de várias linhas: coberto por testes, não testado à mão.
- Menores da revisão sem fazer: pastas com mais de 500 entradas (são cortadas antes de filtrar),
  aceitar um comando do menu não abre o menu seguinte, o primeiro ↓ só marca a linha 1, o
  nonce vai para todos os perfis, sem aviso visível quando uma aba deixa de perguntar ao
  PowerShell, detalhes do catálogo (cd /d no PowerShell, chdir/mklink/title/ver/for), e anotar no
  CLAUDE.md o protocolo 7717/F12,e e que toda escrita na shell passa por `toShell`.

### Stats
- Testes: Rust 84 (+6 ignorados), Vitest 206. Todos verdes.

## Painéis: barrinha, mover e divisores (23/11/2026, branch `paneles`)

Pedido do Bruno: "poner split view de multiples ventanas", e depois "agregá los botones de dividir
y cerrar, tambien el poder moverlas como si fuera snap, osea cambiar el orden o el tamaño". Design e
plano em `docs/pt/specs/2026-11-23-pane-bar-and-snap-*.md`. Abordagem escolhida pelo Bruno: uma
barrinha fixa em cima de cada painel (em vez de botões flutuantes).

### O que foi feito
- Barrinha de 22 px em cada painel de terminal: nome (agente ou shell · pasta), ⇥ dividir à
  direita, ⤓ dividir abaixo, × fechar. Destacada no painel em foco. Clique direito: Dividir à
  direita, Dividir abaixo, Igualar tamanhos, Fechar painel. O navegador soma a alça ⋮⋮ e ⇥ ⤓.
- × e "Fechar painel" perguntam se há algo rodando (agente ou comando), com uma pergunta própria
  dentro do app (`askConfirm`): `window.confirm` não pergunta no AlphaTerm (veja Pendente).
- Mover: arrasta-se a barrinha (limiar de 5 px); sobre a metade de outro painel fica desse lado,
  no centro eles se trocam; pinta-se onde vai ficar. Esc, perder o foco ou pointercancel
  cancelam. O navegador é escondido enquanto se arrasta.
- Divisores: zona de 9 px, param em ⅓, ½ e ⅔ (a 12 px ou menos), clique duplo deixa metade e metade.
- Modelo com testes: `movePane`, `swapPanes`, `equalize`, `paneAt`, `dropZone`, `zoneRect`,
  `snapRatio`; `paneBusy`; o controlador do arraste (`paneDrag.ts`) com testes próprios.

### Teste no app (exe de debug + Vite, dados e WebView2 próprios, CDP na 9333)
- ⇥ e ⤓ dividem o painel dessa barrinha; o novo fica destacado; × sem nada rodando fecha.
- Com `ping -t localhost` rodando, × e "Fechar painel" perguntam ("Fechar este painel? Isso interrompe o
  que está rodando nele (PING · Br1)."), com o foco em Cancelar; Esc e Cancelar não fecham.
- Arrastar o painel do ping para a metade esquerda de outro: fica à esquerda, é o mesmo nó
  da terminal (marca no DOM intacta) e o processo PING continua vivo. O centro troca. Esc,
  blur e um clique sem mover não mudam nada e deixam o body limpo.
- Esc no meio de um arraste não chega à shell (uma linha escrita no PowerShell continua ali; um Esc
  direto a apaga).
- Com um navegador: durante o arraste ele é escondido e a zona é pintada; ao cancelar volta. O
  navegador é movido pela sua alça.
- Divisor: perto de ⅓ fica em 0,3333; a 9 px de ⅔ fica em 0,6667; longe fica onde é solto
  (0,42); clique duplo 0,5; "Igualar tamanhos" 0,5.
- Fechar a janela de teste e voltar a abri-la recupera a distribuição movida.
- Descoberta: `window.confirm` está substituído pelo plugin de diálogos do Tauri (função async →
  promise, sempre "sim") e o app não tem a permissão: nenhum dos `confirm()` do app
  pergunta. Para não mostrar perguntas depois de agir, a permissão não foi adicionada.

### Pendente / não verificado
- Corrigido a pedido do Bruno: os 13 `confirm()` antigos (parar um servidor, ainda que não tenha sido
  iniciado pelo AlphaTerm; apagar contêiner do Docker; voltar a configuração ao padrão de fábrica; mudar a
  statusline do Claude Code; apagar temas, receitas, presets do Docker e agentes do catálogo;
  trocar de branch com alterações; criar repositório; esvaziar alterações; descartar edição; fechar pasta
  de abas) passaram para `askConfirm`, com um botão que diz o que faz ("Parar", "Apagar",
  "Voltar ao padrão de fábrica"…). `scripts/no-confirm.test.mjs` falha se voltar a aparecer um solto.
- Testá-lo no uso diário do Bruno (atalho "AlphaTerm prueba (paneles).bat").
- Com um agente real trabalhando (Claude Code) enquanto seu painel é movido: testado com `ping`, não com
  um agente.

### Stats
- Testes: Vitest 229 (+23: modelo 11, sessão 1, estado 1, arraste 7, confirmação 3, guarda de
  `confirm()` 1). Sem mudanças no Rust.

## Idiomas: espanhol, inglês e português (24/11/2026, branch `i18n`, versão 0.7.0)

Pedido do Bruno: o AlphaTerm tem que poder ser usado inteiro em espanhol, inglês ou português, com a
documentação, as Novidades e as descrições da API também nos três, para publicar o repositório como
open source.

### O que foi feito
- Base (`src/i18n/index.ts`): `t("texto em espanhol")` traduz para o idioma atual (um sinal do Solid:
  no JSX atualiza sozinho ao trocar o idioma), `k()` marca textos de constantes, `locale()` para
  datas e números. Dicionários por área em `src/i18n/en|pt/*.json` com o texto em espanhol como
  chave. `scripts/i18n-check.mjs` (com teste) confere faltantes, sobras, {variáveis} e conflitos.
- Configurações: seção nova "Idioma" (a primeira da lista, com 🌐) com Español / English /
  Português; a troca vale na hora em todas as janelas. Instalação nova: o idioma do Windows;
  configuração antiga: espanhol.
- Interface completa: 1179 textos traduzidos para inglês e português (configurações e atalhos,
  agentes, painéis laterais, janela e abas, navegador, terminal, uso, Guardião, sugestões com todo o
  catálogo, Novidades).
- Backend Rust (`src-tauri/src/i18n.rs`): ~195 mensagens com as três versões (erros, Guardião, uso,
  API de controle, pedido do navegador). `set_locale` a partir do frontend; lido do settings.json ao
  iniciar. As abas novas recebem `ALPHATERM_LANG`.
- Scripts para agentes: o servidor MCP (27 ferramentas, ~62 textos), o hook do Guardião e a camada do
  navegador, nos três idiomas.
- Novidades: os 60 commits anteriores traduzidos (`src/i18n/changelog/en|pt.json`, chave = assunto);
  `changelog.mjs --faltan`, e o `release.mjs` para se faltar uma tradução.
- Documentação em inglês e português (`docs/en|pt`, `CLAUDE.en.md`, `CLAUDE.pt.md`, avisos
  do ConPTY) e seus PDFs (`generate_pdfs.py` agora gera por idioma: `python docs/generate_pdfs.py
  en pt`), README em três idiomas (com capturas da interface em inglês), licença MIT e avisos de terceiros.
- O trabalho foi feito em paralelo por área (dez agentes, cada um com seus arquivos e dicionários); a
  integração unificou traduções repetidas e corrigiu o que cruzava áreas: o atalho de cada painel é
  buscado pelo id (antes comparava rótulos), e os rótulos de uso, as decisões do Guardião e "Símbolo
  del sistema" ficam em espanhol como ids e são traduzidos ao exibir.

### Pendente / não verificado
- Revisão das traduções por alguém que fale inglês ou português.

### Stats
- Testes: Vitest 241 (+12), cargo 86 ok + 6 ignorados (+2). tsc sem erros.
