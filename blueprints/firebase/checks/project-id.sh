#!/bin/sh
# Prints the project id behind a .firebaserc alias (dev / prod).
set -eu
node -e '
const rc = JSON.parse(require("fs").readFileSync(".firebaserc", "utf8"));
const id = rc.projects && rc.projects[process.argv[1]];
if (typeof id !== "string" || id === "") { console.error("no project for alias " + process.argv[1]); process.exit(1); }
console.log(id);
' "$1"
