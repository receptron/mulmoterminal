// What `yarn dev` runs, per platform — pure, so the choice is pinned without starting anything.
//
// The backend and Vite run under `concurrently` for its prefixed, coloured output. On Windows it
// cannot be used for this: on Ctrl+C it ends its children with `taskkill /T /F`, which kills the
// backend before it flushes queued session state to disk (#2161, #3253), and it has no option to
// leave them alone. Every process in the console gets that Ctrl+C anyway, so on Windows the two
// are started directly and left to stop themselves.
//
// Directly means `node <script>`, with no shell: `vite` on Windows is `vite.cmd`, and a batch file
// answers Ctrl+C with "Terminate batch job (Y/N)?", which would hold the run open on a prompt.

export const DEV_SCRIPTS = [
  { name: "server", script: "scripts/dev-server.mjs" },
  { name: "vite", script: "node_modules/vite/bin/vite.js" },
];

const CONCURRENTLY_ARGS = ["-n", "server,vite", "-c", "blue,green", "node scripts/dev-server.mjs", "vite"];

/**
 * `DEV_RUN_SCRIPTS` (a JSON array of script paths) replaces the scripts and forces the direct
 * runner — a seam for the runner's own spec, as DEV_SERVER_ENTRY is for the supervisor's.
 * @param {string} platform
 * @param {Record<string, string | undefined>} env
 * @returns {{ kind: "concurrently", args: string[] } | { kind: "direct", scripts: { name: string, script: string }[] }}
 */
export function devRunPlan(platform, env = {}) {
  const override = scriptsFrom(env.DEV_RUN_SCRIPTS);
  if (override) return { kind: "direct", scripts: override };
  return platform === "win32" ? { kind: "direct", scripts: DEV_SCRIPTS } : { kind: "concurrently", args: CONCURRENTLY_ARGS };
}

/** @param {string | undefined} json */
function scriptsFrom(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((s) => typeof s === "string")) return null;
    return parsed.map((script, i) => ({ name: `script${i}`, script }));
  } catch {
    return null;
  }
}

/** The exit code for the whole run: the first non-zero one among the commands, else 0. */
export const combinedExitCode = (codes) => codes.find((code) => code !== 0 && code !== null) ?? 0;
