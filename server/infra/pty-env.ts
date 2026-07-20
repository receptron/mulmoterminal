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

const REMOVED_NAMES = new Set([
  "PREFIX", // Homebrew yarn wrapper; fatal to nvm (see header comment)
  "INIT_CWD",
  "NODE", // npm run points it at the launching node binary
  "PROJECT_CWD", // yarn berry
  "BERRY_BIN_FOLDER", // yarn berry
  "npm_execpath",
  "npm_node_execpath",
  "npm_command",
]);

const REMOVED_PREFIXES = ["npm_config_", "npm_package_", "npm_lifecycle_"];

// Is this env var package-manager launcher context (vs. real user environment)?
// Deliberately narrow: HOMEBREW_PREFIX / CONDA_PREFIX etc. must survive.
export function isLauncherEnvVar(name: string): boolean {
  if (REMOVED_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  return REMOVED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Is this PATH entry a run-script injection? yarn v1 prepends a temp dir with a
// `node` shim (…/T/yarn--<ts>-<rand>) that outlives nothing, and both yarn and
// npm prepend node_modules/.bin + npm's node-gyp-bin dirs.
export function isLauncherPathEntry(entry: string): boolean {
  return /[\\/]yarn--\d/.test(entry) || /[\\/]node_modules[\\/]\.bin$/.test(entry) || /[\\/]node-gyp-bin$/.test(entry);
}

// PATH with the run-script injections removed; everything else (nvm, homebrew,
// system dirs) kept in order.
export function sanitizePathEntries(pathValue: string, delimiter: string): string {
  return pathValue
    .split(delimiter)
    .filter((entry) => !isLauncherPathEntry(entry))
    .join(delimiter);
}

// A copy of `env` safe to hand to a spawned PTY: launcher vars dropped, PATH
// (any casing — Windows uses "Path") cleaned. Never mutates the input.
export function sanitizePtyEnv(env: NodeJS.ProcessEnv, delimiter: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (isLauncherEnvVar(name)) continue;
    out[name] = name.toLowerCase() === "path" && value !== undefined ? sanitizePathEntries(value, delimiter) : value;
  }
  return out;
}
