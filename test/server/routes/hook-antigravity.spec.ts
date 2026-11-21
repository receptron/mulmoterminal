// @vitest-environment node
// The antigravity branch of /api/hook, pinned at the ROUTE: antigravity-hook.spec.ts proves the
// translation, this proves it is wired — a turn's first model call lights 'working', its Stop flags
// the cell and sends the finished push, and the session comes from the header alone.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountHookRoute } from "../../../server/routes/hook-routes";
import { ptys } from "../../../server/session/registry";

vi.mock("../../../server/session/session-reads.js", () => ({
  latestUserPrompt: vi.fn(async () => null),
  sessionLastTurn: vi.fn(async () => ({ prompt: null, reply: null })),
  antigravityCurrentTurnReply: vi.fn(async () => null),
}));

const ID = "4078f9a6-4ce0-4906-a544-ca0cf917eb96";
const AGY_OWN_ID = "11723809-6245-4649-a089-d243228ab19b";
const BASE = { conversationId: AGY_OWN_ID, workspacePaths: ["/tmp/probe"], modelName: "gemini-3.8-flash-high" };

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

const postAgy = async (hook: string, payload: Record<string, unknown>, headers: Record<string, string> = { "x-mt-session": ID }) => {
  const res = await call("/api/hook", jsonPost(payload, { "x-mt-agent": "antigravity", "x-mt-hook": hook, ...headers }));
  expect(res.status).toBe(200);
};

const liveCell = (active: boolean) => {
  const entry = { term: { pid: 1 }, ws: null, buffer: "", cwd: "/tmp/probe", tmux: true, active, agent: "antigravity" };
  ptys.set(ID, entry as unknown as NonNullable<ReturnType<typeof ptys.get>>);
};

beforeEach(() => {
  ptys.delete(ID);
  vi.clearAllMocks();
});

describe("/api/hook with x-mt-agent: antigravity", () => {
  it("lights 'working' on the turn's first model call", async () => {
    liveCell(false);
    await postAgy("PreInvocation", { ...BASE, invocationNum: 0 });
    expect(deps.setWorking).toHaveBeenCalledWith(ID, true, "UserPromptSubmit");
  });

  it("does not re-announce a later model call in the same turn", async () => {
    liveCell(false);
    await postAgy("PreInvocation", { ...BASE, invocationNum: 2 });
    expect(deps.setWorking).not.toHaveBeenCalled();
  });

  it("flags an unwatched cell when the turn stops", async () => {
    liveCell(false);
    await postAgy("Stop", { ...BASE, terminationReason: "NO_TOOL_CALL", fullyIdle: true });
    expect(deps.setWaiting).toHaveBeenCalledWith(ID, true, "Stop");
    expect(deps.setWorking).toHaveBeenCalledWith(ID, false, "Stop");
  });

  it("only clears 'working' on the cell the user is looking at", async () => {
    liveCell(true);
    await postAgy("Stop", BASE);
    expect(deps.setWaiting).not.toHaveBeenCalled();
    expect(deps.setWorking).toHaveBeenCalledWith(ID, false, "Stop");
  });

  it("does nothing without x-mt-session, though agy's own id is a well-formed uuid", async () => {
    await postAgy("Stop", BASE, {});
    expect(deps.setWaiting).not.toHaveBeenCalled();
    expect(deps.setWorking).not.toHaveBeenCalled();
  });
});
