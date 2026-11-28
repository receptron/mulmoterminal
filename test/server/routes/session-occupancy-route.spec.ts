// @vitest-environment node
//
// Who holds ONE session and what runs it (#3343): the answer the Library asks for a conversation the
// capped `/api/sessions` list does not reach. It must say what a list row would, from the same
// evidence — a socket here, a tmux client of another process, a session still running.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { routeCall } from "../../helpers/routeCall";

const tmux = { clients: new Map<string, number>() as Map<string, number> | null, sessions: [] as string[] };
vi.mock("../../../server/infra/process/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  tmuxAttachedCounts: () => tmux.clients,
  tmuxListSessionIds: () => tmux.sessions,
}));

const { mountSessionRoutes } = await import("../../../server/routes/session-routes.js");
const { ptys } = await import("../../../server/session/registry.js");

const app = express();
mountSessionRoutes(app, { freshenRosterTitle: () => {}, publishActivity: () => {}, agentOfSession: () => null });
const call = routeCall(app);

const SESSION = "3d0f1a52-8c41-4b77-9f0e-21336c0a9e7b";
const OPEN = 1;
const viewedPty = (id: string) => {
  // Only the socket's readyState and the tmux flag are read; the entry stands in for a live pty.
  ptys.set(id, { cwd: "/repo", agent: "claude", ws: { readyState: OPEN, OPEN }, tmux: false } as unknown as NonNullable<ReturnType<typeof ptys.get>>);
};

beforeEach(() => {
  tmux.clients = new Map();
  tmux.sessions = [];
  ptys.clear();
});

describe("GET /api/sessions/occupancy", () => {
  it.each([[""], ["?id="], ["?id=not-a-session"], [`?id=${SESSION}x`], [`?id=${SESSION}&id=${SESSION}`]])("refuses %s", async (query) => {
    expect((await call(`/api/sessions/occupancy${query}`)).status).toBe(400);
  });

  it("answers free for a session nothing holds or runs", async () => {
    const res = await call(`/api/sessions/occupancy?id=${SESSION}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: SESSION, attached: false, runningKey: null });
  });

  it("answers held for a session a client of another process is attached to", async () => {
    tmux.clients = new Map([[SESSION, 1]]);
    tmux.sessions = [SESSION];
    expect((await call(`/api/sessions/occupancy?id=${SESSION}`)).body).toEqual({ id: SESSION, attached: true, runningKey: SESSION });
  });

  it("answers held for a session a socket in this process is viewing", async () => {
    viewedPty(SESSION);
    expect((await call(`/api/sessions/occupancy?id=${SESSION}`)).body).toEqual({ id: SESSION, attached: true, runningKey: SESSION });
  });

  it("answers running but free for a session nobody is attached to", async () => {
    tmux.sessions = [SESSION];
    expect((await call(`/api/sessions/occupancy?id=${SESSION}`)).body).toEqual({ id: SESSION, attached: false, runningKey: SESSION });
  });

  it("answers free when tmux cannot say who is attached, as a list row does", async () => {
    tmux.clients = null;
    expect((await call(`/api/sessions/occupancy?id=${SESSION}`)).body).toEqual({ id: SESSION, attached: false, runningKey: null });
  });
});
