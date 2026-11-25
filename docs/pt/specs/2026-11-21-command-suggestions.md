# Sugestões de comandos na terminal — design

> Traduzido do original em espanhol (`docs/es/specs/2026-11-21-command-suggestions.md`). A versão em espanhol é a fonte de verdade.

Data: 21/11/2026. Estado: rascunho para aprovar.

## Para quê

O Bruno quer que o AlphaTerm lhe sugira o que digitar enquanto ele escreve no cmd ou no PowerShell: com `cd`,
as pastas de onde ele está; com `ping`, os IPs e hosts típicos; e o mesmo para os demais
comandos. O que ele pediu explicitamente: "um sistema preditivo de comandos na shell, mantendo
o histórico se eu apertar para cima, e que me apareça um menu de possíveis pastas a partir de onde
estou se eu digitar cd".

Leitura própria (ele não disse): o valor está em digitar menos os comandos do dia a dia
(histórico, pastas) e em não precisar lembrar da sintaxe dos que usa pouco (catálogo com
opções explicadas).

## Objetivos

- Um menu que aparece embaixo do cursor enquanto se escreve no prompt do **cmd** e do
  **PowerShell (5.1 e 7)**, com sugestões para o comando e para seus argumentos.
- `cd ` mostra de imediato as pastas da pasta atual (e `..`), filtradas pelo que vai sendo
  digitado; ao escolher uma, dá para continuar descendo (`cd src\` → subpastas de `src`).
- Predição a partir do histórico: se o que foi digitado é o começo de um comando já usado
  (`git p` → `git push origin main`), aparece como sugestão, com prioridade se foi nesta pasta.
- Valores típicos por comando a partir de um catálogo próprio (ex. `ping` → 8.8.8.8, 1.1.1.1, o roteador,
  localhost, google.com e os hosts que já foram usados).
- No PowerShell, além disso, o que a própria shell sabe (todos os cmdlets, seus parâmetros, módulos
  instalados, variáveis, caminhos) pedindo os completamentos à sessão aberta.
- A seta para cima continua sendo o histórico da shell, como hoje.

## Não objetivos (v1)

- Git Bash, WSL e perfis custom: sem menu (a base fica pronta para somá-los depois).
- Predição em cinza ao lado do cursor (estilo fish/Warp). Foi descartada como abordagem; pode
  ser somada depois.
- Sugestões dentro de programas que rodam na terminal (Claude Code, Codex, python, ssh…).
- Usar as predições do PSReadLine ou atualizar o PSReadLine.
- Importar catálogos alheios (ex. as specs do Fig): o catálogo é próprio e em espanhol.
- Cursor no meio da linha: o menu só aparece com o cursor no fim do que foi digitado.

## Anti-objetivos (se isso acontecer, falhou mesmo que "funcione")

- Que a seta para cima deixe de trazer o histórico quando não se está navegando pelo menu.
- Que o menu apareça ou que o AlphaTerm envie teclas enquanto um programa ou um agente está rodando.
- Que digitar fique mais lento ou que as teclas se invertam (gotcha conhecido: tudo passa por
  `WriteQueue`).
- Que Esc, Tab ou Enter façam algo diferente do de sempre quando o menu não está aberto.
- Que o menu cubra o navegador integrado (nada da interface pode cobrir o WebView2 filho).

## O que já existe e condiciona o design

- Integração de shell (`src-tauri/shell/alphaterm.ps1`, `src-tauri/src/pty/integration.rs`):
  o PowerShell emite OSC 133 A/B/C/D, 633;E (texto do comando) e OSC 7 (pasta). O cmd só tem a
  variável PROMPT: 133;D sem código, 9;9 com a pasta, 133;A/B em volta do prompt. **O cmd não
  avisa qual comando foi executado nem quando ele começa.**
- `TerminalView.tsx` interpreta essas marcas (`parse133`, `parse633`, `parseOsc7/9`), conhece a pasta
  atual (`cwdNow`), se há um comando rodando (`running`) e se a shell tem integração.
  As teclas vão de `term.onData` direto para `session.write` (com `WriteQueue`); os atalhos são
  interceptados em `attachCustomKeyEventHandler`.
- Histórico: `history.rs` (`history_add`, `history_search`), em `%APPDATA%\AlphaTerm\history.jsonl`.
  É alimentado pelo `Workspace.tsx` quando uma aba passa de `running` a não `running` com um
  `lastCommand`. Hoje tem só comandos do PowerShell.
- O PowerShell 5.1 de casa traz o PSReadLine 2.0.0 (sem predições próprias).
- Navegador integrado: os menus novos vão em `FLOATING` (`src/browser/marks.ts`) para que o
  WebView2 se esconda se eles se sobrepuserem a ele.
- Configuração: esquema em `src/settings/schema.ts`, visualização em `SettingsView.tsx`.
- Git e Docker pela CLI, sem shell no meio (`git.rs`, `docker.rs`).

## Abordagens consideradas

1. **Menu próprio com fontes próprias**: o AlphaTerm lê a linha da tela e monta as opções
   com pastas/arquivos, histórico e um catálogo escrito à mão. Igual no cmd e no PowerShell; o
   catálogo cobre os comandos comuns, não "todos".
2. **Perguntar ao PowerShell**: como o VS Code, um atalho de teclado escondido faz com que a sessão
   aberta rode `TabExpansion2` e devolva os completamentos por uma sequência invisível. Sabe tudo
   do PowerShell; só serve no PowerShell e exige cuidar da sincronia com o que foi digitado.
3. **Uma predição em cinza** ao lado do cursor: rápida para repetir, mas não dá a lista de
   pastas. Descartada como abordagem principal.
- Descartado também: ativar as predições de um PSReadLine mais novo (só PowerShell, só
  histórico, sem pastas).
- Variante avaliada para a 2: um PowerShell escondido à parte a quem perguntar. Não precisa
  enviar teclas, mas não conhece o que é da sessão (variáveis, funções, módulos carregados) e soma um
  processo (~60–80 MB, com a meta de RAM já descumprida). Fica só como plano B se o atalho
  escondido não funcionar através da ConPTY.

**Escolhido pelo Bruno: 1 + 2.** A 1 é a base nas duas shells; no PowerShell somam-se os
completamentos da própria sessão.

## Como funciona

### Quando pode ser mostrado (estado "no prompt")

Uma aba está *no prompt* se tudo isto for verdade:
- o perfil é `cmd`, `powershell` ou `pwsh`, e chegou pelo menos um 133;B (integração viva);
- depois do último 133;B nenhum Enter foi enviado à shell. Conta qualquer Enter: tecla,
  comando do painel de agentes, `send` do histórico, texto colado com quebra de linha. A verificação
  fica em um único lugar por onde passam todas as escritas da aba, não só em `onData`;
- o buffer alternativo não está ativo (`term.buffer.active.type !== "alternate"`);
- `running` é falso.

O estado volta a ser verdadeiro com o próximo 133;B. Se não está no prompt, o menu é
fechado e o AlphaTerm não envia nada à shell.

### Ler o que está sendo digitado

- Quando chega o 133;B guarda-se a posição exata onde o prompt termina: um marcador de linha do
  xterm mais `cursorX` naquele momento (o handler de OSC roda de forma síncrona com o parsing, então o
  cursor está ali).
- Depois de cada escrita da shell (`onWriteParsed`) monta-se a linha atual: o texto a partir
  dessa posição **até o cursor**, juntando as linhas quebradas (`isWrapped`). O que houver
  depois do cursor é ignorado.
- Se o cursor não está no fim do que foi digitado, ou a entrada tem mais de uma linha lógica
  (continuação `>>` do PowerShell), não há menu.
- A linha é separada em palavras respeitando aspas. A palavra atual é a que toca o cursor.
  Serve para saber se se completa o comando (primeira palavra) ou um argumento, e de qual comando.

### Fontes de sugestões

Cada sugestão tem: texto a inserir, rótulo visível, descrição curta em espanhol, tipo
(pasta, arquivo, histórico, comando, opção, valor, PowerShell) e pontuação.

1. **Pastas e arquivos** (Rust, comando novo): lista a pasta para a qual o que foi digitado aponta,
   relativa à pasta atual ou absoluta (`C:\`, `..\`, `~`). Só pastas para `cd`, `pushd`,
   `mkdir` e `rd`; pastas e arquivos para o resto. Até 500 entradas, com cache curto por
   pasta (uns segundos). As ocultas ou de sistema são omitidas, a menos que o que foi digitado comece com `.`.
2. **Histórico**: os comandos que começam com a linha digitada, com mais peso se foram usados nesta
   pasta e se são recentes ou frequentes. Também os argumentos já usados com o mesmo comando
   (ex. hosts de `ping`/`ssh`/`tracert`/`curl` anteriores).
   - **Histórico do cmd (novo)**: quando se envia Enter estando no prompt do cmd, lê-se a
     linha e faz-se `patch({ lastCommand, running: true })`. O 133;D do próximo prompt já põe
     `running: false`, então o `Workspace.tsx` o guarda como hoje (código de saída vazio,
     porque o cmd não o fornece).
3. **Catálogo próprio** (`src/suggest/catalog/`, TypeScript): por comando, descrição, subcomandos,
   opções (com sua explicação) e argumentos com *geradores* de valores. Cada entrada é marcada
   para cmd, PowerShell ou as duas (ex. `dir /s` só cmd). Lista inicial:
   - arquivos: cd, dir/ls, mkdir/md, rmdir/rd, del/rm, copy/cp, move/mv, ren, type/cat, tree,
     start, explorer, code, notepad;
   - rede: ping, tracert, nslookup, ipconfig, netstat, arp, curl, ssh, scp;
   - sistema: tasklist, taskkill, where, set, echo, cls, exit, shutdown, systeminfo, whoami, sfc,
     chkdsk, winget, wsl;
   - desenvolvimento: git, npm, npx, node, python/py, pip, docker, cargo, claude, codex, agy, opencode.

   Geradores com dados em tempo real, todos sem shell no meio:
   - hosts: 8.8.8.8 (DNS do Google), 1.1.1.1 (Cloudflare), gateway da rede (o roteador,
     a partir do Rust), 127.0.0.1/localhost, google.com, mais os hosts do histórico;
   - branches e remotos do git (CLI do git, como `git.rs`);
   - scripts do `package.json` da pasta (`npm run …`);
   - contêineres e imagens do Docker (CLI, como `docker.rs`), só se o Docker responder rápido;
   - processos para `taskkill /IM` (nomes dos processos abertos).
4. **Nomes de comandos**: para a primeira palavra, o catálogo, o histórico e os executáveis do
   PATH (`.exe`, `.cmd`, `.bat`, `.ps1` no PowerShell; lista em cache, dá para reutilizar
   `agents_path_env`). No cmd também seus comandos internos.
5. **PowerShell (abordagem 2)**: veja abaixo.

### Completamentos da própria sessão do PowerShell

- `alphaterm.ps1` registra, se existir o PSReadLine, um atalho de duas teclas que ninguém usa (proposta:
  `F12,e`; quem for construir pode mudá-lo) com `Set-PSReadLineKeyHandler`. Quando ele chega:
  1. lê o buffer e o cursor com `[Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState`;
  2. roda `TabExpansion2 -inputScript $buffer -cursorColumn $cursor`;
  3. escreve com `[Console]::Write` uma OSC própria e invisível com um JSON em base64: o buffer e o
     cursor usados, `ReplacementIndex`, `ReplacementLength` e até 100 resultados (texto, rótulo,
     tipo, tooltip);
  4. não mexe no buffer nem na tela.
- Ao carregar, o script avisa com outra OSC que o atalho está disponível. Sem esse aviso, o AlphaTerm
  nunca o envia.
- O AlphaTerm envia a sequência do atalho pela `WriteQueue` da aba só se estiver *no
  prompt*, a sessão tiver avisado que o tem, e tiverem passado ~150 ms sem teclas.
- A resposta é descartada se seu buffer não coincidir com a linha lida naquele momento (resposta
  antiga). As fontes locais são mostradas de imediato; o que vem do PowerShell é misturado quando chega.
- **Atenção, trava a digitação enquanto roda**: o handler do PSReadLine roda na mesma thread que desenha
  o que se digita, então enquanto o `TabExpansion2` trabalha as teclas se acumulam (não se perdem,
  aparecem juntas ao terminar). Medido no PowerShell 5.1 de casa (`-NoProfile`, 21/11/2026):
  a primeira chamada leva 100–150 ms; depois, `Get-` 55–70 ms, `cd ` 35–50 ms, `git `/`ping `
  ~30 ms, `cd A` 3 ms, parâmetros (`Get-ChildItem -`) ~1 ms. É da ordem de uma tecla, mas para
  não pedir demais:
  - não se pede se o comando está no catálogo (seus resultados seriam ignorados de qualquer forma);
  - não se pede para caminhos de rede (`\\servidor\…`) nem para a primeira palavra com menos de 3 letras;
  - o AlphaTerm mede quanto cada resposta demora nessa aba; se uma passar de 300 ms, essa aba
    deixa de pedir sozinha e só pede com Ctrl+Espaço (avisa-se com um tooltip no menu);
  - sem "aquecimento" ao iniciar a shell (pioraria o primeiro prompt, cuja meta já não é cumprida).
- Para comandos que não são do PowerShell (ex. `ping`), o `TabExpansion2` devolve arquivos da
  pasta: se o comando está no catálogo, manda o catálogo e não se pergunta ao PowerShell.

### Mistura e ordem

- Filtra-se pela palavra atual sem distinguir maiúsculas: primeiro o que começa igual, depois
  o que a contém. As letras que coincidem são destacadas.
- Primeira palavra: histórico de linhas completas > catálogo > PowerShell (cmdlets, aliases,
  funções) > PATH.
- Argumentos: se o comando está no catálogo, seus valores e opções mais o histórico desse
  comando; se não, o que vem do PowerShell; as pastas e arquivos sempre que o argumento for um caminho.
- Sem repetidos (o mesmo texto a inserir aparece uma só vez, com a fonte de maior peso).

### O menu

```
PS C:\Users\Br1\desktop> cd al█
                           ┌────────────────────────────────────────┐
                           │ ▸ 📁 AlphaTerm\                  pasta │
                           │   📁 aa-disney\                  pasta │
                           │   📁 aa-netflix\                 pasta │
                           │   🕘 cd AlphaTerm\src     ontem, aqui  │
                           └────────────────────────────────────────┘

C:\Users\Br1> ping █
              ┌──────────────────────────────────────────┐
              │ ▸ 8.8.8.8           DNS do Google        │
              │   1.1.1.1           DNS da Cloudflare    │
              │   192.168.1.1       seu roteador         │
              │   localhost         este PC              │
              │   -t                até Ctrl+C           │
              └──────────────────────────────────────────┘
```

- `div` absoluto dentro do painel da terminal, alinhado à coluna onde a palavra começa,
  abaixo da linha do cursor (acima se não couber). O tamanho da célula é calculado a partir do painel e
  de `cols/rows`. Até 8 linhas visíveis com scroll. Respeita o tema da terminal.
- Sua classe é adicionada a `FLOATING` em `src/browser/marks.ts`.
- Fecha ao perder o foco da terminal, ao trocar de aba, com Esc ou se deixar de estar no prompt.

### Teclas (proposta, decisão de design)

Com o menu aberto sempre há uma linha destacada (a primeira, em tom suave):

| Tecla | Menu aberto, sem ter navegado | Menu aberto, navegando (depois de ↓) | Menu fechado |
|---|---|---|---|
| ↑ | fecha o menu e passa para a shell (histórico) | sobe; da primeira linha deixa de navegar | shell |
| ↓ | começa a navegar (desce uma linha) | desce | shell |
| Tab | insere a destacada | insere a destacada | shell (o Tab de sempre) |
| Enter | passa para a shell (executa o que foi digitado) | insere a destacada (não executa) | shell |
| Esc | fecha o menu (não chega à shell) | fecha o menu | shell |
| Ctrl+Espaço | — | — | abre o menu à mão |

- O menu aparece sozinho: logo depois do espaço em comandos com argumentos conhecidos
  (`cd `, `ping `, `git `), com 1 letra em argumentos de caminho, e com 2 letras para a primeira
  palavra, sempre que houver coincidências. Os limiares ficam em constantes ajustáveis.
- Interceptar as teclas vai em `attachCustomKeyEventHandler`. É adicionado antes da verificação de atalhos
  só quando o menu está aberto, e nunca com Ctrl+Alt (AltGr).
- **Ctrl+Espaço no PowerShell** hoje é `MenuComplete` do PSReadLine (modo de edição Windows, o do
  Bruno). Decisão própria: com as sugestões ativadas, o AlphaTerm fica com ele, porque seu menu
  mostra os mesmos completamentos do PowerShell e também os demais. Com as sugestões
  desativadas, o Ctrl+Espaço volta a chegar ao PSReadLine como sempre. No cmd hoje não faz nada.
- O menu só abre depois de caracteres digitados, não depois de trazer uma linha com ↑/↓ nem de
  um Tab próprio da shell (assim ↓ e o ciclo de Tab do PSReadLine continuam funcionando).
- O atalho escondido nunca é enviado logo depois de Tab, Ctrl+R ou outras teclas do PSReadLine que
  esperam uma segunda tecla.

### Inserir uma sugestão

- Substitui-se a palavra atual: enviam-se tantos backspaces quantos caracteres tiver o que foi digitado
  dessa palavra e depois o texto novo, tudo pela `WriteQueue`. No PowerShell, com um resultado de
  `TabExpansion2`, a parte a substituir é `ReplacementIndex/Length` (tem que terminar no cursor).
- Caminhos com espaços vão entre aspas (`"…"` no cmd, o que o `TabExpansion2` devolver ou `'…'` no
  PowerShell). Se a palavra já abria aspas, elas são respeitadas.
- Se foi inserida uma pasta, termina em `\` e o menu é aberto de novo com suas subpastas. Se
  foi outra coisa, termina em espaço e o menu fecha.
- Uma linha de histórico escolhida substitui a linha inteira (e não é executada).

### Configuração

Em `schema.ts` + `SettingsView.tsx`, seção de terminal:
- "Sugerencias de comandos": ativadas (padrão) / desativadas.
- "Mostrar": ao digitar (padrão) / só com Ctrl+Espaço.
- "Pedirle completados a PowerShell": sim (padrão) / não.

## Riscos: verificar primeiro

1. **O atalho escondido através da ConPTY**: que a sequência de F12 que o AlphaTerm escreve chegue
   ao PSReadLine 2.0 como `F12,e`, que o handler rode e que a OSC de resposta chegue ao
   xterm sem sujar a tela. Se não funcionar, usa-se o plano B (PowerShell escondido à parte) ou
   deixa-se a 2 de fora, e o Bruno é avisado antes de seguir.
2. **Ler a linha**: que a posição do 133;B mais o cursor deem a linha certa nas duas shells,
   com os redesenhos do PSReadLine e com linhas quebradas.
3. **Inserir com backspaces**: que funcione no cmd e no PSReadLine sem deixar lixo na tela.

Esses três vão primeiro no plano, antes de construir o resto.

## Decisões da revisão (tomadas, não do Bruno)

- O novo `running: true` do cmd também alimenta o estado da aba, o dos agentes e o
  painel de servidores: é o desejado (hoje o cmd nunca diz que algo está rodando).
- As sugestões do histórico são filtradas por shell (a sintaxe do cmd e do PowerShell difere).
- Antes de inserir contam-se as teclas enviadas que a shell ainda não mostrou, para que os
  backspaces não apaguem o que não corresponde.
- O aviso de "atalho disponível" só é aceito de um perfil de PowerShell e com um código por
  sessão que o AlphaTerm passa ao script, para que nenhuma saída de outro programa possa imitá-lo.

## O que fica para quem for construir

- Algoritmo exato de pontuação (recência, frequência, pasta) e os limiares de aparição.
- Estrutura de arquivos dentro de `src/suggest/` e nomes dos comandos de Rust novos.
- Número da OSC própria e formato exato do JSON.
- Como obter o gateway no Rust (API do Windows ou tabela de rotas).
- Ícones e estilo do menu, dentro do tema atual.
- O conteúdo de cada entrada do catálogo (opções e descrições em espanhol).

## Como se dá por terminado

- Testes: `npx vitest run` (separar palavras, ler a linha, mistura e ordem, máquina de estados de
  teclas, geradores do catálogo), `cargo test` (listar pastas, gateway, cache) e
  `npx tsc --noEmit`.
- Teste real em um AlphaTerm de teste (`CARGO_TARGET_DIR=target\prueba`, `ALPHATERM_DATA_DIR` e
  `WEBVIEW2_USER_DATA_FOLDER` próprios, CDP), **sem fechar o AlphaTerm do Bruno**: `cd` com
  pastas no cmd e no PowerShell, `ping`, histórico com ↑ intacto, cmdlets do PowerShell, nada de
  menu dentro do Claude Code, e que o cmd agora guarde histórico.
- Registro em `docs/pt/Process_Report.md`, marcando o que não foi verificado.
- Versão nova com `build-release.bat --minor` (0.5.0).
