// What a launch REQUEST becomes as a grid cell, for every way one can arrive: the phone's request
// (#831), and the launch panel (#1867). Its own file because it is a pure transform and the two
// hosts that use it are a Vue component and a websocket handler — neither a place to test it from.
import { sessionCell, shellCell, storedCellAgent, type Cell } from "./gridTabs";
import type { TerminalAgent } from "../../common/sessionAgent";
import type { LaunchChoice } from "./wsUrl";
import { isLaunchAgent, type LaunchAgent } from "../../common/launchAgent";
import { customAgentIdOf, type AgentPick } from "../../common/customAgents";
import { asTerminalAgent } from "../../common/sessionAgent";
import { remoteDirOf, type RemoteStart } from "./remoteLaunch";

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

/** What the launch panel's form decided for a NEW session. */
export interface PanelStart {
  dir: string | null;
  pick: AgentPick;
  choice: LaunchChoice | null;
  account: string | null;
}

/** A listed session the launch panel resumes, with the login its row was found under (#2215). */
export interface PanelResume {
  id: string;
  cwd: string | null;
  agent?: TerminalAgent;
  account?: string | null;
}

// Only the keys that were decided: the cell round-trips through JSON, where an absent key and one
// holding null are different things (see `setCellAgent`).
const withAccount = (account: string | null | undefined) => (account ? { account } : {});

// The model pick and the account ride on the cell, not on the launch call: what starts the session
// is the cell MOUNTING, so anything the form decided has to be on the cell by then or it is lost.
export const cellForPanelStart = ({ dir, pick, choice, account }: PanelStart, defaultCwd: string | null): Omit<Cell, "uid"> => ({
  ...cellForPick(dir ?? defaultCwd, pick),
  ...(choice ? { launchChoice: choice } : {}),
  ...withAccount(account),
});

export const cellForPanelResume = ({ id, cwd, agent, account }: PanelResume): Omit<Cell, "uid"> => ({
  ...sessionCell(id, cwd, agent ?? "claude"),
  ...withAccount(account),
});

/** A launch panel start on a remote host, or null when the directory is not one the remote can use. */
export function cellForRemoteStart({ host, dir, agent }: RemoteStart): Omit<Cell, "uid"> | null {
  const remoteDir = remoteDirOf(dir);
  return remoteDir === null ? null : { ...cellForAgent(remoteDir, agent), remoteHost: host };
}
