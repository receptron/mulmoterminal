// @vitest-environment node
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
type MountedHandler = (req: { headers: { origin?: string }; params: { id?: string }; method: string; path: string }, res: FakeRes) => unknown;

// Mount with the given deps and hand back the two handlers by path — no HTTP server
// needed (mirrors gitRemote.spec's capture pattern). The captured handler is wrapped to
// carry the method and path Express would have set: the origin guard reads both, since it
// is the same rule the central gate applies (a safe method is never judged by origin).
function mountAndCapture(deps: TmuxRouteDeps): { terminate: Handler; cleanup: Handler; surviving: Handler } {
  const handlers = new Map<string, Handler>();
  const app = {
    post: (p: string, h: MountedHandler) => handlers.set(p, (req, res) => h({ ...req, method: "POST", path: p }, res)),
    // The surviving-sessions listing is a GET (#1478); it is judged by the same origin rule, so it
    // is captured the same way rather than left out of this harness.
    get: (p: string, h: MountedHandler) => handlers.set(p, (req, res) => h({ ...req, method: "GET", path: p }, res)),
  } as unknown as Express;
  mountTmuxRoutes(app, deps);
  const terminate = handlers.get("/api/session/:id/terminate");
  const cleanup = handlers.get("/api/tmux/cleanup-orphans");
  const surviving = handlers.get("/api/tmux/sessions");
  if (!terminate || !cleanup || !surviving) throw new Error("routes were not mounted");
  return { terminate, cleanup, surviving };
}

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

function baseDeps(over: Partial<TmuxRouteDeps> = {}): TmuxRouteDeps {
  return {
    isAllowedOrigin: () => true,
    isValidSessionId: (id) => id === UUID,
    reapSession: vi.fn(),
    hasTmux: () => false,
    killTmux: vi.fn(),
    sweep: () => ({ reaped: [], heldBack: 0, recent: 0, unclear: 0 }),
    survivingSessions: async () => [],
    // Off by default, which is what an untouched config arms (#2184).
    armedReapIntervalHours: () => 0,
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
    let alive = true; // the orphan is there until killTmux takes it
    const killTmux = vi.fn(() => {
      alive = false;
    });
    const { terminate } = mountAndCapture(baseDeps({ reapSession, killTmux, hasTmux: () => alive }));
    const res = makeRes();
    await terminate({ headers: {}, params: { id: UUID } }, res);
    expect(reapSession).toHaveBeenCalledWith(UUID);
    expect(killTmux).toHaveBeenCalledWith(UUID); // tmux still present after reap → killed directly
    expect(res.payload).toEqual({ ok: true, ended: true });
  });

  it("does not kill tmux directly when reap already removed it", async () => {
    const killTmux = vi.fn();
    const { terminate } = mountAndCapture(baseDeps({ killTmux, hasTmux: () => false }));
    const res = makeRes();
    await terminate({ headers: {}, params: { id: UUID } }, res);
    expect(killTmux).not.toHaveBeenCalled();
    expect(res.payload).toEqual({ ok: true, ended: true });
  });

  // `ended` is the post-condition, and the only caller that can act on it is the restart: it
  // reconnects on this answer, and reconnecting to a session that survived ATTACHES the process it
  // was asked to replace. So a kill that did not take must not read as a 200 that did.
  it("reports NOT ended when the tmux session outlives the kill", async () => {
    const killTmux = vi.fn(); // fails silently: the session is still there afterwards
    const { terminate } = mountAndCapture(baseDeps({ killTmux, hasTmux: () => true }));
    const res = makeRes();
    await terminate({ headers: {}, params: { id: UUID } }, res);
    expect(killTmux).toHaveBeenCalledWith(UUID);
    expect(res.payload).toEqual({ ok: true, ended: false });
  });
});

describe("mountTmuxRoutes — POST /api/tmux/cleanup-orphans", () => {
  const swept = { reaped: ["orphan-1", "orphan-2"], heldBack: 1, recent: 3, unclear: 0 };

  it("rejects a disallowed origin with 403 and sweeps nothing", async () => {
    const sweep = vi.fn(() => swept);
    const { cleanup } = mountAndCapture(baseDeps({ isAllowedOrigin: () => false, sweep }));
    const res = makeRes();
    await cleanup({ headers: { origin: "https://evil.example" }, params: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(sweep).not.toHaveBeenCalled();
  });

  // The route no longer carries the decision. It used to select orphans itself against
  // `isResumableTmuxSession` — a predicate made of permanent records, which is why it ended almost
  // nothing (#1467). One rule now, in session/reap-idle-sessions.ts, and it is the same one the
  // server runs at boot; what is pinned here is that the route reports it faithfully.
  it("answers with exactly what the sweep ended", async () => {
    const { cleanup } = mountAndCapture(baseDeps({ sweep: () => swept }));
    const res = makeRes();
    await cleanup({ headers: {}, params: {} }, res);
    expect(res.payload).toEqual({ killed: ["orphan-1", "orphan-2"], killedCount: 2 });
  });

  it("says it ended nothing rather than failing when everything is in use", async () => {
    const { cleanup } = mountAndCapture(baseDeps({ sweep: () => ({ reaped: [], heldBack: 4, recent: 0, unclear: 0 }) }));
    const res = makeRes();
    await cleanup({ headers: {}, params: {} }, res);
    expect(res.payload).toEqual({ killed: [], killedCount: 0 });
  });
});

// The Settings list's own route (#1478). Read-only, and still judged by origin: it names every
// directory this machine has agents in, which is not something a page from elsewhere may read.
describe("mountTmuxRoutes — GET /api/tmux/sessions", () => {
  const ROW = { key: "s-1", cwd: "/repo", agent: "claude" as const, idleSeconds: 60, attached: false, resumable: true, reapable: false };

  it("answers with what the builder produced, untouched", async () => {
    const { surviving } = mountAndCapture(baseDeps({ survivingSessions: async () => [ROW] }));
    const res = makeRes();
    await surviving({ headers: {}, params: {} }, res);
    expect(res.payload).toEqual({ sessions: [ROW], armedReapIntervalHours: 0 });
  });

  // The cadence this PROCESS armed, which the saved config does not tell the client: the timer is
  // armed once at boot and deliberately not re-armed on a POST, so between a save and a restart
  // the two disagree. The row's promise depends on this one, not on the saved one (#2184).
  it("says which cadence is actually armed, not which one is saved", async () => {
    const { surviving } = mountAndCapture(baseDeps({ armedReapIntervalHours: () => 6 }));
    const res = makeRes();
    await surviving({ headers: {}, params: {} }, res);
    expect(res.payload).toEqual({ sessions: [], armedReapIntervalHours: 6 });
  });

  // Asked per request rather than captured at mount: routes are mounted before the server listens,
  // and the schedule does not arm until it does — a captured value would be 0 forever.
  it("asks for the armed cadence on every request", async () => {
    const armed = vi.fn(() => 6);
    const { surviving } = mountAndCapture(baseDeps({ armedReapIntervalHours: armed }));
    await surviving({ headers: {}, params: {} }, makeRes());
    await surviving({ headers: {}, params: {} }, makeRes());
    expect(armed).toHaveBeenCalledTimes(2);
  });

  // Safe methods are EXEMPT from the origin rule on purpose (same-origin-guard.ts, #1094): a
  // cross-site `<img>` sends no Origin header and neither does a legitimate local fetch, so
  // refusing by origin blocks the second without stopping the first. A page from elsewhere still
  // cannot READ this — that is the browser's job, not ours. Pinned because the opposite reading is
  // the tempting one, and "hardening" it would break the app's own page.
  it("is not refused by origin, the way a state-changing route is", async () => {
    const { surviving, cleanup } = mountAndCapture(baseDeps({ isAllowedOrigin: () => false, survivingSessions: async () => [ROW] }));
    const read = makeRes();
    await surviving({ headers: { origin: "https://elsewhere.example" }, params: {} }, read);
    expect(read.payload).toEqual({ sessions: [ROW], armedReapIntervalHours: 0 });

    const write = makeRes();
    await cleanup({ headers: { origin: "https://elsewhere.example" }, params: {} }, write);
    expect(write.statusCode).toBe(403);
  });
});
