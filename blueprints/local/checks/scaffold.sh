#!/bin/sh
# The layout the later checks rely on exists, and the skeleton builds and its tests pass.
set -eu
for f in package.json server/index.ts server/db.ts client/index.html; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
done
for d in server/migrations test; do
  [ -d "$d" ] || { echo "missing $d/" >&2; exit 1; }
done
grep -q '"start"' package.json || { echo "package.json has no start script" >&2; exit 1; }
yarn build
yarn test
