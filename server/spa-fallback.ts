// The SPA-fallback matcher for vue-router history mode. index.html is served for any
// client-side route — i.e. everything EXCEPT the /api prefix, which is where every
// server HTTP endpoint (including the GUI MCP route) lives. WebSocket upgrades
// (/ws, /ws/run, /ws/pubsub) bypass Express via server.on("upgrade"), and static
// assets are served by express.static before this runs — so reserving /api alone is
// enough. A GET to an unknown /api path is excluded here and falls through to a 404
// (never the SPA shell), so a mistyped API path fails loudly instead of returning HTML.
//
// Express 5 / path-to-regexp v8: app.get("*") is invalid — a RegExp route is used.
export const SPA_FALLBACK_RE = /^\/(?!api\/).*/;

/** True when `pathname` should serve the SPA shell rather than hit a server route. */
export function isClientRoute(pathname: string): boolean {
  return SPA_FALLBACK_RE.test(pathname);
}
