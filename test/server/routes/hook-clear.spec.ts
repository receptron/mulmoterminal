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
// Keyed by transcript id: our own holds the pre-move task, the picked one its own last exchange.
const PICKED_PROMPT = "pick up the release notes";
const PICKED_REPLY = "The release notes are drafted.";
// `pickedRead` lets a test hold the picked conversation's read open, to overlap two moves.
const pickedRead = vi.hoisted(() => ({ gate: Promise.resolve() }));
vi.mock("../../../server/session/session-reads.js", () => ({
  latestUserPrompt: vi.fn(async (_cwd: string, id: string) => {
    if (id !== "22222222-3333-4444-8555-666666666666") return "continue GitHub issue 1048";
    await pickedRead.gate;
    return PICKED_PROMPT;
  }),
  readLatestResponse: vi.fn((id: string) => (id === "22222222-3333-4444-8555-666666666666" ? PICKED_REPLY : null)),
}));

// The mark's durable half has its own spec; what this one must not do is write into the real
// ~/.mulmoterminal. Stubbing the writer keeps the route's own behaviour — including WHICH cwd it
// hands over, which is the wiring that decides whether the mark can survive a restart at all.
const markCalls: Array<[string, string | undefined, string | undefined]> = [];
const successors = new Map<string, string>();
vi.mock("../../../server/session/transcript/cleared-transcripts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/session/transcript/cleared-transcripts")>();
  return {
    ...actual,
    markTranscriptCleared: async (id: string, cwd: string | undefined, claudeId?: string) => {
      markCalls.push([id, cwd, claudeId]);
      actual.clearedTranscripts.add(id);
      if (claudeId) successors.set(id, claudeId);
    },
    clearedClaudeIdOf: (id: string) => successors.get(id),
    transcriptIdOf: (id: string) => (actual.clearedTranscripts.has(id) ? (successors.get(id) ?? null) : id),
    forgetClearedTranscript: async (id: string) => {
      actual.clearedTranscripts.delete(id);
      successors.delete(id);
      return true;
    },
  };
});

const ID = "11111111-2222-4333-8444-555555555555";
const PICKED = "22222222-3333-4444-8555-666666666666";

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
  successors.clear();
  markCalls.length = 0;
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
    expect(markCalls).toEqual([[ID, "/work/other-project", undefined]]);
  });
});

// An in-session `/resume` moves claude off our transcript exactly as `/clear` does (#3325).
describe("SessionStart source=resume", () => {
  // The header follows the cell to the conversation it picked, rather than going blank (#3347).
  it("marks the transcript with the picked conversation and shows that conversation's last exchange", async () => {
    lastPrompts.set(ID, "continue GitHub issue 1048");

    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: PICKED, cwd: "/work" });

    expect(markCalls).toEqual([[ID, "/work", PICKED]]);
    expect(lastPrompts.get(ID)).toBe(PICKED_PROMPT);
    expect(lastResponses.get(ID)).toBe(PICKED_REPLY);
    expect(deps.forgetTitle).toHaveBeenCalledWith(ID);
  });

  // Our own `--resume <successor>` after a restart reports the same thing; re-marking it would
  // blank the header on every restart.
  it("leaves the session alone when claude is on the recorded successor", async () => {
    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: PICKED });
    markCalls.length = 0;
    lastPrompts.set(ID, "the successor's task");

    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: PICKED });

    expect(markCalls).toEqual([]);
    expect(lastPrompts.get(ID)).toBe("the successor's task");
  });

  it("unmarks when claude comes back to our own transcript", async () => {
    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: PICKED });

    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: ID, cwd: "/work" });

    expect(clearedTranscripts.has(ID)).toBe(false);
    // The header was the picked conversation's; it is read again from ours (#3347).
    expect(lastPrompts.get(ID)).toBe("continue GitHub issue 1048");
    expect(lastResponses.get(ID)).toBe("");
    expect(deps.forgetTitle).toHaveBeenCalledTimes(2);
  });

  // Two moves arriving together: the first one's read of the picked conversation must not land
  // after the second has brought the cell back, or the header shows a conversation it left.
  it("does not let an earlier move's header read land after a later move", async () => {
    let release = () => {};
    pickedRead.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const away = postHook({ hook_event_name: "SessionStart", source: "resume", session_id: PICKED, cwd: "/work" });
      const back = postHook({ hook_event_name: "SessionStart", source: "resume", session_id: ID, cwd: "/work" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();
      await Promise.all([away, back]);
    } finally {
      pickedRead.gate = Promise.resolve();
    }
    expect(clearedTranscripts.has(ID)).toBe(false);
    expect(lastPrompts.get(ID)).toBe("continue GitHub issue 1048");
  });

  it("does nothing when the hook names no usable id", async () => {
    await postHook({ hook_event_name: "SessionStart", source: "resume", session_id: "not-a-uuid" });
    expect(markCalls).toEqual([]);
    expect(clearedTranscripts.has(ID)).toBe(false);
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

  // After a move the cell is in the successor's conversation, so that is what seeds it (#3347).
  it("seeds a moved session from its successor's transcript", async () => {
    clearedTranscripts.add(ID);
    successors.set(ID, PICKED);
    await postHook({ hook_event_name: "UserPromptSubmit", prompt: "ok", cwd: "/work" });
    expect(lastPrompts.get(ID)).toBe(PICKED_PROMPT);
  });

  it("does not seed a cleared session — it takes the new prompt as-is", async () => {
    clearedTranscripts.add(ID);
    await postHook({ hook_event_name: "UserPromptSubmit", prompt: "ok", cwd: "/work" });
    expect(lastPrompts.get(ID)).toBe("ok");
  });
});
