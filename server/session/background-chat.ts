// What a spawnBackgroundChat request asks for. Split from the route (#548) because the
// two rules below are policy, not plumbing, and the route is otherwise just a uuid, a
// spawn and a response.
//
// The agent tool calls this, so the body is whatever a model produced — every field is
// treated as absent unless it is exactly what we accept.
import { asTerminalAgent, type TerminalAgent } from "../../common/sessionAgent.js";

export interface BackgroundChatRequest {
  agent: TerminalAgent;
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
      // Anything unrecognised is claude, the default — the same rule the UI's remembered
      // toggle reads by, so a model naming an agent we don't host gets a session rather
      // than an error about a field it half-guessed.
      agent: asTerminalAgent(record.agent),
      draft: record.draft === true,
      hidden: record.hidden === true,
      message,
    },
  };
}

export type SpawnMode = "claude-draft" | "claude-run" | "codex-run" | "antigravity-run";

/** How the seed reaches the agent. Only claude has an editable-draft path — the others have no
 *  stable TUI ready-marker to type against — so their seed always auto-runs, and asking for a
 *  draft there gets a run rather than nothing.
 *
 *  A Record over the agents, so hosting a new one fails to compile here rather than falling
 *  through to a claude spawn under its name. */
const RUN_MODE: Record<TerminalAgent, SpawnMode> = {
  claude: "claude-run",
  codex: "codex-run",
  antigravity: "antigravity-run",
};

export function spawnModeFor(agent: TerminalAgent, draft: boolean): SpawnMode {
  return agent === "claude" && draft ? "claude-draft" : RUN_MODE[agent];
}

/** What the agent tool is told it did. The wording differs because the outcomes differ:
 *  a draft waits for the user, a run is already working. */
export function backgroundChatMessage(agent: TerminalAgent, draft: boolean, sessionId: string): string {
  if (agent !== "claude") return `Spawned a new ${agent} session (chatId ${sessionId}) auto-running the prompt.`;
  if (draft) return `Opened a new terminal session (chatId ${sessionId}) with the text prefilled in the input for the user to review and send.`;
  return `Spawned a new terminal session (chatId ${sessionId}). It runs in parallel; the user can open it from the sidebar.`;
}
