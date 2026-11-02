// Display mapping for a cell's PR workflow phase — the label and tooltip the roster and the
// header chip put on screen. The phase VALUES live in common/prPhase.ts, which both sides read;
// this file used to redeclare them with a "keep them in sync" note, which is the drift the
// common/ rule exists to prevent.
export { isPrPhase, type PrPhase } from "../../common/prPhase";
import type { PrPhase } from "../../common/prPhase";
import { asSessionCollection, type SessionCollection } from "../../common/sessionCollection";
import type { AgentTitleKind } from "../../common/agentTitle";

const isAgentTitleKind = (value: unknown): value is AgentTitleKind => value === "opening-prompt" || value === "agent-summary";

// Short badge text + a fuller tooltip, as i18n KEYS rather than words (#2182). The words are in
// src/i18n/*.ts under `status.pr`; this file stays a pure lookup with no `t` in it, so it can go
// on being called from outside a component — `tipContent.ts` builds its tooltips there, where
// `useI18n()` is not available.
//
// Keys are written out per phase rather than derived as `status.pr.${phase}.label`, and that is
// the point: `Record<Exclude<PrPhase, "none">, …>` makes a new phase a COMPILE ERROR here, where
// a derived key would silently render the key path on screen instead (#1894).
//
// `none` (no PR yet) renders nothing — the roster just shows the agent status until a PR exists.
interface PhaseDisplay {
  /** The badge. Stays in GitHub's own vocabulary in every locale — see the note in i18n/en.ts. */
  label: string;
  /** Standalone wording, for a place that has not already said what it is talking about. */
  title: string;
  /** The same state where the PR is ALREADY named. Without it, a heading that begins `PR #2689`
   *  runs into a title that begins `PR —` and reads `PR #2689 · PR — CI running` (#1235). */
  state: string;
}
const DISPLAY: Record<Exclude<PrPhase, "none">, PhaseDisplay> = {
  draft: { label: "status.pr.draft.label", title: "status.pr.draft.title", state: "status.pr.draft.state" },
  "ci-failing": { label: "status.pr.ci-failing.label", title: "status.pr.ci-failing.title", state: "status.pr.ci-failing.state" },
  "changes-requested": {
    label: "status.pr.changes-requested.label",
    title: "status.pr.changes-requested.title",
    state: "status.pr.changes-requested.state",
  },
  "ci-running": { label: "status.pr.ci-running.label", title: "status.pr.ci-running.title", state: "status.pr.ci-running.state" },
  ready: { label: "status.pr.ready.label", title: "status.pr.ready.title", state: "status.pr.ready.state" },
  merged: { label: "status.pr.merged.label", title: "status.pr.merged.title", state: "status.pr.merged.state" },
  closed: { label: "status.pr.closed.label", title: "status.pr.closed.title", state: "status.pr.closed.state" },
};

/** The i18n keys for a phase, or null when there is no PR. The caller resolves them: this has to
 *  stay callable from outside a component. */
export const phaseDisplay = (phase: PrPhase): PhaseDisplay | null => (phase === "none" ? null : DISPLAY[phase]);

/** Resolves a key from `phaseDisplay` (or anything else here). `useI18n()`'s `t` satisfies it, and
 *  so does a stub in a spec, which is what keeps these callers testable without mounting. */
export type TranslateKey = (key: string) => string;

// The agent-side sub-phase of a "working" cell, mirroring server/session/activity/workPhase.ts. Refines
// the "running" status word into what the agent is actually doing right now.
export type WorkPhase = "planning" | "implementing";

export const isWorkPhase = (v: unknown): v is WorkPhase => v === "planning" || v === "implementing";

// i18n keys, per the note on DISPLAY above. "editing" reads clearer than "implementing" in the
// tiny roster badge, which is why the WORD differs from the phase name in every locale.
export const WORK_WORD: Record<WorkPhase, string> = { planning: "status.work.planning", implementing: "status.work.implementing" };

// What the roster shows for a session after a metadata fetch, given what it already showed.
//
// Three policies in one merge, and each is deliberate:
//
// The PROMPT and REPLY merge — an absent value keeps whatever is on screen. Both fall back to
// the transcript, which can transiently miss, and blanking every row on the first poll that
// comes up empty would strip the cockpit exactly when the user is scanning it to decide which
// of nine agents to look at. A session that HAS none sends "" (what `/clear` writes), and an
// empty string is a value — it merges through and clears the row.
//
// `aiTitle` has no transcript fallback: it is ours, held in memory, so a successful fetch
// answers it outright and `null` means "there is none now" rather than "no news". Merging it
// like the text is how a `/clear`ed session kept showing the title of the conversation the user
// had just ended (#1085) — the server had already dropped it. Same rule as applyActivityPush.
//
// `memo` follows aiTitle, not the text, and for the same reason: it lives only in the server's
// memo map, so a successful fetch answers it outright and `null` is the user having ERASED it.
// Merged like the prompt, a memo the user just cleared comes back on the next poll.
//
// `agentTitle` is taken AS-IS, with `aiTitle`, `workPhase` and `collection` — not merged with the
// text. The server memoizes it per RESOLVED CONVERSATION, so a successful fetch is authoritative;
// and merging it was wrong in the one case the resolved-conversation key exists for, a cell resumed
// onto another conversation under the same session id, where the old title outlived the switch.
//
// `workPhase` is taken AS-IS, including null, because a successful fetch is authoritative for
// it: null means "no tools yet / not working", which is a real state. Merge it like the text
// and a finished agent keeps a "planning" badge forever.
//
// `collection` follows workPhase for a different reason: it cannot change over a session's life,
// so every successful fetch for an id carries the same answer and there is nothing a merge could
// preserve. Taking it as-is is what lets a row stop wearing a mark when the cell changes session.
export interface SessionMetaView {
  lastPrompt: string | null;
  aiTitle: string | null;
  /** The name the person gave with Claude Code's `/rename`; null for every other agent and for a cleared session. */
  customTitle: string | null;
  /** What the other Claude Code sessions on this machine call this one (#3237); null for every other agent. */
  peerName: string | null;
  /** What the agent's OWN store calls this session — its history-list title (#2123). Null for
   *  claude, which has `aiTitle`, and for the agents whose store cannot answer it for one id. */
  agentTitle: string | null;
  /** Whether that title is the person's OPENING PROMPT or a summary the agent wrote for itself.
   *  The roster cannot tell from the string, and it decides whether a capped title may be read as a
   *  truncation of the prompt row. */
  agentTitleKind: AgentTitleKind | null;
  lastResponse: string | null;
  memo: string | null;
  workPhase: WorkPhase | null;
  collection: SessionCollection | null;
}

export const EMPTY_SESSION_META: SessionMetaView = {
  lastPrompt: null,
  aiTitle: null,
  customTitle: null,
  peerName: null,
  agentTitle: null,
  agentTitleKind: null,
  lastResponse: null,
  memo: null,
  workPhase: null,
  collection: null,
};

// `string | null` as it arrives in untrusted JSON. Anything else reads as ABSENT, so a field the
// server sent as a number leaves the previous value standing rather than replacing it with junk.
const stringOrNull = (value: unknown): string | null | undefined => (typeof value === "string" || value === null ? value : undefined);

// EVERY field arrives as untrusted JSON, so every one is decided by a check here. `workPhase` was
// already typed `unknown` for exactly that reason (isWorkPhase is the only thing that may call it
// a phase); the other four said `string | null` and were taken on trust from the same response.
export function mergeSessionMeta(previous: SessionMetaView, fetched: Record<string, unknown>): SessionMetaView {
  const aiTitle = stringOrNull(fetched.aiTitle);
  const customTitle = stringOrNull(fetched.customTitle);
  const peerName = stringOrNull(fetched.peerName);
  const agentTitle = stringOrNull(fetched.agentTitle);
  // Read once rather than inside the merge, so the "keep the previous" branch stays one decision.
  const fetchedKind = isAgentTitleKind(fetched.agentTitleKind) ? fetched.agentTitleKind : null;
  const memo = stringOrNull(fetched.memo);
  return {
    lastPrompt: stringOrNull(fetched.lastPrompt) ?? previous.lastPrompt,
    // An explicit null WINS; only an ABSENT field keeps what is shown. The same rule as `aiTitle`
    // and `memo`, and not the text's.
    //
    // It reads that way because the server memoizes this per resolved conversation, so a successful
    // fetch really is authoritative. Merged, it had a hole the resolved-conversation fix opened: a
    // cell RESUMED or relaunched onto another conversation keeps its session id, so this cache entry
    // survives, and `?? previous` left the PREVIOUS conversation's opening on the row when the new
    // one had not been titled yet (Codex, round 3). `null` here means "that agent's store has
    // nothing for this session", which is a real state and the one a remap produces.
    agentTitle: agentTitle !== undefined ? agentTitle : previous.agentTitle,
    // Travels with the value it describes, so a kept title keeps its kind and a replaced one is
    // never read under the previous title's provenance.
    agentTitleKind: agentTitle !== undefined ? fetchedKind : previous.agentTitleKind,
    aiTitle: aiTitle !== undefined ? aiTitle : previous.aiTitle,
    // An explicit null wins (a cleared name, a cleared session); only an absent field keeps it.
    customTitle: customTitle !== undefined ? customTitle : previous.customTitle,
    peerName: peerName !== undefined ? peerName : previous.peerName,
    lastResponse: stringOrNull(fetched.lastResponse) ?? previous.lastResponse,
    memo: memo !== undefined ? memo : previous.memo,
    workPhase: isWorkPhase(fetched.workPhase) ? fetched.workPhase : null,
    collection: asSessionCollection(fetched.collection),
  };
}

/** Whether a phase poll just crossed INTO CI failure. Only the transition is news: the poll
 *  repeats while the roster is open, so a branch that STAYS red must not notify on every
 *  round, and a roster opened on an already-failing branch has not just learned anything. */
export function becameCiFailing(previous: PrPhase | undefined, next: PrPhase): boolean {
  return previous !== undefined && previous !== "ci-failing" && next === "ci-failing";
}
