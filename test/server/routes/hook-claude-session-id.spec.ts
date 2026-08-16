// @vitest-environment node
// That the hook route REMEMBERS claude's own session id, pinned at the route.
//
// The rule and its consequences have their own specs (claudeOwnSessionId, historyIdsFor), and this
// is the seam between them: a `/clear` re-mints claude's id while its hooks keep reporting to us
// under ours, so anything keyed by CLAUDE's id — its prompt-history file — reads the wrong session
// from that moment unless the route captures the new one (#1749). Nothing else observes the
// mapping, so a missing `claudeSessionIds.set` would be invisible in every other spec.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mountHookRoute } from "../../../server/routes/hook-routes";
import { claudeSessionIds } from "../../../server/session/registry";

vi.mock("../../../server/session/session-reads.js", () => ({ latestUserPrompt: vi.fn(async () => null) }));
vi.mock("../../../server/session/cleared-transcripts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/session/cleared-transcripts")>();
  return { ...actual, markTranscriptCleared: async () => {} };
});

const OURS = "11111111-2222-4333-8444-555555555555";
const REISSUED = "99999999-8888-4777-8666-555555555555";
const THIRD = "22222222-3333-4444-8555-666666666666";

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

const postHook = (body: Record<string, unknown>) => request(app).post("/api/hook").set("x-mt-session", OURS).send(body);

beforeEach(() => {
  claudeSessionIds.delete(OURS);
  vi.clearAllMocks();
});

describe("the hook route remembers claude's own session id", () => {
  it("records the id claude reports for itself, under ours", async () => {
    await postHook({ hook_event_name: "UserPromptSubmit", session_id: REISSUED, prompt: "go" });
    expect(claudeSessionIds.get(OURS)).toBe(REISSUED);
  });

  // Any hook, not just a prompt: the mapping is in memory, so after a restart the first tool call
  // of an already-running session is the earliest chance to re-learn it.
  it("records it from a tool hook too", async () => {
    await postHook({ hook_event_name: "PreToolUse", session_id: REISSUED, tool_name: "Bash", tool_input: { command: "ls" } });
    expect(claudeSessionIds.get(OURS)).toBe(REISSUED);
  });

  it("follows a re-mint rather than sticking to the first id it saw", async () => {
    await postHook({ hook_event_name: "Stop", session_id: OURS });
    expect(claudeSessionIds.get(OURS)).toBe(OURS);
    await postHook({ hook_event_name: "Stop", session_id: THIRD });
    expect(claudeSessionIds.get(OURS)).toBe(THIRD);
  });

  // A `/clear` must not leave the pane with no id at all. The same hook carries claude's new one,
  // and it is recorded AFTER the header hooks so nothing in the clear path can wipe it.
  it("keeps an id across a /clear — the one that hook carries", async () => {
    await postHook({ hook_event_name: "Stop", session_id: OURS });
    await postHook({ hook_event_name: "SessionStart", source: "clear", session_id: REISSUED });
    expect(claudeSessionIds.get(OURS)).toBe(REISSUED);
  });

  it("records nothing for a body that names no usable id", async () => {
    await postHook({ hook_event_name: "Stop" });
    expect(claudeSessionIds.has(OURS)).toBe(false);
    await postHook({ hook_event_name: "Stop", session_id: "../etc/passwd" });
    expect(claudeSessionIds.has(OURS)).toBe(false);
    await postHook({ hook_event_name: "Stop", session_id: 42 });
    expect(claudeSessionIds.has(OURS)).toBe(false);
  });
});

// Codex, #1749: the pane first listened to the `sessions` activity row, which is suppressed when
// the working flag does not MOVE (nextActivity returns null by design, so an unchanged row cannot
// flood the socket). A prompt typed into a turn that is already running leaves `working` true, so
// it announced nothing — and that prompt, the interruption, is the whole reason this pane exists.
// Its own signal, from the one place that knows a REAL prompt arrived.
describe("the prompts pane's own signal", () => {
  it("fires on a submitted prompt", async () => {
    await postHook({ hook_event_name: "UserPromptSubmit", session_id: OURS, prompt: "go" });
    expect(deps.publishPromptSubmitted).toHaveBeenCalledWith(OURS);
  });

  // The case the feature is for: the agent is mid-turn, so no activity flag moves.
  it("fires again for a SECOND prompt during the same turn", async () => {
    await postHook({ hook_event_name: "UserPromptSubmit", session_id: OURS, prompt: "first" });
    await postHook({ hook_event_name: "UserPromptSubmit", session_id: OURS, prompt: "and also this" });
    expect(deps.publishPromptSubmitted).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for text the harness injected, which nobody typed", async () => {
    await postHook({ hook_event_name: "UserPromptSubmit", session_id: OURS, prompt: "<task-notification>done</task-notification>" });
    await postHook({ hook_event_name: "UserPromptSubmit", session_id: OURS, prompt: "   " });
    expect(deps.publishPromptSubmitted).not.toHaveBeenCalled();
  });

  it("stays quiet for a hook that is not a prompt at all", async () => {
    await postHook({ hook_event_name: "Stop", session_id: OURS });
    await postHook({ hook_event_name: "PreToolUse", session_id: OURS, tool_name: "Bash" });
    expect(deps.publishPromptSubmitted).not.toHaveBeenCalled();
  });
});
