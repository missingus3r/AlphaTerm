@echo off
rem Builds a new version of AlphaTerm and installs it:
rem  - bumps the version by itself (the last number by default: 0.3.0 -> 0.3.1), makes the "Version X" commit and the vX tag
rem  - copies it to %LOCALAPPDATA%\AlphaTerm\versiones\<version>
rem  - leaves the "AlphaTerm <version>" shortcut on the desktop (and updates the taskbar pin)
rem Options: build-release.bat --minor  (0.3.0 -> 0.4.0), --major (-> 1.0.0), --misma (rebuilds without bumping).
rem If the build fails, the version bump is undone by itself.
rem It can run with AlphaTerm open: the open one is left alone and the next time you open it, it's the new one.
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
