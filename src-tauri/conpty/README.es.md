# ConPTY de Microsoft (sideload)

`conpty.dll` y `OpenConsole.exe` (x64) del paquete NuGet oficial
`Microsoft.Windows.Console.ConPTY` 1.25.261109001 (licencia MIT, https://github.com/microsoft/terminal).
Firmas Authenticode verificadas el 17/11/2026: Microsoft Corporation.

portable-pty carga `conpty.dll` si está junto al ejecutable y, si no, usa la ConPTY de Windows
(`kernel32.dll`), que es bastante más lenta. `build.rs` los copia al lado del exe en dev y tests, y
`tauri.conf.json` los incluye en el instalador.

Para actualizar: bajar la versión nueva del paquete, verificar la firma y reemplazar los dos archivos.
