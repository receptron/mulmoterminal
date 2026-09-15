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

import path from "node:path";

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

/** Could this be a command NAME at all? Letters, digits, and the punctuation real command names
 *  use — `cursor-agent`, `claude.cmd`, `node_modules`-style underscores.
 *
 *  It exists because the PATH probe runs `<name> --version` THROUGH A SHELL, which a bare name
 *  from `<AGENT>_BIN` now reaches. Measured: `CODEX_BIN='echo hi; touch /tmp/x'` runs the `touch`.
 *  That is not a privilege boundary — the variable is the user's own environment, and a repo-local
 *  `.env` does NOT reach this process (it is handed to the SERVER child as `--env-file-if-exists`,
 *  bin/cli-args.js) — but it is still the wrong answer to the wrong question: a value that cannot
 *  be a command name should be reported MISSING, not executed as a command line. The same guard
 *  fixes the ordinary case that has nothing to do with hostility: `CODEX_BIN="my codex"` was split
 *  at the space and silently probed something else.
 *
 * @param {string} bin
 * @returns {boolean}
 */
export const isPlainCommandName = (bin) => /^[A-Za-z0-9_.+@-]+$/.test(bin);

/** Could this be a BINARY at all — a name or a path — rather than a fragment of a command line?
 *
 *  It guards the branch below that answers TRUE without checking anything: a relative path cannot be
 *  resolved from this process, so "I cannot tell" is the honest answer for `./claude`. It is NOT the
 *  honest answer for `echo hi; touch /tmp/x`, which also contains a separator and would otherwise be
 *  counted as an installed agent — letting the gate pass on a machine with nothing on it, which is
 *  the one thing the gate exists to catch.
 *
 *  Shell operators and control characters only. Spaces, dots and separators are ordinary in real
 *  paths (`/Applications/My Tools/claude`) and must stay allowed.
 *
 * @param {string} bin
 * @returns {boolean}
 */
export const couldBeABinary = (bin) => bin !== "" && !/[;&|<>$`\n\r\0]/.test(bin);

/** Whether a resolved command can be started — asked the way the SERVER asks it, which is the
 *  whole point of this function existing. Three branches, and each one was paid for:
 *
 *  A NAME goes through the shell, because `npm install -g` on Windows produces `codex.cmd` and
 *  CreateProcess cannot run one without a shell. It must look like a name first (above).
 *
 *  A RELATIVE path answers TRUE without being probed, mirroring `diagnosePathName`: it resolves
 *  against the PTY's cwd, not this process's, so it cannot be answered from here at all. Probing it
 *  here made the launcher refuse `CLAUDE_BIN=./claude` that the server deliberately treats as
 *  spawnable (Codex review, round 1 — reproduced: server true, launcher false for `./claude`,
 *  `dir/claude` and `../bin/claude`). `couldBeABinary` is what keeps that shortcut from swallowing a
 *  command-line fragment, which also contains separators and would otherwise be counted as an agent.
 *
 *  An ABSOLUTE path is asked of the filesystem: a file, and on POSIX an executable one. Windows has
 *  no execute bit — executability there is the extension — so existing is the whole question, and
 *  asking for a bit that does not exist would refuse every Windows install. Asking the SHELL
 *  instead was the original bug: `CLAUDE_BIN="/Applications/My Tools/claude"` split at the space.
 *
 * @param {string} bin
 * @param {{ isFile: (p: string) => boolean, isExecutable: (p: string) => boolean, runsOnPath: (name: string) => boolean }} probe
 * @param {NodeJS.Platform} platform
 * @returns {boolean}
 */
export function canRun(bin, probe, platform) {
  if (!couldBeABinary(bin)) return false;
  if (!namesAPath(bin)) return isPlainCommandName(bin) && probe.runsOnPath(bin);
  const rules = platform === "win32" ? path.win32 : path.posix;
  if (!rules.isAbsolute(bin)) return true;
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
