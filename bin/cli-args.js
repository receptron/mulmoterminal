// What the launcher decides before it starts anything, kept out of the executable so each
// decision can be checked without a process to exit or a terminal to type into.
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

/**
 * What to say when the port is taken.
 *
 * Running a second server is not a supported setup: both share ~/.mulmoterminal and the
 * workspace, but each keeps its own PTYs, pub/sub and in-memory caches, so the two disagree
 * about state neither can see the other change. Starting one silently on another port —
 * which is what a plain second `npx mulmoterminal` used to do — is how someone ends up in
 * that setup without knowing (#611).
 *
 * So the message has to answer the two things the user actually wants: where the running one
 * is, and how to insist if a second is really wanted.
 */
export function portInUseMessage(port, explicit) {
  const lines = [`Port ${port} is already in use.`];
  lines.push(`  If that is MulmoTerminal, it is already running at http://localhost:${port}`);
  lines.push(explicit ? "  Pick a different --port, or stop the other process." : "  To start a second one anyway: --port <number>");
  return lines.join("\n");
}

/**
 * What to do when the wanted port is taken: "ask" whether to start a second instance,
 * or "stop".
 *
 * Two conditions rule the question out. An explicit --port already named the port that
 * was wanted, so offering a different one answers a question nobody asked; and with no
 * terminal to type into (a script, a service, CI) a prompt has nobody to answer it and
 * would hang the start instead of failing it.
 */
export function portInUseAction(explicit, isTTY) {
  return explicit || !isTTY ? "stop" : "ask";
}

/**
 * The question asked when the default port is taken and there is somebody to answer.
 *
 * Two servers is not a supported setup (#611), but it is a legitimate thing to want on
 * purpose — so the answer is a question rather than a refusal, and the default is no.
 */
export function secondInstancePrompt(port) {
  return [`Port ${port} is already in use — MulmoTerminal may already be running at http://localhost:${port}`, "Start a second instance anyway? [y/N] "].join(
    "\n",
  );
}

/**
 * Whether an answer to that question is a yes.
 *
 * Only an explicit yes counts. The prompt says [y/N], so Enter — and anything unrecognised —
 * means no: starting a second server by misreading a stray keystroke is the outcome worth
 * avoiding, and saying no costs one retyped command.
 */
export function saysYes(answer) {
  return /^y(es)?$/i.test(String(answer ?? "").trim());
}

/**
 * What someone who said yes should know before the second one comes up.
 *
 * One line, and only the part that is still true: config and the hidden-session list are
 * safe across instances, but a session's tool history is cached per process and its live
 * updates never cross — so the instance that did not start a session shows a frozen history
 * for it (#611).
 */
export const SECOND_INSTANCE_NOTE = [
  "  Note: both share ~/.mulmoterminal. A session's tool history does not live-update",
  "  in the instance that did not start it.",
].join("\n");
