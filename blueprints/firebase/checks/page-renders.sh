#!/bin/sh
# The served page actually starts: a build can deploy, report its id and answer 200, and still be a
# blank page because the app threw on load (a missing config does exactly that). Rendered in headless
# Chrome, the page must show some text. Without a Chrome this cannot be judged, and says so.
set -eu
url="$1"
chrome=""
for candidate in "${CHROME:-}" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
  [ -n "$candidate" ] || continue
  if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then chrome="$candidate"; break; fi
done
[ -n "$chrome" ] || { echo "no Chrome found (set CHROME=...); could not confirm that $url renders" >&2; exit 0; }
# Headless Chrome can print the DOM and then not exit, so it is waited on for the DOM, not for exit.
RENDER_LIMIT_SECONDS=60
work=$(mktemp -d)
"$chrome" --headless=new --disable-gpu --no-first-run --user-data-dir="$work/profile" --virtual-time-budget=15000 --dump-dom "$url" >"$work/dom.html" 2>/dev/null &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; rm -rf "$work"' EXIT
waited=0
until grep -q "</html>" "$work/dom.html" 2>/dev/null || [ "$waited" -ge "$RENDER_LIMIT_SECONDS" ] || ! kill -0 "$pid" 2>/dev/null; do
  sleep 1
  waited=$((waited + 1))
done
node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{
  const body = (s.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, ""])[1];
  const text = body.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) { console.error(process.argv[1] + " renders a blank page: the app failed to start. Open it in a browser and read the console error."); process.exit(1); }
})' "$url" <"$work/dom.html"
