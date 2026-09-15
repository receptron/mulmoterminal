// Which agent CLIs the launcher looks for, and which of them this machine has (#2082).
//
// MIRRORS `TERMINAL_AGENTS` (common/sessionAgent.ts) and each adapter's own `bin()` / `binEnvVar`,
// and CANNOT import them: bin runs as plain JS before tsx exists, the same reason `isWslHost()` in
// the launcher mirrors server/files/wsl.ts. A spec pins this table against both, so an eighth agent
// is a red test rather than an agent that silently does not count.
//
// The ORDER is the order `init` reports them in, which is by how likely a reader is to have one
// rather than by the type's own order — the point of the list is to help someone install their
// first agent. Nothing decides behaviour from the position.

/** @typedef {{ agent: string, cmd: string, env: string, hint: string }} AgentCommand */

/** @type {readonly AgentCommand[]} */
export const AGENT_COMMANDS = [
  { agent: "claude", cmd: "claude", env: "CLAUDE_BIN", hint: "npm install -g @anthropic-ai/claude-code  (then run `claude` and log in)" },
  { agent: "codex", cmd: "codex", env: "CODEX_BIN", hint: "npm install -g @openai/codex" },
  { agent: "copilot", cmd: "copilot", env: "COPILOT_BIN", hint: "npm install -g @github/copilot" },
  { agent: "cursor", cmd: "cursor-agent", env: "CURSOR_BIN", hint: "curl https://cursor.com/install -fsS | bash" },
  { agent: "antigravity", cmd: "agy", env: "ANTIGRAVITY_BIN", hint: "https://antigravity.google" },
  { agent: "grok", cmd: "grok", env: "GROK_BIN", hint: "npm install -g @vibe-kit/grok-cli" },
  { agent: "muse", cmd: "muse", env: "MUSE_BIN", hint: "https://muse.ai" },
];

/** The command an agent is actually started with: its `<AGENT>_BIN` override when set, its default
 *  name otherwise — the same rule the server's adapters use.
 *
 *  Asking for the bare name instead is the bug in #2082: `CLAUDE_BIN` pointing at a working Claude
 *  Code was refused startup, and the user was told to install what they already had. An override
 *  that is set but empty is not an override; `||` rather than `??` for that reason.
 *
 * @param {AgentCommand} agentCommand
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export const agentBin = ({ cmd, env: name }, env) => env[name] || cmd;

/** Does this command NAME A PATH, rather than a command to look up? The server's own rule
 *  (`namesAPath`, server/infra/resolve-bin.ts): a separator anywhere in it.
 *
 * @param {string} bin
 * @returns {boolean}
 */
export const namesAPath = (bin) => bin.includes("/") || bin.includes("\\");

/** Whether a resolved command can be started — asked the way the SERVER asks it, which is the
 *  whole point of this function existing.
 *
 *  A NAME is looked up by running it. A PATH IS NOT, and that is a bug this file was written with:
 *  the launcher's `hasCommand` builds a SHELL STRING, so `CLAUDE_BIN="/Applications/My
 *  Tools/claude"` was split at the space and reported missing — the app refusing to start for
 *  someone who has Claude Code installed, which is the exact complaint #2082 is about, re-created
 *  through a different door. The server meanwhile answers `true` for that same path, so the two
 *  disagreed: a launcher that refuses what the server would happily spawn is worse than the gate
 *  it replaced.
 *
 *  A path is therefore asked of the FILESYSTEM, mirroring `diagnosePathName`: it must be a file,
 *  and on POSIX it must be executable. Windows has no execute bit — executability there is the
 *  extension — so existing is the whole question, and asking for a bit that does not exist would
 *  refuse every Windows install.
 *
 *  A bare name still goes through the shell, deliberately: `npm install -g` on Windows produces
 *  `codex.cmd`, which CreateProcess cannot run without one.
 *
 * @param {string} bin
 * @param {{ isFile: (p: string) => boolean, isExecutable: (p: string) => boolean, runsOnPath: (name: string) => boolean }} probe
 * @param {NodeJS.Platform} platform
 * @returns {boolean}
 */
export function canRun(bin, probe, platform) {
  if (!namesAPath(bin)) return probe.runsOnPath(bin);
  if (!probe.isFile(bin)) return false;
  return platform === "win32" || probe.isExecutable(bin);
}

/** The agents whose command this machine can run.
 *
 *  `probe` is injected so the decision can be tested without seven real CLIs on the runner — the
 *  launcher passes one built on `canRun`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {(bin: string) => boolean} probe
 * @returns {AgentCommand[]}
 */
export const installedAgents = (env, probe) => AGENT_COMMANDS.filter((agentCommand) => probe(agentBin(agentCommand, env)));
