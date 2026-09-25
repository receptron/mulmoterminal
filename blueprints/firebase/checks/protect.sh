#!/bin/sh
# App Check is ENFORCED for Firestore on production, every callable function enforces it, and a
# budget is scoped to the production project. Each response is captured before it is parsed, so a
# failed request fails the check instead of hiding behind a pipe.
set -eu
prod=$(sh "$(dirname "$0")/project-id.sh" prod)
number=$(gcloud projects describe "$prod" --format='value(projectNumber)')
token=$(gcloud auth print-access-token)

appcheck=$(curl -fsS --max-time 20 -H "Authorization: Bearer $token" \
  "https://firebaseappcheck.googleapis.com/v1/projects/$number/services/firestore.googleapis.com")
printf '%s' "$appcheck" | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{
  const mode = JSON.parse(s).enforcementMode;
  if (mode !== "ENFORCED") { console.error("App Check for Firestore is " + mode + ", not ENFORCED"); process.exit(1); }
})'

# Line by line, so one protected callable cannot vouch for another.
unprotected=$(grep -rn "onCall(" functions/src | grep -v "onCall({ *enforceAppCheck: true" || true)
[ -z "$unprotected" ] || { printf 'callable functions without enforceAppCheck:\n%s\n' "$unprotected" >&2; exit 1; }

account=$(gcloud billing projects describe "$prod" --format='value(billingAccountName)')
account=${account#billingAccounts/}
[ -n "$account" ] || { echo "$prod has no billing account" >&2; exit 1; }
budgets=$(gcloud billing budgets list --billing-account="$account" --format=json)
# gcloud records the filter as projects/<id>; the API also accepts projects/<number>.
printf '%s' "$budgets" | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{
  const wanted = process.argv.slice(1).map((p) => "projects/" + p);
  const scoped = JSON.parse(s).some((b) => (b.budgetFilter?.projects ?? []).some((p) => wanted.includes(p)));
  if (!scoped) { console.error("no budget is scoped to " + wanted.join(" or ")); process.exit(1); }
})' "$prod" "$number"
