// @vitest-environment node
// What a `/clear` does to the session state the cockpit roster reads, pinned at the route.
//
// The pieces have their own specs — headerHookEffect decides that SessionStart source=clear IS a
// clear, and the readers each have a guard — but this is the seam where the user-visible bug lived
// (#1085): the route blanked the prompt and reply and left the transcript unmarked, so the next
// turn read the pre-clear title and reply back out of a file claude had already abandoned.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountHookRoute } from "../../../server/routes/hook-routes";
import { lastPrompts, lastResponses } from "../../../server/session/registry";
import { clearedTranscripts } from "../../../server/session/transcript/cleared-transcripts";

// The prompt seed reads the transcript for a session this process has no prompt for; the tests
// stand in for that read so the seeding branch can be observed without a transcript on disk.
vi.mock("../../../server/session/session-reads.js", () => ({ latestUserPrompt: vi.fn(async () => "continue GitHub issue 1048") }));

// The mark's durable half has its own spec; what this one must not do is write into the real
// ~/.mulmoterminal. Stubbing the writer keeps the route's own behaviour — including WHICH cwd it
// hands over, which is the wiring that decides whether the mark can survive a restart at all.
const markCalls: Array<[string, string | undefined]> = [];
const claudeIds: Array<string | undefined> = [];
const successors = new Map<string, string | undefined>();
vi.mock("../../../server/session/transcript/cleared-transcripts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/session/transcript/cleared-transcripts")>();
  return {
    ...actual,
    markTranscriptCleared: async (id: string, cwd: string | undefined, claudeId?: string) => {
      markCalls.push([id, cwd]);
      claudeIds.push(claudeId);
      actual.clearedTranscripts.add(id);
      successors.set(id, claudeId);
    },
    clearedClaudeIdOf: (id: string) => successors.get(id),
  };
});

const ID = "11111111-2222-4333-8444-555555555555";

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

/** Every assertion in this file is about a SIDE EFFECT of the hook, so a route that refused the
 *  post would read as "nothing happened" rather than "the route said no" (CodeRabbit on #1799). */
const postHook = async (body: Record<string, unknown>) => {
  const res = await call("/api/hook", jsonPost(body, { "x-mt-session": ID }));
  expect(res.status).toBe(200);
  return res;
};

beforeEach(() => {
  lastPrompts.delete(ID);
  lastResponses.delete(ID);
  clearedTranscripts.delete(ID);
  markCalls.length = 0;
  claudeIds.length = 0;
  successors.clear();
  vi.clearAllMocks();
});

describe("SessionStart source=clear", () => {
  it("blanks the prompt and reply, drops the title, and marks the transcript cleared", async () => {
    lastPrompts.set(ID, "continue GitHub issue 1048");
    lastResponses.set(ID, "Done — issue 1048 is closed.");

    await postHook({ hook_event_name: "SessionStart", source: "clear" });

    // Empty string, not deleted: it has to beat the transcript fallback in /api/session.
    expect(lastPrompts.get(ID)).toBe("");
    expect(lastResponses.get(ID)).toBe("");
    expect(clearedTranscripts.has(ID)).toBe(true);
    expect(deps.forgetTitle).toHaveBeenCalledWith(ID);
    expect(deps.publishActivity).toHaveBeenCalledWith(ID);
  });

  // `/compact` arrives as SessionStart too, mid-conversation. Marking its transcript cleared
  // would freeze the summary of a session that is still going and still writing to that file.
  it("leaves a session alone on any other SessionStart", async () => {
    lastPrompts.set(ID, "continue GitHub issue 1048");

    await postHook({ hook_event_name: "SessionStart", source: "compact" });

    expect(lastPrompts.get(ID)).toBe("continue GitHub issue 1048");
    expect(clearedTranscripts.has(ID)).toBe(false);
    expect(deps.forgetTitle).not.toHaveBeenCalled();
  });

  // The mark is persisted against the transcript's size, so it needs the directory that
  // transcript lives in. The hook's own cwd wins over the spawn dir (resolveHookCwd) — a session
  // that has cd'd would otherwise be sized against a file in the wrong project.
  it("hands the mark the cwd the hook reported", async () => {
    await postHook({ hook_event_name: "SessionStart", source: "clear", cwd: "/work/other-project" });
    expect(markCalls).toEqual([[ID, "/work/other-project"]]);
  });
});

// `/resume` typed inside the cell moves claude to ANOTHER conversation's transcript while the
// session keeps its id. Left in memory, a restart then resumed the session's own id — abandoned, or
// never written at all — and the cell came back as a brand-new conversation.
describe("SessionStart source=resume", () => {
  const OTHER = "99999999-8888-4777-8666-555555555555";

  it("marks the session moved, with the conversation claude resumed as its successor", async () => {
    lastPrompts.set(ID, "the abandoned task");
    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: OTHER, cwd: "/work" });

    expect(markCalls).toEqual([[ID, "/work"]]);
    expect(claudeIds).toEqual([OTHER]);
    expect(lastPrompts.get(ID)).toBe("");
    expect(deps.forgetTitle).toHaveBeenCalledWith(ID);
  });

  // Every ordinary restart: claude resumes the session's own transcript.
  it("leaves a session alone when claude resumed its own transcript", async () => {
    lastPrompts.set(ID, "still the task");
    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: ID, cwd: "/work" });

    expect(markCalls).toEqual([]);
    expect(lastPrompts.get(ID)).toBe("still the task");
    expect(deps.forgetTitle).not.toHaveBeenCalled();
  });

  // The restart that resumes the successor fires the hook again; re-marking would blank the header
  // on every restart.
  it("does not mark again when claude resumed the successor already recorded", async () => {
    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: OTHER, cwd: "/work" });
    lastPrompts.set(ID, "the resumed task");
    vi.clearAllMocks();

    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: OTHER, cwd: "/work" });

    expect(markCalls).toHaveLength(1);
    expect(lastPrompts.get(ID)).toBe("the resumed task");
    expect(deps.forgetTitle).not.toHaveBeenCalled();
  });

  it("ignores a resume that names no usable id", async () => {
    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: "not-a-uuid", cwd: "/work" });
    expect(markCalls).toEqual([]);
  });
});

// A prompt arriving for a session this process holds nothing for is normally seeded from the
// transcript, so a trivial ack cannot overwrite the task a resume restored. After a restart that
// branch is reached for a CLEARED session too — where the transcript is the conversation the user
// ended, and seeding from it is how the abandoned task returns to the header (#1085).
describe("UserPromptSubmit after a restart", () => {
  it("seeds the header from the transcript for an ordinary session", async () => {
    await postHook({ hook_event_name: "UserPromptSubmit", prompt: "ok", cwd: "/work" });
    expect(lastPrompts.get(ID)).toBe("continue GitHub issue 1048");
  });

  it("does not seed a cleared session — it takes the new prompt as-is", async () => {
    clearedTranscripts.add(ID);
    await postHook({ hook_event_name: "UserPromptSubmit", prompt: "ok", cwd: "/work" });
    expect(lastPrompts.get(ID)).toBe("ok");
  });
});
