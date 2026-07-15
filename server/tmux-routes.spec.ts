import { describe, it, expect, vi } from "vitest";
import type { Express } from "express";
import { mountTmuxRoutes, type TmuxRouteDeps } from "./tmux-routes.js";

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
});
