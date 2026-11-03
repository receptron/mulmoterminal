// What `yarn dev` runs, per platform — pure, so the choice is pinned without starting anything.
//
// The backend and Vite run under `concurrently` for its prefixed, coloured output. On Windows it
// cannot be used for this: on Ctrl+C it ends its children with `taskkill /T /F`, which kills the
// backend before it flushes queued session state to disk (#2161, #3253), and it has no option to
// leave them alone. Every process in the console gets that Ctrl+C anyway, so on Windows the two
// are started directly and left to stop themselves.

export const DEV_COMMANDS = [
  { name: "server", command: "node scripts/dev-server.mjs" },
  { name: "vite", command: "vite" },
];

const CONCURRENTLY_ARGS = ["-n", "server,vite", "-c", "blue,green", ...DEV_COMMANDS.map((c) => c.command)];

/**
 * `DEV_RUN_COMMANDS` (a JSON array of command lines) replaces the commands and forces the direct
 * runner — for the runner's own spec, as DEV_SERVER_ENTRY is for the supervisor's.
 * @param {string} platform
 * @param {Record<string, string | undefined>} env
 * @returns {{ kind: "concurrently", args: string[] } | { kind: "direct", commands: { name: string, command: string }[] }}
 */
export function devRunPlan(platform, env = {}) {
  const override = commandsFrom(env.DEV_RUN_COMMANDS);
  if (override) return { kind: "direct", commands: override };
  return platform === "win32" ? { kind: "direct", commands: DEV_COMMANDS } : { kind: "concurrently", args: CONCURRENTLY_ARGS };
}

/** @param {string | undefined} json */
function commandsFrom(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || !parsed.every((c) => typeof c === "string")) return null;
    return parsed.map((command, i) => ({ name: `command${i}`, command }));
  } catch {
    return null;
  }
}

/** The exit code for the whole run: the first non-zero one among the commands, else 0. */
export const combinedExitCode = (codes) => codes.find((code) => code !== 0 && code !== null) ?? 0;
