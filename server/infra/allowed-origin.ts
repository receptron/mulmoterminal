// Which browser origins may open this server's sockets and reach its privileged routes.
//
// Only same-machine browser origins, so a malicious website the user happens to visit can't
// drive the local Claude PTY (a cross-site WebSocket hijack). A MISSING Origin is allowed —
// that is a non-browser local client, which cannot be a cross-site request. Any localhost
// host on any port is allowed, which is what covers the Vite dev proxy.
//
// Out of index.ts because every route module and the pub/sub socket take this as a
// dependency and every one of their tests passes a stub, so the real predicate — the single
// thing standing between a visited page and the user's terminal — was the one piece nothing
// exercised (#548).
//
// `hostname` is what `new URL()` normalises to, so an IPv6 literal arrives bracketed
// (`[::1]`) however it was written, and a host is already lower-cased and punycoded.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}
