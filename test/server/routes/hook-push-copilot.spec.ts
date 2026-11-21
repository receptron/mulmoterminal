// @vitest-environment node
// What a copilot cell's finished-turn push says, pinned at the route copilot's agentStop posts to.
//
// The reader (copilotCurrentTurnReply) has its own spec; this pins that the push actually reaches
// it — through the copilot branch of latestReply, with the session id — and that an unanswered turn
// says nothing rather than an older reply (#1650).
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountHookRoute } from "../../../server/routes/hook-routes";
import { aiTitles, lastPrompts, lastResponses, ptys } from "../../../server/session/registry";

const pushes: Array<{ title: string; body: string }> = [];
vi.mock("../../../server/infra/http/web-push.js", () => ({
  sendWebPush: async (title: string, body: string) => {
    pushes.push({ title, body });
    return null;
  },
}));

vi.mock("../../../server/config/config-routes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/config/config-routes")>()),
  getPushEnabled: () => true,
  getPushKinds: () => ["finished", "waiting"],
}));

const ID = "48a9125f-633c-4619-9baa-2cab2c51d18a";
const CWD = "/work/project";

// Keyed by both arguments, so a read under the wrong id or cwd answers null and the test sees it.
const events = vi.hoisted(() => ({ reply: null as string | null }));
vi.mock("../../../server/session/session-reads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/session/session-reads")>()),
  copilotCurrentTurnReply: async (cwd: string, id: string) => (cwd === "/work/project" && id === "48a9125f-633c-4619-9baa-2cab2c51d18a" ? events.reply : null),
  latestUserPrompt: async () => null,
}));

const deps = {
  setWorking: vi.fn(),
  setWaiting: vi.fn(),
  publishActivity: vi.fn(),
  forgetTitle: vi.fn(),
  noteTitleTurn: vi.fn(),
  noteWorkPhase: vi.fn(),
  maybeGenerateTitle: vi.fn(async () => {}),
  recordToolCallStart: vi.fn(async () => {}),
  recordToolCallEnd: vi.fn(async () => {}),
  publishDirConfig: vi.fn(),
  publishFileWrite: vi.fn(),
  publishPromptSubmitted: vi.fn(),
  publishQuestion: vi.fn(),
  uiPort: "34567",
};

const app = express();
app.use(express.json());
mountHookRoute(app, deps);
const call = routeCall(app);

const postAgentStop = async () => {
  const res = await call("/api/hook", jsonPost({ sessionId: ID, cwd: CWD, stopReason: "end_turn" }, { "x-mt-agent": "copilot", "x-mt-hook": "agentStop" }));
  expect(res.status).toBe(200);
};

const nextPush = async (): Promise<{ title: string; body: string }> => {
  await vi.waitFor(() => expect(pushes).toHaveLength(1));
  const sent = pushes[0];
  if (!sent) throw new Error("no push was sent");
  return sent;
};

beforeEach(() => {
  pushes.length = 0;
  events.reply = null;
  lastPrompts.set(ID, "read a.txt");
  aiTitles.delete(ID);
  lastResponses.delete(ID);
  ptys.set(ID, { term: { kill: () => undefined }, ws: null, buffer: "", cwd: CWD, active: false, agent: "copilot" } as never);
});

describe("a copilot cell's finished turn", () => {
  it("says what this turn answered, read from copilot's event log", async () => {
    events.reply = "The fruits are apple and banana.";
    await postAgentStop();

    expect((await nextPush()).body).toBe("The fruits are apple and banana.");
    expect(lastResponses.get(ID)).toBe("The fruits are apple and banana.");
  });

  it("says nothing about the outcome when this turn has no answer, instead of an older one", async () => {
    await postAgentStop();

    const { body } = await nextPush();
    expect(body).toBe("タスクが完了しました");
    expect(lastResponses.has(ID)).toBe(false);
  });
});
