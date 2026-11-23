// @vitest-environment node
// The newest hook event (#3413) is recorded as a hook ARRIVES, before any of the route's awaited work.
// Recorded after it, a slow hook finishing second would overwrite the one that came after it — a
// prompt read from disk landing on top of the permission prompt that followed — and a hook still in
// that work when its session is reaped would write the record back for an id nothing reaps again.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountHookRoute } from "../../../server/routes/hook-routes";
import { lastHookEvent, lastPrompts, ptys } from "../../../server/session/registry";

const promptRead = vi.hoisted(() => ({ release: (): void => undefined }));
vi.mock("../../../server/session/session-reads.js", () => ({
  // The UserPromptSubmit header hook awaits this read; the spec decides when it returns.
  latestUserPrompt: vi.fn(
    () =>
      new Promise<null>((resolve) => {
        promptRead.release = () => resolve(null);
      }),
  ),
  sessionLastTurn: vi.fn(async () => ({ prompt: null, reply: null })),
}));

const ID = "4078f9a6-4ce0-4906-a544-ca0cf917eb97";

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

const post = (body: Record<string, unknown>) => call("/api/hook", jsonPost({ session_id: ID, cwd: "/tmp/probe", ...body }));

beforeEach(() => {
  const entry = { term: { pid: 1 }, ws: null, buffer: "", cwd: "/tmp/probe", tmux: true, active: false, agent: "claude" };
  ptys.set(ID, entry as unknown as NonNullable<ReturnType<typeof ptys.get>>);
  lastHookEvent.delete(ID);
  lastPrompts.delete(ID);
});

describe("the newest hook event", () => {
  it("follows the order hooks arrive in, not the order their awaited work finishes", async () => {
    const slowPrompt = post({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await vi.waitFor(() => expect(lastHookEvent.get(ID)).toBe("UserPromptSubmit"));
    const block = await post({ hook_event_name: "Notification", notification_type: "permission_prompt" });
    expect(block.status).toBe(200);
    promptRead.release();
    expect((await slowPrompt).status).toBe(200);
    expect(lastHookEvent.get(ID)).toBe("Notification");
  });

  it("is not written back for a session reaped while its hook was still in awaited work", async () => {
    const slowPrompt = post({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await vi.waitFor(() => expect(lastHookEvent.get(ID)).toBe("UserPromptSubmit"));
    ptys.delete(ID);
    lastHookEvent.delete(ID);
    promptRead.release();
    await slowPrompt;
    expect(lastHookEvent.has(ID)).toBe(false);
  });
});
