// @vitest-environment node
// Clearing the unplaced mark when a viewer attaches — and the case that makes it two ids, not one.
//
// The resolvers mint a FRESH session id when the requested one can be served neither from a live
// pty nor from an on-disk transcript. A visible spawn that died before writing a transcript is
// exactly that, and exactly the kind that ends up unplaced — so the id the grid ADOPTED and the id
// the session ends up with are different. Clearing only the new one leaves the requested one
// marked forever: every activate adopts it again and mints another session, and the grid fills
// with cells nobody asked for (Codex, PR #1189).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async () => ""),
    appendFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { promises, default: { promises } };
});

const REQUESTED = "11111111-1111-1111-1111-111111111111";
const MINTED = "22222222-2222-2222-2222-222222222222";

async function freshRegistry() {
  vi.resetModules();
  return import("../../../server/session/registry.js");
}

/** What ws-routes' markAttachedSessionPlaced does, against the real registry. */
function attach(registry: { markSessionPlaced: (id: string) => void }, sessionId: string, requested: string | null): void {
  registry.markSessionPlaced(sessionId);
  if (requested && requested !== sessionId) registry.markSessionPlaced(requested);
}

beforeEach(() => vi.clearAllMocks());

describe("an attach clears the unplaced mark", () => {
  it("clears it when the session keeps the id it was asked for", async () => {
    const registry = await freshRegistry();
    registry.markUnplacedSession(REQUESTED);
    attach(registry, REQUESTED, REQUESTED);
    expect(registry.unplacedSessionRows()).toEqual([]);
  });

  it("clears the REQUESTED id even when a fresh one was minted", async () => {
    // Without this the adoption loops: the grid asks, adopts, the server mints a new id, the old
    // one stays marked, and the next activate does it all again.
    const registry = await freshRegistry();
    registry.markUnplacedSession(REQUESTED);
    attach(registry, MINTED, REQUESTED);
    expect(registry.unplacedSessionRows()).toEqual([]);
  });

  it("leaves other sessions waiting", async () => {
    const registry = await freshRegistry();
    registry.markUnplacedSession(REQUESTED);
    registry.markUnplacedSession(MINTED);
    attach(registry, REQUESTED, REQUESTED);
    expect(registry.unplacedSessionRows().map((r) => r.id)).toEqual([MINTED]);
  });

  it("is harmless for a fresh session nobody requested", async () => {
    // The ordinary case: a new cell with no ?session= at all.
    const registry = await freshRegistry();
    expect(() => attach(registry, MINTED, null)).not.toThrow();
    expect(registry.unplacedSessionRows()).toEqual([]);
  });
});
