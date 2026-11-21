// @vitest-environment node
// POST /api/library/conversations/:id/promote (#3334): a Claude session in the directory the index
// holds for the conversation, never one the browser names, with the skill asked to promote it.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall } from "../../helpers/routeCall";
import { mountLibraryRoutes } from "../../../server/routes/library-routes";
import type { LibraryConversation } from "../../../common/library";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const ID = "0b9f6a1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const conversationIn = (cwd: string | null, over: Partial<LibraryConversation> = {}): LibraryConversation => ({
  ...{ id: ID, agent: "claude", title: "t", cwd, gitBranch: null, prs: [], costUsd: null, linesAdded: null, linesRemoved: null },
  ...{ startedAt: 1, endedAt: 2, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
  ...over,
});

/** A Library whose index holds `found(dir)` for any id, `dir` being a real directory made here. */
function setup(found: (dir: string) => LibraryConversation | null, allowed = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-promote-"));
  dirs.push(dir);
  const spawned: unknown[][] = [];
  const asked: unknown[][] = [];
  const app = express();
  app.use(express.json());
  mountLibraryRoutes(app, {
    call: (method, args) => {
      asked.push([method, ...args]);
      return Promise.resolve(method === "conversation" ? found(dir) : null);
    },
    promote: {
      spawnSession: (...args) => {
        spawned.push(args);
        return Promise.resolve({ sessionId: "new-session", agent: "claude", seedRuns: true });
      },
      isAllowedOrigin: () => allowed,
    },
  });
  const post = (id: string, body: unknown) =>
    routeCall(app)(`/api/library/conversations/${id}/promote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { dir, spawned, asked, post };
}

describe("promoting a conversation", () => {
  it("starts Claude in the directory the index holds, running the skill on that conversation", async () => {
    const { dir, spawned, asked, post } = setup((here) => conversationIn(here));
    const answer = await post(ID, { cwd: "/somewhere/the/browser/said", target: "rule" });
    expect([answer.status, answer.body]).toEqual([200, { chatId: "new-session", agent: "claude" }]);
    expect(spawned).toEqual([["claude", dir, `/mulmoterminal-library promote rule ${ID}`, true, null]]);
    expect(asked).toEqual([["conversation", ID, "/somewhere/the/browser/said"]]);
  });

  it("refuses a target that is not one, an id that is not a session's, and a cwd that is not a string", async () => {
    const { spawned, post } = setup((here) => conversationIn(here));
    for (const [id, body] of [
      [ID, { target: "everything" }],
      [ID, {}],
      ["agent-abc", { target: "memory" }],
      [ID, { target: "memory", cwd: 3 }],
    ] as const) {
      expect((await post(id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(spawned).toEqual([]);
  });

  it("answers 404 for a conversation the index does not have, or one that is not Claude's", async () => {
    expect((await setup(() => null).post(ID, { target: "plan" })).status).toBe(404);
    const codex = setup((here) => conversationIn(here, { agent: "codex" }));
    expect((await codex.post(ID, { target: "plan" })).status).toBe(404);
    expect(codex.spawned).toEqual([]);
  });

  it("answers 409 when the conversation's directory is not on this machine, or it has none", async () => {
    const gone = setup(() => conversationIn("/no/such/directory/anywhere"));
    expect((await gone.post(ID, { target: "issue" })).status).toBe(409);
    const none = setup(() => conversationIn(null));
    expect((await none.post(ID, { target: "issue" })).status).toBe(409);
    expect([...gone.spawned, ...none.spawned]).toEqual([]);
  });

  it("refuses a request from another origin before anything else", async () => {
    const { spawned, asked, post } = setup((here) => conversationIn(here), false);
    expect((await post(ID, { target: "skill" })).status).toBe(403);
    expect([spawned, asked]).toEqual([[], []]);
  });
});
