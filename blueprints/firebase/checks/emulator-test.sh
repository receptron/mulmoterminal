#!/bin/sh
# Runs test/blueprint/<name>.spec.ts against the emulators, under a demo- project id so it can never
# reach a real project.
set -eu
. "$(dirname "$0")/java21.sh"
name="$1"
spec="test/blueprint/$name.spec.ts"
[ -f "$spec" ] || { echo "missing $spec" >&2; exit 1; }
only="auth,firestore"
[ -d functions ] && only="$only,functions"
firebase emulators:exec --project demo-blueprint --only "$only" "npx vitest run $spec"
