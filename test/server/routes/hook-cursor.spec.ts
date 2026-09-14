// @vitest-environment node
// The cursor branch of /api/hook, pinned at the ROUTE rather than at the translation.
//
// cursor-hook.spec.ts proves the renaming; this proves the renaming is WIRED — that a cursor
// payload reaches the same effect table claude's hooks reach, and that neither claude nor copilot
// is changed by a third branch standing in front of them. Every claude hook in the product posts to
// this endpoint, so "does this branch cost the others anything" is the question a unit test of a
// pure function cannot answer.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountHookRoute } from "../../../server/routes/hook-routes";
import { lastPrompts, ptys } from "../../../server/session/registry";
import { cursorBadges, forgetCursorBadges } from "../../../server/agents/cursor-usage";

// `sessionLastTurn` is reached only once a test gives the session a LIVE pty (the finished-task
// push asks the agent for its last reply), which the token-count tests below are the first to do.
vi.mock("../../../server/session/session-reads.js", () => ({
  latestUserPrompt: vi.fn(async () => null),
  sessionLastTurn: vi.fn(async () => ({ prompt: null, reply: null })),
}));

const ID = "4078f9a6-4ce0-4906-a544-ca0cf917eb96";
const CWD = "/tmp/probe";

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

/** A cursor hook exactly as the file we write produces one: the event in a header, the session in
 *  the body as `conversation_id`, and no `x-mt-session` (the hook file is machine-global, so there
 *  is nothing per-session to bake into it). */
const postCursor = async (hook: string, payload: Record<string, unknown>) => {
  const res = await call("/api/hook", jsonPost(payload, { "x-mt-agent": "cursor", "x-mt-hook": hook }));
  expect(res.status).toBe(200);
  return res;
};

beforeEach(() => {
  lastPrompts.delete(ID);
  ptys.delete(ID);
  forgetCursorBadges(ID);
  vi.clearAllMocks();
});

/** A live pty for ID, as the hook route finds for a session THIS server started. Only the fields
 *  the route reads; the rest of PtyEntry is irrelevant to it. */
const liveCell = () => {
  const entry = { term: { pid: 1 }, ws: null, buffer: "", cwd: CWD, tmux: true, active: false, agent: "cursor" };
  ptys.set(ID, entry as unknown as NonNullable<ReturnType<typeof ptys.get>>);
};

describe("/api/hook with x-mt-agent: cursor", () => {
  it("turns stop into the Stop effects — finished, and flagged for attention", async () => {
    await postCursor("stop", { conversation_id: ID, workspace_roots: [CWD], status: "completed", loop_count: 0 });
    expect(deps.setWorking).toHaveBeenCalledWith(ID, false, "Stop");
    expect(deps.setWaiting).toHaveBeenCalledWith(ID, true, "Stop");
  });

  it("turns beforeSubmitPrompt into working, and keeps the prompt for the header", async () => {
    await postCursor("beforeSubmitPrompt", { conversation_id: ID, workspace_roots: [CWD], prompt: "Reply with just the word pong." });
    expect(deps.setWorking).toHaveBeenCalledWith(ID, true, "UserPromptSubmit");
    expect(lastPrompts.get(ID)).toContain("pong");
  });

  it("records a tool call from cursor's own field names", async () => {
    await postCursor("preToolUse", { conversation_id: ID, cwd: CWD, tool_name: "Shell", tool_input: { command: "ls" }, tool_use_id: "t1" });
    expect(deps.recordToolCallStart).toHaveBeenCalledWith(ID, expect.objectContaining({ toolName: "Shell" }));

    await postCursor("postToolUse", { conversation_id: ID, cwd: CWD, tool_name: "Shell", tool_input: { command: "ls" }, tool_output: "a\nb" });
    expect(deps.recordToolCallEnd).toHaveBeenCalledWith(ID, expect.objectContaining({ toolName: "Shell", status: "completed" }));
  });

  it("does NOTHING for beforeShellExecution — it fires on every shell call, not only when blocked", async () => {
    await postCursor("beforeShellExecution", { conversation_id: ID, cwd: CWD, command: "rm -rf /tmp/x" });
    expect(deps.setWaiting).not.toHaveBeenCalled();
    expect(deps.setWorking).not.toHaveBeenCalled();
  });

  it("answers 200 and does nothing for an event it cannot translate, or a payload with no conversation", async () => {
    await postCursor("somethingCursorAddedLater", { conversation_id: ID, cwd: CWD });
    await postCursor("stop", { workspace_roots: [CWD] });
    expect(deps.setWorking).not.toHaveBeenCalled();
    expect(deps.setWaiting).not.toHaveBeenCalled();
  });
});

describe("the token counts on `stop`", () => {
  const STOP = { conversation_id: ID, model: "default", input_tokens: 1200, output_tokens: 34, cache_read_tokens: 7, cache_write_tokens: 0 };

  it("records them for a session this server is running", async () => {
    liveCell();
    await postCursor("stop", STOP);
    expect(cursorBadges(ID).usage).toMatchObject({ inputTokens: 1200, outputTokens: 34, cacheReadTokens: 7 });
  });

  // The hook file is machine-global, so a cursor the user started in their own terminal posts here
  // too. Its id has no pty and `reap` returns before it could ever forget one — so recording it
  // would leak an entry per foreign session, for the life of the process (CodeRabbit on #2071).
  it("records NOTHING for a cursor session this server does not own", async () => {
    await postCursor("stop", STOP);
    expect(cursorBadges(ID).usage.inputTokens).toBe(0);
  });
});

describe("the cursor branch costs the other agents nothing", () => {
  it("still applies Stop to an ordinary claude hook with no agent header", async () => {
    const res = await call("/api/hook", jsonPost({ hook_event_name: "Stop", session_id: ID, cwd: CWD }, { "x-mt-session": ID }));
    expect(res.status).toBe(200);
    expect(deps.setWorking).toHaveBeenCalledWith(ID, false, "Stop");
    expect(deps.setWaiting).toHaveBeenCalledWith(ID, true, "Stop");
  });

  it("still translates a COPILOT hook, which now shares the branch with cursor", async () => {
    const res = await call("/api/hook", jsonPost({ sessionId: ID, cwd: CWD }, { "x-mt-agent": "copilot", "x-mt-hook": "agentStop" }));
    expect(res.status).toBe(200);
    expect(deps.setWaiting).toHaveBeenCalledWith(ID, true, "Stop");
  });

  it("does not take the cursor path on the JOINED value a repeated agent header produces", async () => {
    const res = await call("/api/hook", jsonPost({ conversation_id: ID, cwd: CWD }, { "x-mt-agent": "cursor, cursor", "x-mt-hook": "stop" }));
    expect(res.status).toBe(200);
    expect(deps.setWorking).not.toHaveBeenCalled();
    expect(deps.setWaiting).not.toHaveBeenCalled();
  });
});

describe("the translation table is indexed with an attacker-controlled header", () => {
  // `x-mt-agent` comes from the request. A plain object answers `__proto__` with `Object.prototype`
  // — truthy, then called as a function, then a 500 — which is the hazard `terminal-ws-path.ts`
  // already documents for its own lookup. A Map has no prototype chain to walk into (Codex round
  // 15 of #2065).
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])("does not 500 and does not reach a translator for x-mt-agent: %s", async (agent) => {
    const res = await call("/api/hook", jsonPost({ hook_event_name: "Stop", session_id: ID, cwd: CWD }, { "x-mt-agent": agent, "x-mt-hook": "stop" }));
    expect(res.status).toBe(200);
    // It falls through to the CLAUDE path, and this body is a valid claude Stop, so the Stop
    // effects DO run — "changes nothing" would be a false name for this test. What it pins is
    // that no translator was selected: a translated body would have needed `conversation_id`
    // (cursor) or `sessionId` (copilot), neither of which is here, and would have been dropped.
    expect(deps.setWaiting).toHaveBeenCalledWith(ID, true, "Stop");
    expect(deps.recordToolCallStart).not.toHaveBeenCalled();
  });
});
