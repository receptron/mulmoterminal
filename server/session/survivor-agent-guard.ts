// Whether a surviving tmux session may be served to the endpoint asking for it (#1537).
//
// A same-process reattach is guarded by wrongEndpointReason, which compares the endpoint
// against the live PtyEntry's agent. After a server restart there is no entry to compare:
// `ptys` is empty while tmux still holds `mt-<session>`, the resolvers keep the requested id
// on tmux liveness alone, and `tmux new-session -A` attaches whatever runs in the pane while
// IGNORING the argv the endpoint's spawner built. The recreated PtyEntry then records the
// ENDPOINT's agent — so stale or coerced persisted grid state (asTerminalAgent reads any
// unrecognised value as "claude") could relabel a surviving codex as claude, and every later
// same-process guard would trust the wrong label.
//
// The rule here is refuse-on-proof, attach-on-silence. What a session belongs to is only
// knowable from the durable evidence an agent left under the session's own key — a claude
// transcript, a codex rollout mapping (or the key being a rollout id), agy's and muse's
// conversation maps, a grok conversation named by the key. A launcher/shell survivor leaves
// none of those, and neither does an agent session that never reached its first turn.
// Refusing the unknowable would shut users out of legitimately surviving sessions — a worse
// failure than the mislabel — so no evidence (or contradictory evidence) attaches as
// requested. That blind spot is accepted, not overlooked.

import { TERMINAL_AGENTS, type TerminalAgent } from "../../common/sessionAgent.js";
import type { TerminalWsKind } from "../routes/terminal-ws-path.js";
import { claudeOnDiskSessionIds } from "./session-reads.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { codexRolloutExists } from "../agents/codex-sessions.js";
import { antigravityBrainRoot, antigravityConversationExists } from "../agents/antigravity-session.js";
import { grokConversationExistsInAnyCwd, grokSessionsRoot } from "../agents/grok-session.js";
import { copilotSessionExists } from "../agents/copilot-sessions.js";
import { cursorSessionExists } from "../agents/cursor-sessions.js";
import { ptyWouldReattach } from "./pty-spawn.js";
import {
  antigravityConversations,
  antigravityConversationsHydrated,
  codexRollouts,
  codexRolloutsHydrated,
  museConversations,
  museConversationsHydrated,
} from "./registry.js";

/** Who left durable evidence under a session key, as one predicate per agent. */
export type SurvivorEvidence = Record<TerminalAgent, (id: string) => boolean>;

/** The agents with evidence for this key. More than one is contradictory — ids are minted
 *  UUIDs, so two agents claiming one key means the evidence itself is off, and the caller
 *  treats it as silence rather than picking a side. */
export function survivorAgents(id: string, evidence: SurvivorEvidence): TerminalAgent[] {
  return TERMINAL_AGENTS.filter((agent) => evidence[agent](id));
}

/** The refusal, or null to attach. Only single, unambiguous evidence refuses; the wording
 *  matches wrongEndpointReason's so the two guards read as one rule from the browser. */
export function foreignSurvivorReason(endpoint: TerminalWsKind, agents: readonly TerminalAgent[]): string | null {
  // The run endpoint is ephemeral and owns no sessions; a launcher's survivors are shells
  // and command lines, for which no evidence exists — its mismatches are exactly the
  // provable ones (an agent's own key opened as a chip).
  if (endpoint === "run") return null;
  if (agents.length !== 1) return null;
  const survivor = agents[0];
  if (survivor === endpoint) return null;
  return `Session belongs to ${survivor}, not ${endpoint}`;
}

// The real evidence, awaited once per ask: the maps hydrate from disk at boot, and a
// reconnect racing that read would see empty maps and wave a provable mismatch through —
// the same wait the codex and antigravity connect paths already take before resolving.
async function survivorEvidence(): Promise<SurvivorEvidence> {
  await Promise.all([codexRolloutsHydrated, antigravityConversationsHydrated, museConversationsHydrated]);
  const claudeOnDisk = claudeOnDiskSessionIds();
  return {
    claude: (id) => claudeOnDisk.has(id),
    // The mapping covers a cell-minted key; the direct probe covers a sidebar resume,
    // where the key IS the rollout id and the mapping may not have been written yet.
    codex: (id) => codexRollouts.has(id) || codexRolloutExists(codexSessionsRoot(), id),
    antigravity: (id) => antigravityConversations.has(id) || antigravityConversationExists(antigravityBrainRoot(), id),
    // grok takes `--session-id`, so the key is grok's own conversation id — no mapping exists.
    // Probed across every cwd partition: the request's cwd is untrustworthy on this path.
    grok: (id) => grokConversationExistsInAnyCwd(grokSessionsRoot(), id),
    muse: (id) => museConversations.has(id),
    // copilot takes `--session-id`, so the key is copilot's own id and no mapping exists — the
    // same shape as grok. A directory test rather than a store query: the guard runs once per
    // reconnect burst, and `session-state/<id>/` appears as soon as the session does.
    copilot: (id) => copilotSessionExists(id),
    // cursor takes `--resume <uuid>` with an id of ours, so the key is cursor's own chat id and no
    // mapping exists — the same shape as grok and copilot. Probed across every project partition:
    // the request's cwd is untrustworthy on this path, as it is for grok.
    cursor: (id) => cursorSessionExists(id),
  };
}

// One snapshot per reconnect burst, not per socket. After a restart every surviving cell
// reconnects within moments, `sessionConnects` serializes only EQUAL ids, and the claude
// evidence is a synchronous walk of every project directory — repeated per cell it blocks
// the event loop exactly when every terminal is trying to come back (Codex review on
// #1541). Staleness within the window only fails OPEN: evidence appearing mid-burst reads
// as silence, which attaches as requested — the same answer no-evidence gives. It never
// manufactures a refusal, and the tmux recheck below owns the pane-died race.
const EVIDENCE_SNAPSHOT_MS = 5000;
let snapshot: { at: number; evidence: Promise<SurvivorEvidence> } | null = null;
function sharedSurvivorEvidence(): Promise<SurvivorEvidence> {
  const now = Date.now();
  if (!snapshot || now - snapshot.at > EVIDENCE_SNAPSHOT_MS) snapshot = { at: now, evidence: survivorEvidence() };
  return snapshot.evidence;
}

/** The refusal for a connect that would attach a surviving tmux session, or null to proceed.
 *  Asked only when there is no live entry (wrongEndpointReason owns that case); asks tmux
 *  itself so a session that died since resolve is a plain spawn, not a refusal. */
export async function foreignTmuxSurvivorReason(endpoint: TerminalWsKind, sessionId: string): Promise<string | null> {
  if (endpoint === "run" || !ptyWouldReattach(sessionId, true)) return null;
  const reason = foreignSurvivorReason(endpoint, survivorAgents(sessionId, await sharedSurvivorEvidence()));
  // Re-asked AFTER the evidence await: the pane can exit while the disk is read, and then
  // there is no survivor left to protect — the refusal is terminal to the client, so issuing
  // it on old transcript data would permanently refuse a request that should fall through to
  // a fresh spawn (Codex review on #1541). Only a still-live pane is worth refusing over.
  return reason && ptyWouldReattach(sessionId, true) ? reason : null;
}
