// A CUSTOM AGENT: the user's own way of starting Claude Code.
//
// It is an entry in the AGENT PICKER, beside the built-in agents and Shell — NOT a
// launcher chip. The difference is the whole point of the two controls (see CLAUDE.md):
//
//   - A launcher chip runs the user's command line VERBATIM. Nothing is inserted, no MCP is
//     attached, and the session is recorded as a shell — no transcript, no resume, no cost.
//   - A custom agent runs the user's command line and then APPENDS Claude Code's own argv to
//     it — `--session-id` / `--resume`, `--settings` with the hooks, `--permission-mode`,
//     `--mcp-config`, `--allowedTools`, `--add-dir`, `--append-system-prompt`. So it is a real
//     agent session in every respect that matters downstream: it resumes, it reports cost and
//     context, it goes "waiting for you", and the GUI tools reach it.
//
// That is what makes `ollama launch claude --model nemotron-3-ultra:cloud --` a usable
// replacement for the `claude` binary rather than just a command that happens to start it: the
// wrapper consumes its own flags, and everything after the `--` is the argv Claude Code would
// have been given anyway.
//
// The command is run as ARGV, not through a shell: it is split on whitespace with quotes
// honoured, and nothing in it is expanded. A `$HOME` or a pipe in there is a literal argument —
// use a launcher chip if you want a shell.
import { type LaunchAgent, isLaunchAgent } from "./launchAgent.js";
import { isRecord } from "./isRecord.js";

// WHICH agent this entry is launching as — whose command-line arguments get appended to the
// user's command. It is declared, never inferred: nothing in `ollama launch claude --model … --`
// tells this app which CLI is on the other side of that `--`, and guessing from the text is the
// mistake the launcher chips were cured of (CLAUDE.md). An entry that does not say gets nothing
// appended, so it must say.
//
// Claude Code is the only one today. Codex and Antigravity take a different argument set
// (server/agents/codex-args.ts), so adding one here means teaching the spawn to build ITS argv —
// which is why this is a list rather than a boolean.
export const CUSTOM_AGENT_KINDS = ["claude"] as const;

export type CustomAgentKind = (typeof CUSTOM_AGENT_KINDS)[number];

export const isCustomAgentKind = (value: unknown): value is CustomAgentKind => CUSTOM_AGENT_KINDS.some((kind) => kind === value);

export interface CustomAgent {
  /** Stable slug. It keys the wire (`?customAgent=`) and the picker, so renaming the LABEL is
   *  free while renaming this is not. */
  id: string;
  /** What the Agent Picker shows on the button. */
  label: string;
  /** Which agent this launches as — whose arguments are appended to `command`. Required: see
   *  CUSTOM_AGENT_KINDS above for why it is not defaulted. */
  agent: CustomAgentKind;
  /** The command line to run, with that agent's own argv appended to it. */
  command: string;
}

// Lowercase slug: it travels in a query string and is compared exactly on both sides, so the
// spellings a user might consider equal ("Nemotron" / "nemotron") must not be two ids.
//
// Underscores are in because people write them: `kimi_k3` and `glm_52` were the second and third
// entries anyone wrote here, and rejecting them dropped both silently — the entry simply never
// appeared in the picker, which is indistinguishable from the config never having been saved.
// Nothing about `_` is harder to carry than `-`, so the stricter rule was buying nothing.
export const CUSTOM_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Whether `value` is a usable custom-agent id AND is not one of the built-in picker options —
 *  an entry calling itself "claude" would be shadowed by the built-in button and never reachable,
 *  which looks like the config was ignored. */
export const isCustomAgentId = (value: unknown): value is string => typeof value === "string" && CUSTOM_AGENT_ID_RE.test(value) && !isLaunchAgent(value);

// What the Agent Picker holds: one of the built-ins (`LAUNCH_AGENTS`), or `custom:<id>`.
//
// The prefix is what keeps the union honest. Bare ids would make the type `string`, and every
// `pick === "shell"` in a template would then be a comparison the compiler cannot check — while
// `LAUNCH_AGENTS` has to stay a CLOSED list, because it is also what the phone may ask the grid
// to start (common/launchAgent.ts).
export type CustomAgentPick = `custom:${string}`;
export type AgentPick = LaunchAgent | CustomAgentPick;

export const customAgentPick = (id: string): CustomAgentPick => `custom:${id}`;

/** The custom agent an Agent Picker value names, or null for a built-in. */
export function customAgentIdOf(pick: AgentPick | null | undefined): string | null {
  if (typeof pick !== "string" || !pick.startsWith("custom:")) return null;
  const id = pick.slice("custom:".length);
  return isCustomAgentId(id) ? id : null;
}

/** The entry a pick refers to, or null when it names a built-in or an agent that is no longer
 *  configured — a cell can outlive the config entry it was launched from. */
export function customAgentFor(pick: AgentPick | null | undefined, agents: readonly CustomAgent[]): CustomAgent | null {
  const id = customAgentIdOf(pick);
  return id ? (agents.find((agent) => agent.id === id) ?? null) : null;
}

/** A wire/config row read back as a CustomAgent. Used by both sides: the server sanitizing
 *  config.json and the browser filtering GET /api/config. */
export function isCustomAgent(row: unknown): row is CustomAgent {
  if (!isRecord(row)) return false;
  return (
    isCustomAgentId(row.id) &&
    typeof row.label === "string" &&
    !!row.label.trim() &&
    isCustomAgentKind(row.agent) &&
    typeof row.command === "string" &&
    !!row.command.trim()
  );
}
