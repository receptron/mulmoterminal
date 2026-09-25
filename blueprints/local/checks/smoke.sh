#!/bin/sh
# Builds, starts the built server on a spare port with the default settings, and checks that
# /api/health and / answer — and that, left at its defaults, it listens on this computer only.
set -eu
yarn build >/dev/null
# process.stdout.write, not console.log: with FORCE_COLOR set, console.log colours a number, and the
# escape codes would become part of the port.
port=$(node -e 'const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { process.stdout.write(String(s.address().port)); s.close(); })')
log=$(mktemp)
env -u HOST PORT="$port" yarn start >"$log" 2>&1 &
started=$!
listener=""
stop() {
  # Only what this check started: the yarn process and the server it found listening, by pid.
  [ -z "$listener" ] || kill "$listener" 2>/dev/null || true
  kill "$started" 2>/dev/null || true
  rm -f "$log"
}
trap stop EXIT INT TERM
tries=0
until curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || { echo "the server did not answer /api/health on port $port" >&2; cat "$log" >&2; exit 1; }
  sleep 0.5
done
listener=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)
curl -fsS --max-time 5 "http://127.0.0.1:$port/api/health" | grep -q '"ok":true' || { echo '/api/health did not answer {"ok":true}' >&2; exit 1; }
curl -fsS --max-time 5 "http://127.0.0.1:$port/" | grep -q 'id="app"' || { echo "/ does not serve the app" >&2; exit 1; }
addresses=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $9 }')
[ -n "$addresses" ] || { echo "could not see which address the server listens on (lsof found nothing for port $port)" >&2; exit 1; }
if printf '%s\n' "$addresses" | grep -qvE '^(127\.0\.0\.1|\[::1\]):'; then
  echo "left at its defaults the server must listen on this computer only (127.0.0.1), but it listens on: $addresses" >&2
  exit 1
fi
