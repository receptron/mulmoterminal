// Display mapping for a cell's PR workflow phase — the label and tooltip the roster and the
// header chip put on screen. The phase VALUES live in common/prPhase.ts, which both sides read;
// this file used to redeclare them with a "keep them in sync" note, which is the drift the
// common/ rule exists to prevent.
export { isPrPhase, type PrPhase } from "../../common/prPhase";
import type { PrPhase } from "../../common/prPhase";

// Short badge text + a fuller tooltip. `none` (no PR yet) renders nothing — the roster just
// shows the agent status until a PR exists.
interface PhaseDisplay {
  label: string;
  title: string;
}
const DISPLAY: Record<Exclude<PrPhase, "none">, PhaseDisplay> = {
  draft: { label: "draft", title: "Draft PR" },
  "ci-failing": { label: "CI fail", title: "PR — CI failing" },
  "changes-requested": { label: "changes", title: "PR — changes requested" },
  "ci-running": { label: "CI…", title: "PR — CI running" },
  ready: { label: "ready", title: "PR ready to merge" },
  merged: { label: "merged", title: "PR merged" },
  closed: { label: "closed", title: "PR closed" },
};

export const phaseDisplay = (phase: PrPhase): PhaseDisplay | null => (phase === "none" ? null : DISPLAY[phase]);

// The agent-side sub-phase of a "working" cell, mirroring server/session/workPhase.ts. Refines
// the "running" status word into what the agent is actually doing right now.
export type WorkPhase = "planning" | "implementing";

export const isWorkPhase = (v: unknown): v is WorkPhase => v === "planning" || v === "implementing";

// "editing" reads clearer than "implementing" in the tiny roster badge.
export const WORK_WORD: Record<WorkPhase, string> = { planning: "planning", implementing: "editing" };

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
// `workPhase` is taken AS-IS, including null, because a successful fetch is authoritative for
// it: null means "no tools yet / not working", which is a real state. Merge it like the text
// and a finished agent keeps a "planning" badge forever.
export interface SessionMetaView {
  lastPrompt: string | null;
  aiTitle: string | null;
  lastResponse: string | null;
  workPhase: WorkPhase | null;
}

export const EMPTY_SESSION_META: SessionMetaView = { lastPrompt: null, aiTitle: null, lastResponse: null, workPhase: null };

// `workPhase` is typed unknown because it arrives as untrusted JSON — isWorkPhase is the
// only thing that may decide it is a phase.
export function mergeSessionMeta(previous: SessionMetaView, fetched: Omit<Partial<SessionMetaView>, "workPhase"> & { workPhase?: unknown }): SessionMetaView {
  return {
    lastPrompt: fetched.lastPrompt ?? previous.lastPrompt,
    aiTitle: fetched.aiTitle !== undefined ? fetched.aiTitle : previous.aiTitle,
    lastResponse: fetched.lastResponse ?? previous.lastResponse,
    workPhase: isWorkPhase(fetched.workPhase) ? fetched.workPhase : null,
  };
}

/** Whether a phase poll just crossed INTO CI failure. Only the transition is news: the poll
 *  repeats while the roster is open, so a branch that STAYS red must not notify on every
 *  round, and a roster opened on an already-failing branch has not just learned anything. */
export function becameCiFailing(previous: PrPhase | undefined, next: PrPhase): boolean {
  return previous !== undefined && previous !== "ci-failing" && next === "ci-failing";
}
