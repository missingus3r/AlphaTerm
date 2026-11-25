#!/usr/bin/env bash
# Builds a new version of AlphaTerm and installs it (Linux; on Windows, build-release.bat):
#  - bumps the version by itself (the last number by default: 0.3.0 -> 0.3.1), makes the "Version X" commit and the vX tag
#  - copies it to ~/.local/share/AlphaTerm/versiones/<version>
#  - points the applications menu entry (and the dock's pinned icon) and the "AlphaTerm <version>" desktop launcher there
# Options: ./build-release.sh --minor  (0.3.0 -> 0.4.0), --major (-> 1.0.0), --misma (rebuilds without bumping).
# If the build fails, the version bump is undone by itself.
# It can run with AlphaTerm open: the open one is left alone and the next time you open it, it's the new one.
set -u
cd "$(dirname "$0")"
if ! node scripts/release.mjs "$@"; then
  echo
  echo "No se pudo compilar o instalar. El error está arriba."
  exit 1
fi
echo
echo "Listo."
