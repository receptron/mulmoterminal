// Display mapping for a cell's PR workflow phase in the cockpit roster. The phase values
// mirror server/git/prPhase.ts's PrPhase (the /api/pr-phase response) — keep them in sync.
export type PrPhase = "none" | "draft" | "ci-failing" | "changes-requested" | "ci-running" | "ready" | "merged" | "closed";

export const isPrPhase = (v: unknown): v is PrPhase =>
  v === "none" || v === "draft" || v === "ci-failing" || v === "changes-requested" || v === "ci-running" || v === "ready" || v === "merged" || v === "closed";

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
// Two opposite policies in one merge, and both are deliberate:
//
// The TEXT fields merge — an absent value keeps whatever is on screen. The summary can
// transiently miss a transcript, and blanking every row on the first poll that comes up
// empty would strip the cockpit exactly when the user is scanning it to decide which of nine
// agents to look at.
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
    aiTitle: fetched.aiTitle ?? previous.aiTitle,
    lastResponse: fetched.lastResponse ?? previous.lastResponse,
    workPhase: isWorkPhase(fetched.workPhase) ? fetched.workPhase : null,
  };
}
