#!/bin/sh
# Runs chaff at the version these packs are written for. CHAFF_BIN overrides it (a local build, or a
# stand-in in tests), so a check never depends on the network when it does not have to.
if [ -n "${CHAFF_BIN:-}" ]; then
  exec sh -c "$CHAFF_BIN \"\$@\"" chaff "$@"
fi
exec npx -y chaffjs@0.21 "$@"
