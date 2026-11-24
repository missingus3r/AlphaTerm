# Painéis: barra com botões e mover como "snap" — design curto

> Traduzido do original em espanhol (`Documentacion/specs/2026-11-23-paneles-barra-y-snap-design.md`). A versão em espanhol é a fonte de verdade.

Data: 23/11/2026. Estado: para aprovar.

## Por quê
O Bruno trabalha com várias terminais e agentes ao mesmo tempo em uma mesma aba. Hoje dividir e fechar
painéis só é possível com atalhos (Alt+Shift+=, Alt+Shift+-, Alt+Shift+D, Ctrl+Shift+W), não há como
mudar a ordem dos painéis e a linha para mudar o tamanho quase não se vê. Ele quer fazer isso
com o mouse: botões de dividir e fechar, e mover os painéis "como snap" (mudar a ordem ou o
tamanho).

## Objetivos
- Uma barrinha em cima de cada painel com o nome e os botões dividir à direita (⇥), dividir
  abaixo (⤓) e fechar (✕).
- Clique direito na barrinha: menu com Dividir à direita, Dividir abaixo, Igualar tamanhos e Fechar
  painel.
- Arrastar um painel pela sua barrinha e soltá-lo sobre outro: a metade esquerda, direita, de cima ou
  de baixo do outro painel o deixa desse lado; o centro os troca de lugar. Enquanto se arrasta, pinta-se
  onde ele vai ficar.
- Tamanho: a linha divisória mais fácil de agarrar, que para sozinha em ⅓, ½ e ⅔, e clique duplo para
  deixar os dois lados iguais.

## Fora do escopo (por enquanto)
- Layouts prontos no estilo Windows 11 (2 colunas, 2×2, etc.): ficou como extra possível. O Bruno não
  pediu na resposta; é adicionado depois se ele quiser.
- Mover painéis para outra aba ou para outra janela, ou soltar uma aba dentro de outra.
- Mudanças na API de controle ou no MCP (continuam com `split` como hoje).

## O que não pode acontecer
- Que mover um painel volte a criar sua terminal (mata a shell e o agente). Os painéis continuam sendo
  iterados por id e posicionados por retângulos; mover é só mudar a árvore.
- Que o navegador integrado (WebView2 nativo, nada pode cobri-lo) fique por cima da zona onde se
  solta.
- Perder o clique direito da terminal (copiar se houver seleção, se não colar): o menu novo fica na
  barrinha, não na terminal.
- Quebrar os atalhos de teclado que já existem.

## Abordagens consideradas
- **A) Barrinha fixa em cima de cada painel** (escolhida pelo Bruno). Vê-se sempre o que é cada painel e
  onde agarrá-lo; tira uma linha de altura de cada terminal.
- B) Botões flutuantes no canto ao passar o mouse. Não ocupam espaço, mas cobrem texto da
  terminal e são mais difíceis de descobrir.

## Como (decisões minhas, marcadas para revisão)
- **Barrinha sempre visível**, também com um só painel (é onde fica o botão para a primeira
  divisão). Uns 22 px. O painel em foco (com 2 ou mais) a tem destacada com a cor de destaque.
  Nome: o mesmo que o navegador já usa para escolher a terminal (agente ou shell · pasta).
- **Painéis de navegador**: já têm sua própria barra; soma-se a alça de arraste (⋮⋮) à esquerda
  e os botões ⇥ ⤓ (dividir a partir de um navegador abre uma terminal na pasta do seu dono, como hoje).
- **✕ com algo rodando pede confirmação** (agente ou comando em andamento), porque o botão é pequeno
  e está ao lado dos de dividir. Sem nada rodando, fecha direto. Ctrl+Shift+W continua sem
  perguntar.
- **Arraste com eventos de ponteiro** (como os divisores), não com o arraste nativo do navegador:
  começa só ao mover 5 px (um clique simples na barrinha apenas dá foco). Esc cancela. Soltar sobre
  si mesmo ou fora dos painéis não faz nada. Durante o arraste os navegadores são escondidos (a
  mesma classe `resizing` que os divisores já usam) e o menu novo vai em `FLOATING`.
- **Modelo** (`src/layout/model.ts`, funções puras com testes): inserir um painel ao lado de outro
  por qualquer um dos quatro lados, mover um painel (tirá-lo e inseri-lo, metade e metade) e
  trocar dois painéis de lugar. Igualar: cada divisão toma a proporção de painéis que tem de cada
  lado, assim todos ficam do mesmo tamanho nesse eixo.
- **Freio da linha**: se for solta a menos de ~12 px de ⅓, ½ ou ⅔ da sua divisão, fica exatamente
  ali. A função que decide é pura e tem teste.
- A sessão já guarda a árvore: o que foi movido é recuperado sozinho ao abrir de novo.

## Para quem for construir
- Detalhes visuais (ícones, cores, o desenho da zona de soltar) seguindo o estilo atual de
  `styles.css`.
- Testar em um AlphaTerm à parte (`CARGO_TARGET_DIR=target\prueba` + `ALPHATERM_DATA_DIR` e
  `WEBVIEW2_USER_DATA_FOLDER` próprios) por CDP, sem fechar o do Bruno. Testes: vitest, tsc, e que
  mover um painel com um comando rodando não o interrompa.
