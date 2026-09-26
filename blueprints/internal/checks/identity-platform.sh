#!/bin/sh
# Whether each project behind the given aliases is on Identity Platform, which blocking functions
# need. Read from the project, so the person is asked to upgrade only the ones that are not.
set -eu
missing=""
for alias in "$@"; do
  id=$(sh "$BLUEPRINT_BASE/checks/project-id.sh" "$alias")
  subtype=$(sh "$BLUEPRINT_USECASE/checks/auth-config.sh" "$alias" | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>console.log(JSON.parse(s).subtype ?? ""))')
  [ "$subtype" = "IDENTITY_PLATFORM" ] || missing="$missing https://console.firebase.google.com/project/$id/authentication/settings"
done
[ -z "$missing" ] || { echo "not on Identity Platform yet; upgrade at:$missing" >&2; exit 1; }
