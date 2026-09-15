// Which agent CLIs the launcher looks for, and which of them this machine has (#2082).
//
// MIRRORS `TERMINAL_AGENTS` (common/sessionAgent.ts) and each adapter's own `bin()` / `binEnvVar`,
// and CANNOT import them: bin runs as plain JS before tsx exists, the same reason `isWslHost()` in
// the launcher mirrors server/files/wsl.ts. A spec pins this table against both, so an eighth agent
// is a red test rather than an agent that silently does not count.
//
// The ORDER is by how likely a reader is to have one rather than by the type's own order — the point
// of the list is to help someone install their first agent, and it is the order `init` reports in.
//
// It DOES decide behaviour, since the round-2 short-circuit: `firstInstalledAgent` probes in this
// order and stops, so the position decides which agent the startup gate names, and how much latency
// an earlier one can add before a later installed agent is reached (bounded by the probe timeout).
// Reordering is therefore a behaviour change, not a cosmetic one.

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

// yarn v1 prepends a temp dir holding a `node` shim; yarn and npm both prepend `node_modules/.bin`
// and npm's node-gyp-bin. MIRRORS `isLauncherPathEntry` (server/infra/pty-env.ts) — matched on the
// entry's LAST segment, so a directory that merely CONTAINS one of these names somewhere is the
// user's — and a spec pins the two against each other over generated entries rather than by copying
// the list.
const YARN_SHIM_DIR = /^yarn--\d/;

/** Is this PATH entry a run-script injection rather than something the user installed?
 *
 * @param {string} entry
 * @returns {boolean}
 */
export function isRunScriptPathEntry(entry) {
  // Dequoted first, because the search does — see `isLauncherPathEntry`, which this mirrors.
  const segments = entry
    .replace(/^"(.*)"$/, "$1")
    .split(/[\\/]/)
    .filter((segment) => segment !== "");
  const last = segments[segments.length - 1];
  if (last === undefined) return false;
  const parent = segments[segments.length - 2];
  return YARN_SHIM_DIR.test(last) || (last === ".bin" && parent === "node_modules") || last === "node-gyp-bin";
}

/** The PATH the launcher may probe, which is the PATH the SPAWN will search.
 *
 *  THIS IS WHY IT EXISTS, and it is not only about agreeing on an answer. `npx mulmoterminal` run
 *  where a `node_modules/.bin` is on PATH — which `yarn`/`npm` run-scripts and npx itself arrange —
 *  made the gate EXECUTE that directory's `codex --version`, a binary the server deliberately
 *  refuses to spawn (`sanitizePtyEnv` strips those entries). Measured: a fake `codex` in a repo's
 *  `node_modules/.bin` ran at the gate.
 *
 *  Stripping them here makes the launcher's probe ask the question the spawn will ask, so the
 *  divergence that produced a finding in four separate rounds is closed at the source rather than
 *  case by case.
 *
 * @param {string | undefined} pathValue
 * @param {string} delimiter
 * @returns {string}
 */
export const searchPathForProbe = (pathValue, delimiter) =>
  (pathValue ?? "")
    .split(delimiter)
    .filter((entry) => !isRunScriptPathEntry(entry))
    .join(delimiter);

/** The environment an agent probe runs in: every PATH variable rewritten to what the SPAWN will
 *  search, and nothing else touched.
 *
 *  REWRITTEN IN PLACE, not added. On Windows the variable is `Path`, and `{ ...env, PATH: clean }`
 *  leaves the original `Path` intact while adding a SECOND key — so the child can still search the
 *  unsanitised one, on the one platform this cannot be tested from here. The server's
 *  `sanitizePtyEnv` matches the name case-insensitively for exactly this reason (`isPathVar`), and
 *  this mirrors it.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} delimiter
 * @returns {NodeJS.ProcessEnv}
 */
export function probeEnvFrom(env, delimiter) {
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    out[name] = name.toLowerCase() === "path" && value !== undefined ? searchPathForProbe(value, delimiter) : value;
  }
  return out;
}

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

/** The agents whose command this machine can run. EVERY row is probed, which is what the doctor
 *  (`npx mulmoterminal init`) wants — it reports each agent's line.
 *
 *  The startup GATE must not use this: see `firstInstalledAgent`.
 *
 *  `probe` is injected so the decision can be tested without seven real CLIs on the runner — the
 *  launcher passes one built on `canRun`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {(bin: string) => boolean} probe
 * @returns {AgentCommand[]}
 */
export const installedAgents = (env, probe) => AGENT_COMMANDS.filter((agentCommand) => probe(agentBin(agentCommand, env)));

/** The FIRST agent this machine can run, or null — the startup gate's question, and a different one
 *  from the doctor's.
 *
 *  Short-circuiting is not an optimisation. Probing a bare name runs `<name> --version`, so every
 *  row is a command the user may not control: measured, a `grok` on PATH that blocks for 30 seconds
 *  held the gate for 30,059 ms even though `claude` had already been found and answered. An optional
 *  agent nobody asked for must not be able to delay startup once the gate's question is settled
 *  (Codex review, round 2).
 *
 *  The probe's own timeout is the other half and neither is sufficient alone: this one does nothing
 *  when the hanging agent is FIRST, and the timeout alone still costs one per row on a machine with
 *  no agents at all.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {(bin: string) => boolean} probe
 * @returns {AgentCommand | null}
 */
export const firstInstalledAgent = (env, probe) => AGENT_COMMANDS.find((agentCommand) => probe(agentBin(agentCommand, env))) ?? null;
