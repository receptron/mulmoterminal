#!/bin/sh
# The Hosting site of the given alias (dev / prod) serves the build of the current commit.
set -eu
id=$(sh "$(dirname "$0")/project-id.sh" "$1")
expected=$(git rev-parse HEAD)
served=$(curl -fsS --max-time 20 "https://$id.web.app/blueprint-build.txt")
[ "$served" = "$expected" ] || { echo "$id serves build $served, HEAD is $expected" >&2; exit 1; }
