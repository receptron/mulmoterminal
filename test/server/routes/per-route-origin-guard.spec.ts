// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #1094, stated once over every call site rather than per route.
//
// The origin check answers "which browser PAGE may drive this server". A browser sends NO Origin
// on a same-origin GET, so a GET judged by it can only refuse the honest page — which is why the
// rule (routes/same-origin-guard.ts) exempts safe methods. The exemption lived in the middleware
// only, so the two guards that sat on a GET asked the predicate directly and answered 403 to every
// page served from an operator-named LAN origin. The remaining per-route guards were fine only
// because every one of them happened to sit on a POST.
//
// So: an Express route may not read the Origin header itself. `requestOriginAllowed` is the
// per-route form, and it carries the exemption with it.
//
// Enforced by forbidding the READ rather than the call, which is what a route has to do first
// however it then reaches the predicate — a call-shaped pattern is evadable by nesting or by
// renaming the parameter, and this is not.
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../server");

// The readers that are NOT Express routes, and cannot use the helper:
//   same-origin-guard.ts  defines it
//   ws-routes.ts          a WebSocket upgrade is a raw IncomingMessage — no route, no method to
//                         exempt, and a browser always sends Origin on a handshake
//   pubsub.ts             socket.io's own handshake/CORS hooks, one of which is handed no request
//   remoteUpgrade.ts      the remote-host gateway's upgrade, a raw IncomingMessage like ws-routes.ts
const ORIGIN_READERS = new Set(["routes/same-origin-guard.ts", "routes/ws-routes.ts", "infra/async/pubsub.ts", "backends/hostGateway/remoteUpgrade.ts"]);

// Every spelling of "read this request's Origin" Express offers.
const READS_ORIGIN = /headers\.origin\b|headers\[["']origin["']\]|\.get\(["']origin["']\)/i;

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(full);
    else if (entry.name.endsWith(".ts")) yield full;
  }
}

/** Files that read a request's Origin header at all, whichever spelling they use. */
function originReadingFiles(): string[] {
  const files: string[] = [];
  for (const file of tsFiles(SERVER_DIR)) {
    if (READS_ORIGIN.test(readFileSync(file, "utf-8"))) {
      files.push(path.relative(SERVER_DIR, file).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

// What the two #1094 routes must actually DO is not asserted here, on purpose: a source scan can
// only say a file mentions the helper, which would still pass if /api/remote-host/status lost its
// guard while a sibling POST kept one. That belongs where it can be observed instead of grepped —
// remoteHost/routes.spec.ts and backends/calendar/google.spec.ts each drive the real route with a predicate
// that refuses everything, and assert the GET answers 200 while the POST still 403s.
describe("per-route origin guards", () => {
  it("leave the Origin header to requestOriginAllowed", () => {
    expect(originReadingFiles()).toEqual([...ORIGIN_READERS].sort());
  });
});
