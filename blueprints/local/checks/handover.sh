#!/bin/sh
# The README tells a non-engineer how to start the app and how to back up its data.
set -eu
[ -s README.md ] || { echo "missing README.md" >&2; exit 1; }
grep -q "yarn start" README.md || { echo "README.md does not say how to start (yarn start)" >&2; exit 1; }
grep -q "data/app.db" README.md || { echo "README.md does not say where the data is (data/app.db)" >&2; exit 1; }
