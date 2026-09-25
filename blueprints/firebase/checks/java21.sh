#!/bin/sh
# Sourced by the checks that start the Firebase emulators, which need a JDK 21 or later. A brew
# `openjdk@21` is keg-only and not on PATH, so look in the usual places and put the first new enough
# one in front, rather than failing on whichever `java` happens to be first.
java_major() {
  "$1" -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -1
}
blueprint_java_found=""
for candidate in \
  "${JAVA_HOME:-/nonexistent}/bin/java" \
  "$(/usr/libexec/java_home -v 21+ 2>/dev/null || echo /nonexistent)/bin/java" \
  /opt/homebrew/opt/openjdk@21/bin/java \
  /usr/local/opt/openjdk@21/bin/java \
  /opt/homebrew/opt/openjdk/bin/java \
  "$(command -v java || echo /nonexistent)"; do
  [ -x "$candidate" ] || continue
  major=$(java_major "$candidate")
  if [ "${major:-0}" -ge 21 ]; then
    blueprint_java_found="$candidate"
    break
  fi
done
if [ -z "$blueprint_java_found" ]; then
  echo "no JDK 21 or later found; the Firebase emulators need one (macOS: brew install openjdk@21)" >&2
  exit 1
fi
PATH="$(dirname "$blueprint_java_found"):${PATH:-}"
export PATH
