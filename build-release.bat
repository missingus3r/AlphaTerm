@echo off
rem Compila una version nueva de AlphaTerm y la instala:
rem  - sube la version sola (por defecto el ultimo numero: 0.3.0 -> 0.3.1), hace el commit "Version X" y el tag vX
rem  - la copia a %LOCALAPPDATA%\AlphaTerm\versiones\<version>
rem  - deja en el escritorio el acceso directo "AlphaTerm <version>" (y actualiza el anclado en la barra de tareas)
rem Opciones: build-release.bat --minor  (0.3.0 -> 0.4.0), --major (-> 1.0.0), --misma (recompila sin subir).
rem Si la compilacion falla, la version se deshace sola.
rem Se puede correr con AlphaTerm abierta: la abierta no se toca y la proxima vez que la abras es la nueva.
setlocal
cd /d "%~dp0"
title Compilando AlphaTerm
node scripts\release.mjs %*
if errorlevel 1 (
  echo.
  echo No se pudo compilar o instalar. El error esta arriba.
  pause
  exit /b 1
)
echo.
echo Listo.
pause
