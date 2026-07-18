// Splits the agent's "working" (running) state into planning vs implementing, from the
// tools it has run recently — so the grid roster can show whether a cell is still exploring
// or actively editing. Heuristic by nature: it reads tool categories, not intent.
export type WorkPhase = "planning" | "implementing";

// Tools that change the workspace. Once the agent has run one, it has moved past exploring
// into making changes. Bash is deliberately NOT here: it appears in both phases (git status
// while planning, tests while implementing), so it alone shouldn't tip the classification.
const MUTATION_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

// `null` when there are no tools to judge (the agent just started, or is only thinking).
// Otherwise: any mutation in the window → implementing; only reads / searches / commands
// → planning.
export function classifyWorkPhase(recentTools: string[]): WorkPhase | null {
  if (recentTools.length === 0) return null;
  return recentTools.some((tool) => MUTATION_TOOLS.has(tool)) ? "implementing" : "planning";
}
