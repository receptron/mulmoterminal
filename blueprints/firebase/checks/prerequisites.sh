#!/bin/sh
# Every required CLI answers, and both Firebase and gcloud have a signed-in account.
set -eu
for probe in "node --version" "yarn --version" "firebase --version" "gcloud --version" "java -version"; do
  sh -c "$probe" >/dev/null 2>&1 || { echo "missing: $probe" >&2; exit 1; }
done
firebase projects:list >/dev/null 2>&1 || { echo "firebase: not signed in" >&2; exit 1; }
account=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)
[ -n "$account" ] || { echo "gcloud: not signed in" >&2; exit 1; }
