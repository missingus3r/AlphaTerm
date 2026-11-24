# Microsoft ConPTY (sideload)

> Translated from the Spanish original (`src-tauri/conpty/LEEME.md`). The Spanish version is the source of truth.

`conpty.dll` and `OpenConsole.exe` (x64) from the official NuGet package
`Microsoft.Windows.Console.ConPTY` 1.25.261109001 (MIT license, https://github.com/microsoft/terminal).
Authenticode signatures verified on 17/11/2026: Microsoft Corporation.

portable-pty loads `conpty.dll` if it sits next to the executable and otherwise uses the ConPTY built into Windows
(`kernel32.dll`), which is quite a bit slower. `build.rs` copies them next to the exe in dev and tests, and
`tauri.conf.json` includes them in the installer.

To update: download the new version of the package, verify the signature and replace the two files.
