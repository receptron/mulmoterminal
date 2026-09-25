#!/bin/sh
# The area's own tests exist (test/<area>.test.ts), and everything builds and passes.
set -eu
area="$1"
[ -f "test/$area.test.ts" ] || { echo "missing test/$area.test.ts" >&2; exit 1; }
yarn build
yarn test
