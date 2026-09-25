#!/bin/sh
# .firebaserc names two different projects; each exists, has billing on (Blaze) and has Firestore.
set -eu
here=$(dirname "$0")
dev=$(sh "$here/project-id.sh" dev)
prod=$(sh "$here/project-id.sh" prod)
[ "$dev" != "$prod" ] || { echo "dev and prod are the same project: $dev" >&2; exit 1; }
for id in "$dev" "$prod"; do
  billing=$(gcloud billing projects describe "$id" --format='value(billingEnabled)')
  [ "$billing" = "True" ] || { echo "$id: billing is not enabled (Blaze plan)" >&2; exit 1; }
  gcloud firestore databases describe --project "$id" --database='(default)' >/dev/null || { echo "$id: no Firestore database" >&2; exit 1; }
done
