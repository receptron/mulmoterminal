// What ONE cockpit roster row shows, assembled from the four things the grid keeps per cell.
//
// Out of GridView for the reason `rosterAgent` next door is: this is a pure data transformation
// over state the component happens to hold, and a row that says the wrong thing is invisible in a
// component test but obvious in a table of inputs and outputs.
//
// The four lookups are passed rather than imported because each is a DIFFERENT key: the meta is
// per session, the chrome and the phase are per directory (cells sharing a directory share one
// fetch), and the status is per cell. Handing them in as functions is what lets this stay pure
// while the caller keeps its reactive maps.
import { AGENT_TITLE_MAX, type AgentTitleKind } from "../../common/agentTitle";
import { sessionDisplayName } from "../../common/sessionMemo";
import type { Cell } from "./gridTabs";
import type { CockpitRow } from "./TerminalGrid.vue";
import type { AttentionStatus } from "./attentionStatus";
import { rosterAgent } from "./rosterAgent";
import { EMPTY_SESSION_META, type PrPhase, type SessionMetaView } from "./rosterPhase";

/** The directory's own look, as the roster row and the filmstrip thumbnail both wear it. */
export interface RowChrome {
  headerColor: string | null;
  headerTextColor: string | null;
  iconUrl: string | null;
}

// "Nothing known yet" is resolved ONCE per lookup rather than per field. Five of the row's fields
// come out of the meta and three out of the chrome, so a `??` on each both crossed the complexity
// limit and made every field independently defaultable — which is how a field the roster never
// wired up reads as a legitimate null rather than failing to typecheck.
const NO_CHROME: RowChrome = { headerColor: null, headerTextColor: null, iconUrl: null };
const NO_PR_PHASE: PrPhase = "none";
const NO_STATUS: AttentionStatus = "idle";

export interface RosterLookups {
  meta: (session: string) => SessionMetaView | undefined;
  chrome: (cwd: string) => RowChrome | undefined;
  phase: (cwd: string) => PrPhase | undefined;
  status: (uid: number) => AttentionStatus | undefined;
}

/** A cell with no session/prompt yet still gets a human label from what it IS running. */
export const fallbackLabel = (c: Cell): string | null => c.command?.label ?? c.launcher?.label ?? (c.session ? "starting…" : "empty");

/** May the summary row be suppressed — stated as what is PERMITTED, not as shapes to exclude.
 *
 *  This rule has now drawn three findings in one review loop (a reverse-prefix match, a shorter
 *  opening that shared a beginning, and a capped title read as a truncation it was not). Each fix
 *  banned one more shape, which is the pattern that never ends: there is always another way for two
 *  strings to look alike. So it is inverted. Exactly two cases may be suppressed, and everything
 *  else shows:
 *
 *    1. The summary IS the prompt — the same text once whitespace is collapsed. A one-turn cell,
 *       which is the state a freshly started cell sits in while it answers, and the case this
 *       whole rule exists for.
 *    2. The summary is OUR OWN truncation of the prompt — it starts it, is exactly
 *       `AGENT_TITLE_MAX` long, and came from an agent whose label IS the opening prompt. The last
 *       clause is the one round 5 found missing: copilot's and muse's titles are written by the
 *       agent, so a 200-character one that happens to begin the prompt is an independent sentence,
 *       not a cut-off copy.
 *
 *  It deliberately shows some rows that ARE near-duplicates — a paraphrase, a prompt that merely
 *  begins the same way — because that costs a line of chrome, where the other direction costs the
 *  reader a fact the row exists to carry. Claude's `aiTitle` never reaches here at all: it is a
 *  summary rather than a quote of the prompt. */
const mayBeSuppressed = (summary: string, prompt: string | null, kind: AgentTitleKind | null): boolean => {
  const flat = (text: string): string => text.replace(/\s+/g, " ").trim();
  const [shown, promptRow] = [flat(summary), flat(prompt ?? "")];
  if (shown === "" || promptRow === "" || !promptRow.startsWith(shown)) return false;
  if (shown.length === promptRow.length) return true; // case 1: the same text
  // `===`, not `>=`: the rule says "exactly the cap", because that is the only length our own cut
  // produces. `>=` said something the invariant does not, and it failed the wrong way — a title
  // LONGER than the cap could only come from somewhere we do not control, and the safe answer for
  // anything we cannot account for is to show it (Codex, round 5 follow-up).
  return kind === "opening-prompt" && shown.length === AGENT_TITLE_MAX; // case 2: our own cut
};

/** The store label, unless it may be suppressed. */
const agentSummary = (agentTitle: string | null, prompt: string | null, kind: AgentTitleKind | null): string | null =>
  agentTitle !== null && mayBeSuppressed(agentTitle, prompt, kind) ? null : agentTitle;

export function rosterRow(c: Cell, look: RosterLookups): CockpitRow {
  const meta = (c.session ? look.meta(c.session) : undefined) ?? EMPTY_SESSION_META;
  const chrome = (c.cwd ? look.chrome(c.cwd) : undefined) ?? NO_CHROME;
  return {
    uid: c.uid,
    cwd: c.cwd,
    agent: rosterAgent(c),
    status: look.status(c.uid) ?? NO_STATUS,
    memo: meta.memo,
    peerName: meta.peerName,
    // Claude's AI title first, then what the agent's own store calls the session (#2123). The two
    // answer the same question — on the default title source claude's is written ONCE and never
    // updated, so that row is already "what this session was about near its beginning", which is
    // what the other agents' opening prompt is. `aiTitle` is null for every non-claude agent and
    // `agentTitle` is null for claude, so the `??` is a merge of two disjoint sources, not a
    // preference between two answers for the same cell.
    summary: meta.customTitle ?? meta.aiTitle ?? agentSummary(meta.agentTitle, meta.lastPrompt, meta.agentTitleKind),
    prompt: meta.lastPrompt,
    response: meta.lastResponse,
    fallback: fallbackLabel(c),
    // The cell header's tiers (cellHeaderText), so a compact row and its cell go by one name — which
    // is why the agent-store title the summary line admits is not among them.
    title: sessionDisplayName(meta.memo, meta.customTitle, meta.aiTitle, meta.lastPrompt) || (fallbackLabel(c) ?? ""),
    phase: (c.cwd ? look.phase(c.cwd) : undefined) ?? NO_PR_PHASE,
    workPhase: meta.workPhase,
    collection: meta.collection,
    headerColor: chrome.headerColor,
    headerTextColor: chrome.headerTextColor,
    iconUrl: chrome.iconUrl,
    parked: c.parked === true,
    parkable: isTerminalCell(c),
    markable: isTerminalCell(c) && !!c.session,
  };
}

// A TerminalCell rather than a command or launcher one — the same split TerminalGrid renders by.
const isTerminalCell = (c: Cell): boolean => !c.command && !c.launcher;
