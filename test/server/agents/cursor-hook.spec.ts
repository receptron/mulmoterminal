// @vitest-environment node
// Translating cursor's hook vocabulary into claude's. The absences are the point of most of these:
// cursor exposes several events that LOOK like the ones this app wants and are not.
import { describe, it, expect } from "vitest";
import { cursorHookBody, CURSOR_HOOK_EVENTS } from "../../../server/agents/cursor-hook.js";

const ID = "4078f9a6-4ce0-4906-a544-ca0cf917eb96";
const base = { conversation_id: ID, workspace_roots: ["/w"], hook_event_name: "stop" };

describe("cursorHookBody", () => {
  it("maps a submitted prompt to claude's UserPromptSubmit, which is what drives 'working'", () => {
    const body = cursorHookBody("beforeSubmitPrompt", { ...base, prompt: "hello" });
    expect(body).toMatchObject({ hook_event_name: "UserPromptSubmit", session_id: ID, prompt: "hello" });
  });

  it("maps the turn's end to Stop, which is what drives 'waiting' and the attention sound", () => {
    expect(cursorHookBody("stop", { ...base, status: "completed" })?.hook_event_name).toBe("Stop");
  });

  it("renames cursor's tool_output to the tool_response spelling the tool history reads", () => {
    const body = cursorHookBody("postToolUse", { ...base, tool_name: "Shell", tool_input: { command: "ls" }, tool_output: "a\nb" });
    expect(body).toMatchObject({ hook_event_name: "PostToolUse", tool_name: "Shell", tool_response: "a\nb" });
    expect(body?.tool_input).toEqual({ command: "ls" });
  });

  it("falls back to workspace_roots for the cwd, which stop and beforeSubmitPrompt carry instead", () => {
    expect(cursorHookBody("stop", base)?.cwd).toBe("/w");
    expect(cursorHookBody("preToolUse", { ...base, cwd: "/elsewhere" })?.cwd).toBe("/elsewhere");
  });

  it("drops a payload with no conversation_id — it cannot be attributed to any session", () => {
    expect(cursorHookBody("stop", { workspace_roots: ["/w"] })).toBeNull();
  });

  it("drops an event it does not translate, rather than inventing a claude name for it", () => {
    expect(cursorHookBody("afterAgentThought", base)).toBeNull();
    expect(cursorHookBody(undefined, base)).toBeNull();
  });

  it("does NOT translate beforeShellExecution — it fires whether or not anyone is being asked", () => {
    // Measured while the agent sat on 'Waiting for approval...': this had already fired, and it
    // fires on every shell call. Mapping it to Notification would flag every tool call as blocked.
    expect(cursorHookBody("beforeShellExecution", { ...base, command: "rm -rf /" })).toBeNull();
    expect(CURSOR_HOOK_EVENTS).not.toContain("beforeShellExecution");
  });

  it("does NOT translate afterAgentResponse — stop already ends the turn, and both would move the cell twice", () => {
    expect(cursorHookBody("afterAgentResponse", { ...base, text: "done" })).toBeNull();
  });

  it("registers only events the CLI actually knows — an unknown name voids the whole hooks file", () => {
    // The list cursor documents as CLI-supported. Anything outside it silently discards every other
    // entry in ~/.cursor/hooks.json, so this is the guard that keeps a typo from removing status.
    const known = new Set([
      "preToolUse",
      "postToolUse",
      "postToolUseFailure",
      "subagentStart",
      "subagentStop",
      "beforeShellExecution",
      "afterShellExecution",
      "afterMCPExecution",
      "beforeReadFile",
      "afterFileEdit",
      "beforeSubmitPrompt",
      "preCompact",
      "afterAgentResponse",
      "afterAgentThought",
      "stop",
    ]);
    for (const event of CURSOR_HOOK_EVENTS) expect(known).toContain(event);
  });
});
