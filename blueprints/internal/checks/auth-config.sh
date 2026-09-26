#!/bin/sh
# Prints the Authentication config of the real project behind a .firebaserc alias (dev / prod).
set -eu
id=$(sh "$BLUEPRINT_BASE/checks/project-id.sh" "$1")
token=$(gcloud auth print-access-token)
curl -fsS --max-time 20 -H "Authorization: Bearer $token" -H "X-Goog-User-Project: $id" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$id/config"
