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
