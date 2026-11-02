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
  "_volta_tool_recursion", // `volta run` marks its node; a shim that sees it skips Volta's version choice (#3233)
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

/** A PATH entry as the platform's own search will see it.
 *
 *  Windows entries may be QUOTED — `"C:\Program Files\tools"` — and `windowsSearchDirectories`
 *  strips the pair before looking inside, so the quotes are punctuation there rather than part of
 *  the name. On POSIX nothing dequotes, and a directory may legally BE named with them. */
const asSearched = (entry: string, platform: NodeJS.Platform): string => (platform === "win32" ? entry.replace(/^"(.*)"$/, "$1") : entry);

// Is this PATH entry a run-script injection? yarn v1 prepends a temp dir with a
// `node` shim, and both yarn and npm prepend node_modules/.bin + npm's
// node-gyp-bin dirs. Matched on the entry's LAST segment: a directory that
// merely contains one of these names somewhere in its path is the user's.
//
// Matched on the DEQUOTED entry on Windows, because that is what the search matches. Comparing the
// quoted spelling let `"…\node_modules\.bin"` through — the exact directory this function exists to
// remove, kept by its punctuation — and `windowsSearchDirectories` then searched it anyway.
export function isLauncherPathEntry(entry: string, platform: NodeJS.Platform = process.platform): boolean {
  const segments = asSearched(entry, platform)
    .split(/[\\/]/)
    .filter((segment) => segment !== "");
  if (segments.length === 0) return false; // "" and "/" name no directory of ours
  const last = segments[segments.length - 1];
  if (last === undefined) return false; // unreachable: length was checked above
  const parent = segments[segments.length - 2];
  return YARN_SHIM_DIR.test(last) || (last === ".bin" && parent === "node_modules") || last === "node-gyp-bin";
}

// `volta run` prepends the image dir of the tool it picked — `<volta>/tools/image/node/24.21.0/bin`, or
// `…\tools\image\node\24.21.0` on Windows. A cell that keeps it runs that `node`/`npm` directly, past
// the shim and so past a project's `volta` pin. It goes only beside Volta's own shim dir
// (`<volta>/bin`), which still finds a `node`; without one the image dir may be the only way to it.
const VOLTA_IMAGE_TOOLS = new Set(["node", "npm", "yarn", "pnpm"]);

// A leading "" stays: it is the root, and `/tools/bin` is not `tools/bin`. POSIX splits on "/" only —
// a backslash is a legal character in a directory name there.
const pathSegments = (entry: string, platform: NodeJS.Platform): string[] =>
  asSearched(entry, platform)
    .split(platform === "win32" ? /[\\/]/ : "/")
    .filter((segment, index) => segment !== "" || index === 0);

// Segments joined, case folded where the platform folds it, so two spellings of one dir compare equal.
const pathKey = (segments: readonly string[], platform: NodeJS.Platform): string => {
  const joined = segments.join("/");
  return platform === "win32" ? joined.toLowerCase() : joined;
};

// The key of the Volta shim dir an image entry belongs to, or null when the entry is not an image dir.
function voltaShimDirKeyOf(entry: string, platform: NodeJS.Platform): string | null {
  const segments = pathSegments(entry, platform);
  const folded = segments.map((segment) => (platform === "win32" ? segment.toLowerCase() : segment));
  const end = folded[folded.length - 1] === "bin" ? folded.length - 1 : folded.length;
  const isImageDir = end >= 4 && folded[end - 4] === "tools" && folded[end - 3] === "image" && VOLTA_IMAGE_TOOLS.has(folded[end - 2] ?? "");
  return isImageDir ? pathKey([...segments.slice(0, end - 4), "bin"], platform) : null;
}

// PATH with the run-script injections removed; everything else (nvm, homebrew,
// system dirs) kept in order.
export function sanitizePathEntries(pathValue: string, delimiter: string, platform: NodeJS.Platform = process.platform): string {
  const entries = pathValue.split(delimiter);
  const present = new Set(entries.map((entry) => pathKey(pathSegments(entry, platform), platform)));
  const isImageDirBesideShims = (entry: string): boolean => {
    const shimDirKey = voltaShimDirKeyOf(entry, platform);
    return shimDirKey !== null && present.has(shimDirKey);
  };
  return entries.filter((entry) => !isLauncherPathEntry(entry, platform) && !isImageDirBesideShims(entry)).join(delimiter);
}

// Read in this order by every locale-aware program; the first non-empty one wins.
const LOCALE_NAMES = ["LC_ALL", "LC_CTYPE", "LANG"];

// Shipped with every macOS, which is what makes naming it safe — a locale that is not
// installed leaves setlocale failing, and the programs that report that (perl loudest)
// would be noisier than the empty environment they started from.
const FALLBACK_LOCALE = "en_US.UTF-8";

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
export function sanitizePtyEnv(env: NodeJS.ProcessEnv, delimiter: string, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (isLauncherEnvVar(name)) continue;
    out[name] = isPathVar(name) && value !== undefined ? sanitizePathEntries(value, delimiter, platform) : value;
  }
  return out;
}
