import { describe, it, expect, vi } from "vitest";
import type { Express } from "express";
import { mountTmuxRoutes, type TmuxRouteDeps } from "../../../server/infra/tmux-routes.js";

interface FakeRes {
  statusCode: number;
  payload: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}
function makeRes(): FakeRes {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

type Handler = (req: { headers: { origin?: string }; params: { id?: string } }, res: FakeRes) => unknown;

// Mount with the given deps and hand back the two handlers by path — no HTTP server
// needed (mirrors gitRemote.spec's capture pattern).
function mountAndCapture(deps: TmuxRouteDeps): { terminate: Handler; cleanup: Handler } {
  const handlers = new Map<string, Handler>();
  const app = { post: (p: string, h: Handler) => handlers.set(p, h) } as unknown as Express;
  mountTmuxRoutes(app, deps);
  const terminate = handlers.get("/api/session/:id/terminate");
  const cleanup = handlers.get("/api/tmux/cleanup-orphans");
  if (!terminate || !cleanup) throw new Error("routes were not mounted");
  return { terminate, cleanup };
}

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

function baseDeps(over: Partial<TmuxRouteDeps> = {}): TmuxRouteDeps {
  return {
    isAllowedOrigin: () => true,
    isValidSessionId: (id) => id === UUID,
    reapSession: vi.fn(),
    hasTmux: () => false,
    killTmux: vi.fn(),
    listTmuxIds: () => [],
    attachedClientCount: () => 0, // nobody else attached, by default
    resumablePredicate: async () => () => false,
    ...over,
  };
}

describe("mountTmuxRoutes — POST /api/session/:id/terminate", () => {
  it("rejects a disallowed origin with 403 and reaps nothing", async () => {
    const reapSession = vi.fn();
    const { terminate } = mountAndCapture(baseDeps({ isAllowedOrigin: () => false, reapSession }));
    const res = makeRes();
    await terminate({ headers: { origin: "https://evil.example" }, params: { id: UUID } }, res);
    expect(res.statusCode).toBe(403);
    expect(reapSession).not.toHaveBeenCalled();
  });

  it("rejects an invalid session id with 400 and reaps nothing", async () => {
    const reapSession = vi.fn();
    const { terminate } = mountAndCapture(baseDeps({ reapSession }));
    const res = makeRes();
    await terminate({ headers: {}, params: { id: "not-a-uuid" } }, res);
    expect(res.statusCode).toBe(400);
    expect(reapSession).not.toHaveBeenCalled();
  });

  it("reaps the session and kills a leftover tmux orphan", async () => {
    const reapSession = vi.fn();
    const killTmux = vi.fn();
    const { terminate } = mountAndCapture(baseDeps({ reapSession, killTmux, hasTmux: () => true }));
    const res = makeRes();
    await terminate({ headers: {}, params: { id: UUID } }, res);
    expect(reapSession).toHaveBeenCalledWith(UUID);
    expect(killTmux).toHaveBeenCalledWith(UUID); // tmux still present after reap → killed directly
    expect(res.payload).toEqual({ ok: true });
  });

  it("does not kill tmux directly when reap already removed it", async () => {
    const killTmux = vi.fn();
    const { terminate } = mountAndCapture(baseDeps({ killTmux, hasTmux: () => false }));
    const res = makeRes();
    await terminate({ headers: {}, params: { id: UUID } }, res);
    expect(killTmux).not.toHaveBeenCalled();
    expect(res.payload).toEqual({ ok: true });
  });
});

describe("mountTmuxRoutes — POST /api/tmux/cleanup-orphans", () => {
  it("rejects a disallowed origin with 403 and kills nothing", async () => {
    const killTmux = vi.fn();
    const { cleanup } = mountAndCapture(baseDeps({ isAllowedOrigin: () => false, killTmux, listTmuxIds: () => ["a", "b"] }));
    const res = makeRes();
    await cleanup({ headers: { origin: "https://evil.example" }, params: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(killTmux).not.toHaveBeenCalled();
  });

  it("kills only non-resumable tmux ids (the orphan-selection boundary)", async () => {
    const killTmux = vi.fn();
    const resumable = new Set(["keep-1", "keep-2"]);
    const { cleanup } = mountAndCapture(
      baseDeps({
        killTmux,
        listTmuxIds: () => ["keep-1", "orphan-1", "keep-2", "orphan-2"],
        resumablePredicate: async () => (id) => resumable.has(id),
      }),
    );
    const res = makeRes();
    await cleanup({ headers: {}, params: {} }, res);
    expect(killTmux.mock.calls.map((c) => c[0])).toEqual(["orphan-1", "orphan-2"]);
    expect(res.payload).toEqual({ killed: ["orphan-1", "orphan-2"], killedCount: 2 });
  });

  // Regression (#747): a second mulmoterminal process may have just created a session (no
  // transcript yet, so not resumable here) and be attached to it. Killing it would yank a
  // live session out from under that process, so an orphan another process holds is spared.
  it("spares a non-resumable session that another process is attached to", async () => {
    const killTmux = vi.fn();
    const attached = new Map<string, number | null>([
      ["mine-orphan", 0], // no one attached → really an orphan
      ["theirs", 1], // another process holds it
      ["unknown", null], // tmux couldn't say → treat as held
    ]);
    const { cleanup } = mountAndCapture(
      baseDeps({
        killTmux,
        listTmuxIds: () => ["mine-orphan", "theirs", "unknown"],
        attachedClientCount: (id) => (attached.has(id) ? (attached.get(id) ?? null) : 0),
        resumablePredicate: async () => () => false, // none resumable
      }),
    );
    const res = makeRes();
    await cleanup({ headers: {}, params: {} }, res);
    expect(killTmux.mock.calls.map((c) => c[0])).toEqual(["mine-orphan"]);
    expect(res.payload).toEqual({ killed: ["mine-orphan"], killedCount: 1 });
  });
});

describe("orphanReapable", () => {
  it("reaps only a non-resumable session with zero attached clients", async () => {
    const { orphanReapable } = await import("../../../server/infra/tmux-routes.js");
    expect(orphanReapable(false, 0)).toBe(true);
    expect(orphanReapable(true, 0)).toBe(false); // resumable → never
    expect(orphanReapable(false, 1)).toBe(false); // another process holds it
    expect(orphanReapable(false, null)).toBe(false); // unknown → treat as held
  });
});
