> Traduzido do original em espanhol (`src-tauri/conpty/README.es.md`). A versão em espanhol é a fonte de verdade.

# ConPTY da Microsoft (sideload)

`conpty.dll` e `OpenConsole.exe` (x64) do pacote NuGet oficial
`Microsoft.Windows.Console.ConPTY` 1.25.261109001 (licença MIT, https://github.com/microsoft/terminal).
Assinaturas Authenticode verificadas em 17/11/2026: Microsoft Corporation.

O portable-pty carrega `conpty.dll` se ela estiver ao lado do executável e, se não, usa a ConPTY do Windows
(`kernel32.dll`), que é bem mais lenta. O `build.rs` os copia para ao lado do exe em dev e nos testes, e
o `tauri.conf.json` os inclui no instalador.

Para atualizar: baixe a versão nova do pacote, verifique a assinatura e substitua os dois arquivos.
