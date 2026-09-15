// Environment sanitization for spawned PTYs.
//
// The server is usually started by a package-manager script (`yarn dev`,
// `npm run dev`, `npx mulmoterminal`), and those launchers leak their context
// into process.env. The worst offender: Homebrew's yarn wrapper exports
// PREFIX=/opt/homebrew, and nvm's auto-activation (`nvm use` in .zshrc) strips
// its bin dir from PATH *before* its compatibility check aborts on PREFIX —
// leaving the spawned shell with no node/npm/npx at all. The npm_*/INIT_CWD
// vars and the PATH shim dirs (yarn's temp node wrapper, node_modules/.bin)
// are the same class of leak: run-script context that a user terminal — or a
// claude session — should never inherit. Strip it all so spawned PTYs start
// from an environment a fresh login shell would recognize.

// All lowercase: matching is case-insensitive, since Windows env names are.
const REMOVED_NAMES = new Set([
  "prefix", // Homebrew yarn wrapper; fatal to nvm (see header comment)
  "init_cwd",
  "node", // npm run points it at the launching node binary
  "project_cwd", // yarn berry
  "berry_bin_folder", // yarn berry
  "npm_execpath",
  "npm_node_execpath",
  "npm_command",
]);

const REMOVED_PREFIXES = ["npm_config_", "npm_package_", "npm_lifecycle_"];

// Is this env var package-manager launcher context (vs. real user environment)?
// Deliberately narrow: HOMEBREW_PREFIX / CONDA_PREFIX etc. must survive.
export function isLauncherEnvVar(name: string): boolean {
  const lower = name.toLowerCase();
  return REMOVED_NAMES.has(lower) || REMOVED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Does the env var name the search path? Windows spells it "Path".
export function isPathVar(name: string): boolean {
  return name.toLowerCase() === "path";
}

// A variable out of a PLAIN env object, matched the way Windows matches: case-insensitively.
// `env.PATH` / `env.ComSpec` are only reliable on the live `process.env`, whose Windows
// lookups are case-insensitive; a copy (what sanitizePtyEnv returns) keeps whatever casing
// the system used and answers undefined to any other spelling.
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return Object.entries(env).find(([key]) => key.toLowerCase() === wanted)?.[1];
}

export const pathFromEnv = (env: NodeJS.ProcessEnv): string | undefined => envValue(env, "PATH");

// yarn v1's temp dir is `yarn--` + a timestamp.
const YARN_SHIM_DIR = /^yarn--\d/;

// Is this PATH entry a run-script injection? yarn v1 prepends a temp dir with a
// `node` shim, and both yarn and npm prepend node_modules/.bin + npm's
// node-gyp-bin dirs. Matched on the entry's LAST segment: a directory that
// merely contains one of these names somewhere in its path is the user's.
export function isLauncherPathEntry(entry: string): boolean {
  // DEQUOTED first, because the search does: a Windows PATH entry may be written
  // `"C:\Program Files\tools"`, and `windowsSearchDirectories` strips those quotes before looking
  // inside. Matching the quoted spelling left `"…\node_modules\.bin"` in the PATH and then searched
  // it anyway — the entry this function exists to remove, kept by its punctuation (Codex review on
  // PR #2085, round 7).
  const segments = entry
    .replace(/^"(.*)"$/, "$1")
    .split(/[\\/]/)
    .filter((segment) => segment !== "");
  if (segments.length === 0) return false; // "" and "/" name no directory of ours
  const last = segments[segments.length - 1];
  if (last === undefined) return false; // unreachable: length was checked above
  const parent = segments[segments.length - 2];
  return YARN_SHIM_DIR.test(last) || (last === ".bin" && parent === "node_modules") || last === "node-gyp-bin";
}

// PATH with the run-script injections removed; everything else (nvm, homebrew,
// system dirs) kept in order.
export function sanitizePathEntries(pathValue: string, delimiter: string): string {
  return pathValue
    .split(delimiter)
    .filter((entry) => !isLauncherPathEntry(entry))
    .join(delimiter);
}

// Read in this order by every locale-aware program; the first non-empty one wins.
const LOCALE_NAMES = ["LC_ALL", "LC_CTYPE", "LANG"];

// Shipped with every macOS, which is what makes naming it safe — a locale that is not
// installed leaves setlocale failing, and the programs that report that (perl loudest)
// would be noisier than the empty environment they started from.
const FALLBACK_LOCALE = "en_US.UTF-8";

/** The environment a PTY inherits, before any per-session additions: the launcher variables
 *  dropped, the run-script PATH injections stripped, a UTF-8 LANG supplied on macOS when nothing
 *  names a locale.
 *
 *  Separate from `ptyEnv` so that a caller who needs only "the PATH the spawn will search" can have
 *  it without importing the spawn — `server/config/agent-availability.ts` asks exactly that, and
 *  importing pty-spawn for it broke every spec that mocks pty-spawn. The two must not drift: the
 *  route's answer is a claim about what a spawn will find, and it is worth nothing if the two
 *  environments differ (Codex review on PR #2085, round 4).
 */
export const inheritedPtyEnv = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform, delimiter: string): NodeJS.ProcessEnv =>
  withFallbackLocale(sanitizePtyEnv(env, delimiter), platform);

// `env` with a UTF-8 LANG added when it names no locale at all (#1634).
//
// A process launched from a macOS GUI inherits launchd's environment, which carries no
// locale variable, and nothing between there and here supplies one. Everything that decides
// its output encoding from the locale — a TUI over ncurses, python's stdout — then runs as
// if the terminal were ASCII.
//
// The underscores that #1634 reported are NOT this: those come from the tmux client, which
// tmux.ts fixes with `-u` on every platform. This is the same environment seen by everything
// else in the session.
//
// macOS only, deliberately. The empty-locale environment is launchd's doing, and macOS is
// where the fallback name is certain to resolve; a Linux box that names no locale often has
// no en_US.UTF-8 either, and there we would be trading a silent C locale for a failing one.
// Windows has neither the convention nor tmux, and git-bash reads LANG.
//
// Only when there is NO name: LC_ALL and LC_CTYPE outrank LANG, so writing LANG could not
// change a machine that has one, and a user's own `LANG=ja_JP.UTF-8` has to survive. An
// empty value does not count as a name — a login shell can export a bare `LANG=` beside a
// real LC_ALL.
//
// Names matched exactly, not the case-insensitive way envValue does it: Windows is already
// out, and everywhere else `lang` is simply a different variable from `LANG`.
export function withFallbackLocale(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  if (platform !== "darwin") return env;
  if (LOCALE_NAMES.some((name) => (env[name] ?? "") !== "")) return env;
  return { ...env, LANG: FALLBACK_LOCALE };
}

// A copy of `env` safe to hand to a spawned PTY: launcher vars dropped, PATH
// (any casing — Windows uses "Path") cleaned. Never mutates the input.
export function sanitizePtyEnv(env: NodeJS.ProcessEnv, delimiter: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (isLauncherEnvVar(name)) continue;
    out[name] = isPathVar(name) && value !== undefined ? sanitizePathEntries(value, delimiter) : value;
  }
  return out;
}
