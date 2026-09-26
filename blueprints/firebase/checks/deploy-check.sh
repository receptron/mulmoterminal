#!/bin/sh
# The Hosting site of the given alias (dev / prod) serves the build this deploy made: the deploy
# writes a fresh id to .blueprint/build-id and ships the same id as /blueprint-build.txt. No git is
# needed — and none is wanted: a new repository takes away the folder's trust, and the next
# unattended step would stop at Claude Code's trust prompt.
set -eu
id=$(sh "$(dirname "$0")/project-id.sh" "$1")
[ -s .blueprint/build-id ] || { echo "missing .blueprint/build-id; the deploy step writes it before deploying" >&2; exit 1; }
expected=$(cat .blueprint/build-id)
served=$(curl -fsS --max-time 20 "https://$id.web.app/blueprint-build.txt")
[ "$served" = "$expected" ] || { echo "$id serves build $served, this deploy made $expected" >&2; exit 1; }
# Firebase Hosting hands the app its config at this reserved URL; the app reads it rather than
# carrying a key of its own, so the same build works on dev and prod.
curl -fsS --max-time 20 "https://$id.web.app/__/firebase/init.json" | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{
  if (!JSON.parse(s).apiKey) { console.error("no web app config at /__/firebase/init.json; register a web app in the project"); process.exit(1); }
})'
sh "$(dirname "$0")/google-signin.sh" "$1"
sh "$(dirname "$0")/page-renders.sh" "https://$id.web.app/"
