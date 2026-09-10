// What a spawnBackgroundChat request asks for. Split from the route (#548) because the
// two rules below are policy, not plumbing, and the route is otherwise just a uuid, a
// spawn and a response.
//
// The agent tool calls this, so the body is whatever a model produced — every field is
// treated as absent unless it is exactly what we accept.
import { asTerminalAgent, type TerminalAgent } from "../../common/sessionAgent.js";
import { isRecord } from "../../common/isRecord.js";
import { isSafeSlug } from "@mulmoclaude/core/collection";

export interface BackgroundChatRequest {
  agent: TerminalAgent;
  /** Type the text into the input box for the user to review, instead of running it. */
  draft: boolean;
  /** Keep the session out of the sidebar. */
  hidden: boolean;
  message: string;
  /** The project the chat belongs to, as the opaque id the collection surface uses, or null for
   *  the shared workspace.
   *
   *  A collection action seeds its prompt with THAT collection's `<collection_paths>`, so a chat
   *  spawned in the workspace for a project's collection is handed paths for a directory it is
   *  not standing in — which reads as a broken template rather than as a wrong cwd. The id is
   *  resolved against the server's own list of known directories; it is never a path. */
  project: string | null;
  /** The collection this chat was started FROM, as its slug, or null when it was not started from
   *  one (#2020). A NAME, never display text: the server resolves it against the collections the
   *  project actually has, and what a cell wears comes from that resolution rather than from
   *  anything the caller sent. A slug naming nothing is therefore harmless — it records nothing. */
  collection: string | null;
}

/** The request, or the message to answer with when it cannot be served. */
export function parseBackgroundChat(body: unknown): { ok: true; request: BackgroundChatRequest } | { ok: false; message: string } {
  const record: Record<string, unknown> = isRecord(body) ? body : {};
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
      project: typeof record.project === "string" && record.project.length > 0 ? record.project : null,
      // Shape only. Whether it names a real collection is the resolver's question, and it has to
      // be — the answer depends on the project the spawn lands in, which is decided after this.
      collection: typeof record.collection === "string" && isSafeSlug(record.collection) ? record.collection : null,
    },
  };
}

export type SpawnMode = "claude-draft" | "claude-run" | "codex-run" | "antigravity-run" | "grok-run" | "muse-run";

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
  grok: "grok-run",
  muse: "muse-run",
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
