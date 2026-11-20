@echo off
rem Compila una version nueva de AlphaTerm y la instala:
rem  - la copia a %LOCALAPPDATA%\AlphaTerm\versiones\<version>
rem  - deja en el escritorio el acceso directo "AlphaTerm <version>" (y actualiza el anclado en la barra de tareas)
rem La version sale de src-tauri\tauri.conf.json: subila antes en package.json, src-tauri\Cargo.toml y src-tauri\tauri.conf.json.
rem Se puede correr con AlphaTerm abierta: la abierta no se toca y la proxima vez que la abras es la nueva.
setlocal
cd /d "%~dp0"
title Compilando AlphaTerm
node scripts\release.mjs
if errorlevel 1 (
  echo.
  echo No se pudo compilar o instalar. El error esta arriba.
  pause
  exit /b 1
)
echo.
echo Listo.
pause
