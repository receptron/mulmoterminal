#!/bin/sh
# The domain-checking blocking functions are registered on the real project behind an alias
# (dev / prod). The emulator test proves the code; only this proves the project runs it.
set -eu
id=$(sh "$BLUEPRINT_BASE/checks/project-id.sh" "$1")
token=$(gcloud auth print-access-token)
config=$(curl -fsS --max-time 20 -H "Authorization: Bearer $token" -H "X-Goog-User-Project: $id" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$id/config")
printf '%s' "$config" | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{
  const triggers = JSON.parse(s).blockingFunctions?.triggers ?? {};
  // Each trigger must point at OUR function, not merely at something.
  const expected = { beforeCreate: "beforeusercreated", beforeSignIn: "beforeusersignedin" };
  const wrong = Object.entries(expected).filter(([t, name]) => !(triggers[t]?.functionUri ?? "").toLowerCase().includes(name));
  if (wrong.length) { console.error("not registered to our functions: " + wrong.map(([t]) => t).join(", ")); process.exit(1); }
})'
