// Build the sandboxed-iframe `srcdoc` for a custom collection view — MulmoTerminal's
// port of MulmoClaude's customViewSrcdoc.ts + the buildCustomViewCsp policy.
//
// Injected at the START of <head> so the bootstrap runs before the view's own
// scripts: (1) a CSP <meta> locking connect-src to the server origin (the view may
// fetch its data endpoint but no third party), and (2)
// `window.__MC_VIEW = { slug, token, dataUrl, origin, onChange, openItem, startChat }`
// — the scoped token + absolute data URL the view reads, PLUS the view↔host bridge
// (onChange live-refresh + openItem + startChat helpers that postMessage the parent,
// which @mulmoclaude/collection-plugin's CollectionCustomView consumes). Without the
// bridge the LLM-authored views throw `__MC_VIEW.openItem is not a function`.

// Curated CDN allowlist the LLM commonly pulls charting/util libs + fonts from.
const ALLOWED_CDNS: readonly string[] = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://cdn.plot.ly",
];

// CSP for a custom view. connect-src = the server origin ONLY (the exfiltration
// channel that matters — fetch/XHR/WebSocket can reach only the view's own data
// endpoint). script/style/font reuse the curated CDN allowlist; img/media also allow
// any https: so feed records' external thumbnails / audio render (a one-way,
// GET-only, response-unreadable channel — accepted, same as MulmoClaude). `origin`
// MUST be explicit: the sandboxed iframe's origin is opaque, so `'self'` never matches.
function buildCustomViewCsp(origin: string): string {
  const cdns = ALLOWED_CDNS.join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cdns}`,
    `style-src 'unsafe-inline' ${cdns}`,
    `font-src ${cdns}`,
    `img-src ${origin} ${cdns} data: blob: https:`,
    `media-src ${origin} https: data: blob:`,
    `connect-src ${origin}`,
  ].join("; ");
}

export interface CustomViewBootstrap {
  slug: string;
  /** Scoped capability token (Authorization: Bearer <token>). */
  token: string;
  /** Data endpoint URL; absolutised against `origin` when root-relative (the iframe
   *  is `about:srcdoc`, so a relative `/api/...` would not resolve). */
  dataUrl: string;
  /** Explicit server origin — for the CSP and the absolute dataUrl. */
  origin: string;
}

function absoluteDataUrl(dataUrl: string, origin: string): string {
  return dataUrl.startsWith("/") ? `${origin}${dataUrl}` : dataUrl;
}

/** Debounce (ms) for the in-iframe live-refresh helper — collapses a burst of parent
 *  change-pings into a single onChange callback. */
const ONCHANGE_DEBOUNCE_MS = 150;

/** The in-iframe view↔host bridge appended after `window.__MC_VIEW = {…}`. Ported
 *  verbatim from MulmoClaude (src/utils/html/customViewSrcdoc.ts). Defines the three
 *  functions the custom view calls — they postMessage the parent, which
 *  @mulmoclaude/collection-plugin's CollectionCustomView already handles (mc-open-item /
 *  mc-start-chat) and pings (mc-collection-changed) for live refresh. No secret crosses
 *  the boundary; openItem/startChat go to the known parent `v.origin`. Self-contained
 *  string (no `</script>`, no `<`, no `${`) so it survives inlining into the <script>. */
function viewBridgeBootstrap(): string {
  return `(function(){var v=window.__MC_VIEW,cbs=[],t;function fire(){t=undefined;cbs.slice().forEach(function(cb){try{cb()}catch(e){}});}window.addEventListener('message',function(e){if(e.source!==window.parent)return;var d=e.data;if(!d||d.type!=='mc-collection-changed'||d.slug!==v.slug)return;if(t)clearTimeout(t);t=setTimeout(fire,${ONCHANGE_DEBOUNCE_MS});});v.onChange=function(cb){if(typeof cb!=='function')return function(){};cbs.push(cb);return function(){var i=cbs.indexOf(cb);if(i>=0)cbs.splice(i,1);};};v.openItem=function(id,mode){window.parent.postMessage({type:'mc-open-item',slug:v.slug,id:String(id),mode:mode==='edit'?'edit':'view'},v.origin);};v.startChat=function(prompt,role){window.parent.postMessage({type:'mc-start-chat',slug:v.slug,prompt:String(prompt),role:typeof role==='string'?role:undefined},v.origin);};})();`;
}

export function buildCustomViewSrcdoc(html: string, boot: CustomViewBootstrap): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${buildCustomViewCsp(boot.origin)}">`;
  // `<`-escape the JSON so a hostile token/slug value can't break out of <script>.
  const json = JSON.stringify({
    slug: boot.slug,
    token: boot.token,
    dataUrl: absoluteDataUrl(boot.dataUrl, boot.origin),
    origin: boot.origin, // target origin for openItem/startChat postMessage to the parent
  }).replace(/</g, "\\u003c");
  const injection = `${cspMeta}<script>window.__MC_VIEW=${json};${viewBridgeBootstrap()}</script>`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1${injection}`);
  }
  return `<!DOCTYPE html><html><head>${injection}</head><body>${html}</body></html>`;
}
