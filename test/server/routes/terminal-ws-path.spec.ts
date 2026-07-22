// @vitest-environment node
import { describe, it, expect } from "vitest";

import { terminalWsKind } from "../../../server/routes/terminal-ws-path.js";

describe("terminalWsKind", () => {
  it.each([
    ["/ws", "claude"],
    ["/ws/run", "run"],
    ["/ws/launch", "launch"],
    ["/ws/codex", "codex"],
  ])("routes %s to the %s socket", (pathname, kind) => {
    expect(terminalWsKind(pathname)).toBe(kind);
  });

  // The one that matters: socket.io installs its own upgrade handler on the same server, and
  // /ws/pubsub is its path. Claiming it here means socket.io never sees the upgrade — live
  // activity, status and roster updates die across the whole app while the terminals keep
  // working, which is a miserable thing to debug.
  it("leaves the pubsub path to socket.io", () => {
    expect(terminalWsKind("/ws/pubsub")).toBeNull();
  });

  // Exact matches only, for the same reason: any tolerance here can swallow a path that is
  // not ours.
  it.each([["/ws/"], ["/WS"], ["/ws/run/"], ["/ws/runner"], ["/wsx"], ["/ws/run?x=1"], [""], ["/"], ["/api/ws"]])("does not claim %j", (pathname) => {
    expect(terminalWsKind(pathname)).toBeNull();
  });

  // A path that names an Object.prototype member must not resolve through the prototype
  // chain into something truthy.
  it.each([["constructor"], ["toString"], ["__proto__"], ["hasOwnProperty"]])("does not resolve %s through the prototype chain", (pathname) => {
    expect(terminalWsKind(pathname)).toBeNull();
  });
});
