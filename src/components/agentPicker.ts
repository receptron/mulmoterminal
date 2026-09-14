import { TERMINAL_AGENTS } from "../../common/sessionAgent";
import type { LaunchAgent } from "../../common/launchAgent";
import { customAgentPick, type AgentPick, type CustomAgent } from "../../common/customAgents";

// The AGENT PICKER: what an empty grid cell can be started as, in the order the picker shows
// them — the built-in agents first (Claude leads — it is the default everywhere), then the user's
// own custom agents, then the OS default shell last. The built-ins are derived from
// TERMINAL_AGENTS so a new agent reaches the picker without a second list to keep in step; that
// SET is the same as LAUNCH_AGENTS, which is what the phone may ask for (#831).
//
// The picker is not the launcher chips beside it: a chip runs the user's command line verbatim,
// the picker starts a real agent session (CLAUDE.md, LaunchersSection.vue). A CUSTOM agent is on
// the picker's side of that line — Claude Code's own argv is appended to the user's command — see
// common/customAgents.ts.

export interface AgentPickerOption {
  agent: AgentPick;
  label: string;
  // Only where the label alone doesn't say it. The shell is the one built-in that needs nothing
  // installed and nothing configured, which is the whole reason it is offered here (#1114); a
  // custom agent's label is a name the user chose, so the hover carries the command it runs.
  title?: string;
}

const OPTIONS: Record<LaunchAgent, Omit<AgentPickerOption, "agent">> = {
  claude: { label: "Claude" },
  codex: { label: "Codex" },
  antigravity: { label: "Antigravity" },
  grok: { label: "Grok" },
  muse: { label: "Muse" },
  copilot: { label: "Copilot" },
  cursor: { label: "Cursor" },
  shell: { label: "Shell", title: "A plain shell ($SHELL) — no agent, nothing to configure" },
};

// Exported on its own for the collection browser's launch picker, which offers ONLY these:
// spawnBackgroundChat hosts exactly the built-in agents — no shell (a seeded chat needs an
// agent to send the seed to) and no custom agents (the route builds no custom argv).
export const BUILTIN_AGENT_OPTIONS: readonly AgentPickerOption[] = TERMINAL_AGENTS.map((agent) => ({ agent, ...OPTIONS[agent] }));
const SHELL_OPTION: AgentPickerOption = { agent: "shell", ...OPTIONS.shell };

/** The built-in options alone — the whole picker when the user has configured no custom agent,
 *  which is every install by default. */
export const AGENT_PICKER_OPTIONS: readonly AgentPickerOption[] = [...BUILTIN_AGENT_OPTIONS, SHELL_OPTION];

/**
 * The picker's options for a user who has configured custom agents.
 *
 * They sit with the AGENTS — after the built-in ones, before Shell — because that is what they
 * are: a session started this way resumes, reports cost and context, and reaches the GUI tools.
 * Putting them after Shell would group them with the thing they are most likely to be confused
 * with, and the shell has to stay last for the reason the row's own comment gives.
 *
 * The hover names the COMMAND. The label is whatever the user called the entry, and "Nemotron"
 * alone cannot say which binary a cell is about to run — which is the one question worth
 * answering before clicking a button that starts someone else's program.
 */
export function agentPickerOptions(customAgents: readonly CustomAgent[]): readonly AgentPickerOption[] {
  if (customAgents.length === 0) return AGENT_PICKER_OPTIONS;
  const custom = customAgents.map((agent): AgentPickerOption => ({
    agent: customAgentPick(agent.id),
    label: agent.label,
    title: `${agent.command} — your own way of starting Claude Code (Claude Code's own arguments are appended)`,
  }));
  return [...BUILTIN_AGENT_OPTIONS, ...custom, SHELL_OPTION];
}
