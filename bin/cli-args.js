// What the launcher's two flags resolve to, decided without touching the process.
//
// `--cwd` picks the workspace claude runs in and whose sessions the sidebar lists, so it is
// a data-scope boundary: getting it wrong points the whole app at someone else's project.
// `--port` decides whether a clash is a hard error or a silent retry. Both used to be
// decided inside the executable, where they exit the process on a bad value and so could not
// be checked at all (#611 A3).
//
// These return a decision; the caller prints and exits. Nothing here reads argv, the
// environment or the filesystem.

/**
 * Which port the launcher should ask for.
 * `--port` must be a plain integer in range: a value that merely starts with digits ("80x")
 * or carries a sign or padding ("+80", "080") is a typo, and silently launching on 80 is
 * worse than saying so.
 */
export function parsePortArg(args, defaultPort) {
  const at = args.indexOf("--port");
  if (at === -1) return { port: defaultPort, explicit: false };
  const raw = args[at + 1];
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isInteger(parsed) || String(parsed) !== raw || parsed < 1 || parsed > 65535) {
    return { error: `Invalid --port value: "${raw ?? ""}" (expected integer 1..65535)` };
  }
  return { port: parsed, explicit: true };
}

/**
 * Which directory to run in, before it is made absolute.
 * Precedence: `--cwd` (relative allowed) > CLAUDE_CWD > the directory the launcher was run
 * from. `mustExist` is set only for `--cwd`: a typo there should stop the launch, while a
 * CLAUDE_CWD naming a directory that isn't there yet is the managed-workspace case the
 * server creates on boot.
 */
export function chooseCwd(args, env) {
  const at = args.indexOf("--cwd");
  if (at === -1) return { path: env.CLAUDE_CWD ?? ".", mustExist: false };
  const value = args[at + 1];
  // A missing value swallows the next flag ("--cwd --port 3000" would run in a directory
  // called "--port"), so anything flag-shaped is treated as absent.
  if (value === undefined || value.startsWith("-")) return { error: "--cwd requires a directory path" };
  return { path: value, mustExist: true };
}
