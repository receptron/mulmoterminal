#!/bin/sh
# The spec exists and every template placeholder in it was filled or marked undecided.
set -eu
[ -s .blueprint/spec.md ] || { echo "missing .blueprint/spec.md" >&2; exit 1; }
if grep -n '{{' .blueprint/spec.md >&2; then
  echo "unfilled placeholders are left in .blueprint/spec.md" >&2
  exit 1
fi
