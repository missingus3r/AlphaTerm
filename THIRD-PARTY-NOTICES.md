# Third-party notices

AlphaTerm ships the following files from other projects. Their licenses are reproduced below.

## ConPTY (`src-tauri/conpty/conpty.dll`, `src-tauri/conpty/OpenConsole.exe`)

From the official NuGet package `Microsoft.Windows.Console.ConPTY` 1.25.261109001, built from
https://github.com/microsoft/terminal.

```
MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## npm and Rust dependencies

The libraries listed in `package.json` and `src-tauri/Cargo.toml` (Tauri, SolidJS, xterm.js,
portable-pty and the rest) are used under their own licenses (MIT, Apache-2.0 or similar); see each
package for its license text.
