#!/bin/sh
# The skeleton exists, carries the emulator and test harness later steps rely on, and builds.
set -eu
for f in firebase.json package.json firestore.rules; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
done
for d in functions test/blueprint; do
  [ -d "$d" ] || { echo "missing $d/" >&2; exit 1; }
done
grep -q '"emulators"' firebase.json || { echo "firebase.json configures no emulators" >&2; exit 1; }
grep -q '"@firebase/rules-unit-testing"' package.json || { echo "@firebase/rules-unit-testing is not a dependency" >&2; exit 1; }
yarn build
