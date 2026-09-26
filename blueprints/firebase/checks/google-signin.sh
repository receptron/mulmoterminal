#!/bin/sh
# Google sign-in is switched on in the real project behind an alias (dev / prod). The emulator accepts
# any provider, so only this shows whether a person can actually sign in; switching it on creates an
# OAuth client, which only the console does, so a person has to click it.
set -eu
id=$(sh "$(dirname "$0")/project-id.sh" "$1")
token=$(gcloud auth print-access-token)
config=$(curl -sS --max-time 20 -H "Authorization: Bearer $token" -H "X-Goog-User-Project: $id" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$id/defaultSupportedIdpConfigs/google.com")
printf '%s' "$config" | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{
  if (JSON.parse(s).enabled === true) return;
  console.error("Google sign-in is not enabled; turn it on at https://console.firebase.google.com/project/" + process.argv[1] + "/authentication/providers");
  process.exit(1);
})' "$id"
