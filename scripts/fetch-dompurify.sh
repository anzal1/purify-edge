#!/bin/sh
# Clones cure53/DOMPurify at the tag that package.json pins, into .cache/dompurify-<version> (or $DOMPURIFY_DIR). Nothing is modified.
# Also checks that the cloned dist/purify.cjs.js is byte-identical to the dompurify package this library depends on, so the suite tests what ships.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(node -p "require('$ROOT/package.json').dependencies.dompurify")
case "$VERSION" in *[!0-9.]*|"") echo "dompurify must be pinned to an exact version in package.json, got '$VERSION'" >&2; exit 1;; esac
DIR=${DOMPURIFY_DIR:-$ROOT/.cache/dompurify-$VERSION}
if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$(dirname "$DIR")"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$VERSION" https://github.com/cure53/DOMPurify.git "$DIR"
fi
GOT=$(git -C "$DIR" describe --tags --exact-match 2>/dev/null || echo none)
[ "$GOT" = "$VERSION" ] || { echo "$DIR is at '$GOT', expected tag $VERSION" >&2; exit 1; }
[ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ] || { echo "$DIR has local modifications to tracked files; remove it and retry" >&2; exit 1; }
cmp -s "$DIR/dist/purify.cjs.js" "$ROOT/node_modules/dompurify/dist/purify.cjs.js" || { echo "dist/purify.cjs.js in the clone differs from node_modules/dompurify" >&2; exit 1; }
echo "$DIR"
