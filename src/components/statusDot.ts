import type { AttentionStatus } from "./attentionStatus";

// Hardcoded, token-less roster hues — come through as arbitrary utilities. `done` is the exception:
// it names --done, the one green every view paints a finished turn with (#1307), so it cannot drift
// from the cell's ring or the row's edge. Shared by the roster row's header and the collapsed rail
// (#3271), so one session's dot is one colour wherever it is drawn.
export const STATUS_DOT_CLASS: Record<AttentionStatus, string> = {
  working: "bg-[#4a9eff]",
  done: "bg-done",
  blocked: "bg-[#f59e0b]",
  idle: "bg-[#666]",
};
