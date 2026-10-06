#!/usr/bin/env bash
# Publica la app compilada (dist/) en GitHub Pages, en un repositorio público aparte que
# solo contiene la app: el código fuente, el SPEC y el prototipo siguen en el repositorio privado.
#
# Uso (dentro de tet-video/):  bash scripts/deploy-pages.sh
# Requiere: acceso SSH a GitHub y el repositorio público ya creado (vacío o de una publicación anterior).
set -euo pipefail

REPO="${TET_PAGES_REPO:-git@github.com:gitorivera/tet-app.git}"
BRANCH="main"

cd "$(dirname "$0")/.."

# No publicar cambios sin commit: la versión publicada debe corresponder a un commit del repo privado.
if [ -n "$(git status --porcelain)" ]; then
  echo "Hay cambios sin commit. Haz el commit antes de publicar." >&2
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"

npm test
npm run build

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R dist/. "$TMP/"
# Sin Jekyll: GitHub Pages sirve los archivos tal cual.
touch "$TMP/.nojekyll"

cd "$TMP"
git init -q -b "$BRANCH"
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" \
  commit -q -m "App TET compilada desde el commit $COMMIT"
# Cada publicación reemplaza a la anterior: el historial del repositorio público no importa.
git push -q --force "$REPO" "$BRANCH"
echo "Publicado el commit $COMMIT en $REPO ($BRANCH)."
