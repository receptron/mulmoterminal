// What a spawnBackgroundChat request asks for. Split from the route (#548) because the
// two rules below are policy, not plumbing, and the route is otherwise just a uuid, a
// spawn and a response.
//
// The agent tool calls this, so the body is whatever a model produced — every field is
// treated as absent unless it is exactly what we accept.

export interface BackgroundChatRequest {
  agent: "claude" | "codex";
  /** Type the text into the input box for the user to review, instead of running it. */
  draft: boolean;
  /** Keep the session out of the sidebar. */
  hidden: boolean;
  message: string;
}

/** The request, or the message to answer with when it cannot be served. */
export function parseBackgroundChat(body: unknown): { ok: true; request: BackgroundChatRequest } | { ok: false; message: string } {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (!message) return { ok: false, message: "spawnBackgroundChat: `message` is required (non-empty string)." };
  return {
    ok: true,
    request: {
      agent: record.agent === "codex" ? "codex" : "claude",
      draft: record.draft === true,
      hidden: record.hidden === true,
      message,
    },
  };
}

/** How the seed reaches the agent. codex has no editable-draft path — no stable TUI
 *  ready-marker to type against — so its seed always auto-runs, and asking for a codex
 *  draft gets a run rather than nothing. */
export function spawnModeFor(agent: "claude" | "codex", draft: boolean): "codex-run" | "claude-draft" | "claude-run" {
  if (agent === "codex") return "codex-run";
  return draft ? "claude-draft" : "claude-run";
}

/** What the agent tool is told it did. The wording differs because the outcomes differ:
 *  a draft waits for the user, a run is already working. */
export function backgroundChatMessage(agent: "claude" | "codex", draft: boolean, sessionId: string): string {
  if (agent === "codex") return `Spawned a new codex session (chatId ${sessionId}) auto-running the prompt.`;
  if (draft) return `Opened a new terminal session (chatId ${sessionId}) with the text prefilled in the input for the user to review and send.`;
  return `Spawned a new terminal session (chatId ${sessionId}). It runs in parallel; the user can open it from the sidebar.`;
}
