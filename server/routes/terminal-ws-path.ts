// Which terminal WebSocket, if any, owns an upgrade request's path.
//
// Returning null is not a failure — it is how /ws/pubsub reaches socket.io, which installs
// its OWN upgrade handler on the same server. Swallow that path here (a prefix match, a
// trailing-slash tolerance, a case-insensitive compare) and socket.io never sees the
// upgrade: live activity, status and roster updates die silently across the whole app while
// the terminals keep working perfectly, which is a miserable thing to debug.
//
// Exact matches only, for that reason.

export type TerminalWsKind = "claude" | "run" | "launch" | "codex";

// A Map, not an object literal: a plain object would answer `constructor` or `toString`
// through its prototype chain with a truthy value. Unreachable through a URL pathname, which
// always begins with "/", but this table should not depend on that being true forever.
const BY_PATH = new Map<string, TerminalWsKind>([
  ["/ws", "claude"],
  ["/ws/run", "run"],
  ["/ws/launch", "launch"],
  ["/ws/codex", "codex"],
]);

export function terminalWsKind(pathname: string): TerminalWsKind | null {
  return BY_PATH.get(pathname) ?? null;
}
