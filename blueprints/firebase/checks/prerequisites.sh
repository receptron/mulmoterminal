#!/bin/sh
# Every required CLI answers, a JDK new enough for the emulators exists, and Firebase and gcloud are
# signed in to the SAME account — the checks use both, and a project one of them created is not
# necessarily visible to the other.
set -eu
for probe in "node --version" "yarn --version" "firebase --version" "gcloud --version"; do
  sh -c "$probe" >/dev/null 2>&1 || { echo "missing: $probe" >&2; exit 1; }
done
. "$(dirname "$0")/java21.sh"
firebase_account=$(firebase login:list 2>/dev/null | sed -n 's/.*Logged in as \([^ ]*\).*/\1/p' | head -1)
[ -n "$firebase_account" ] || { echo "firebase: not signed in (firebase login)" >&2; exit 1; }
gcloud_account=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)
[ -n "$gcloud_account" ] || { echo "gcloud: not signed in (gcloud auth login)" >&2; exit 1; }
[ "$firebase_account" = "$gcloud_account" ] || {
  echo "firebase is signed in as $firebase_account but gcloud as $gcloud_account; use one account for both (gcloud config set account $firebase_account)" >&2
  exit 1
}
gcloud projects list --limit=1 --format='value(projectId)' >/dev/null 2>&1 || { echo "gcloud: the sign-in has expired (gcloud auth login $gcloud_account)" >&2; exit 1; }
