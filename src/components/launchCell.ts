// What a launch REQUEST becomes as a grid cell, for every way one can arrive: the phone's request
// (#831), and the launch panel (#1867). Its own file because it is a pure transform and the two
// hosts that use it are a Vue component and a websocket handler — neither a place to test it from.
import { shellCell, storedCellAgent, type Cell } from "./gridTabs";
import { isLaunchAgent, type LaunchAgent } from "../../common/launchAgent";
import { customAgentIdOf, type AgentPick } from "../../common/customAgents";
import { asTerminalAgent } from "../../common/sessionAgent";

// Each kind is already expressible as a cell: a shell is a shell launcher, a non-Claude agent is
// marked with `agent`, and Claude is the plain default. The session id arrives from the server once
// the cell opens its socket, so they all persist and reconnect like any other cell.
//
// `autoStart` is what makes an agent cell RUN. Without it these are indistinguishable from the
// empty launcher — no session, no command, no launcher — so the phone's request (#831) opened the
// cell-creation form with the agent pre-picked and waited for someone at the desktop to press
// Start, which is exactly what #1535 reported. A shell needs none of it: its launcher runs on sight.
//
// A Record over LAUNCH_AGENTS rather than an if-chain: the chain ended in `shellCell`, so adding an
// agent to that list without a case here silently opened a SHELL under its name. Now it does not
// compile.
export const CELL_FOR_AGENT: Record<LaunchAgent, (cwd: string | null) => Omit<Cell, "uid">> = {
  shell: (cwd) => shellCell(cwd),
  claude: (cwd) => ({ session: null, cwd, autoStart: true }),
  codex: (cwd) => ({ session: null, cwd, agent: "codex", autoStart: true }),
  antigravity: (cwd) => ({ session: null, cwd, agent: "antigravity", autoStart: true }),
  grok: (cwd) => ({ session: null, cwd, agent: "grok", autoStart: true }),
  muse: (cwd) => ({ session: null, cwd, agent: "muse", autoStart: true }),
  copilot: (cwd) => ({ session: null, cwd, agent: "copilot", autoStart: true }),
  cursor: (cwd) => ({ session: null, cwd, agent: "cursor", autoStart: true }),
};
export const cellForAgent = (cwd: string | null, agent: LaunchAgent | undefined): Omit<Cell, "uid"> => (agent ? CELL_FOR_AGENT[agent](cwd) : shellCell(cwd));

// The same question asked with the AGENT PICKER's value, which the built-in list cannot express: a
// custom agent is a WRAPPER around a built-in CLI, so the cell carries both halves. `customAgent`
// says which command line starts it and `agent` says whose argv is appended — absent for Claude,
// the same absent-key rule `sessionCell` explains. Splitting them is what lets a custom-agent cell
// resume and report cost like any other (common/customAgents.ts).
//
// Needed because the launch panel creates the cell from OUTSIDE it. While the form lived in the
// cell, a custom pick never had to leave TerminalCell's own state.
export const cellForPick = (cwd: string | null, pick: AgentPick | undefined): Omit<Cell, "uid"> => {
  const customAgent = customAgentIdOf(pick);
  if (customAgent === null) return cellForAgent(cwd, isLaunchAgent(pick) ? pick : undefined);
  const agent = storedCellAgent(asTerminalAgent(pick));
  return { session: null, cwd, customAgent, ...(agent === undefined ? {} : { agent }), autoStart: true };
};
