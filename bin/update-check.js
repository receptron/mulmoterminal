// Update-check helpers for the launcher, split out so the version comparison is
// unit-testable. Network calls are best-effort and never throw.

const REGISTRY = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/$/, "");

// Best-effort latest-version lookup. Resolves null on any failure (offline,
// timeout, non-OK, bad payload) so callers never block or break startup.
export async function fetchLatestVersion(pkg = "mulmoterminal") {
  try {
    const res = await fetch(`${REGISTRY}/${pkg}/latest`, {
      signal: AbortSignal.timeout(1500),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

// True if `latest` is a strictly newer major.minor.patch than `current`.
// Pre-release suffixes are ignored and parts are compared numerically (so
// 0.1.10 > 0.1.9, which a lexical compare would get wrong).
export function isNewerVersion(latest, current) {
  const parts = (v) =>
    String(v)
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

// The bundled package.json version only tells you anything for an npm install;
// a git checkout has to be measured against its own remote instead. These two
// installs need different current-versions, different "is there something newer"
// checks, and different upgrade commands — so which one this is decides everything.

// Whether both opt-out switches are respected. NO_UPDATE_NOTIFIER is the
// ecosystem-wide convention; the namespaced one lets you silence only this tool.
export function isUpdateCheckDisabled(env) {
  return Boolean(env.MULMOTERMINAL_NO_UPDATE_CHECK || env.NO_UPDATE_NOTIFIER);
}

// A package living under a node_modules directory was installed by a package
// manager — that covers a global install (…/lib/node_modules/mulmoterminal) and
// one vendored into another project. Only a bare checkout counts as a git
// install, so the tool merely sitting inside some unrelated repo is not mistaken
// for one.
export function hasNodeModulesSegment(pkgDir) {
  return String(pkgDir)
    .split(/[\\/]+/)
    .includes("node_modules");
}

export function classifyInstall(pkgDir, isGitWorkTree) {
  if (hasNodeModulesSegment(pkgDir)) return "npm";
  return isGitWorkTree ? "git" : "npm";
}

// `git ls-remote origin HEAD` prints "<sha>\tHEAD". Return the object id HEAD
// resolves to on the remote, or null if the output carries none — reading it
// from the remote is what avoids a `git fetch` and its lock/auth/network cost.
export function parseLsRemoteHead(stdout) {
  for (const line of String(stdout ?? "").split("\n")) {
    const [sha, ref] = line.split("\t");
    // 40 hex for SHA-1, 64 for a SHA-256 repository — accept both (and anything between,
    // since ls-remote emits the full object id, never an abbreviation).
    if (ref === "HEAD" && /^[0-9a-f]{7,64}$/i.test(sha ?? "")) return sha;
  }
  return null;
}

// The one thing an npm install is told, or null when it is already current.
export function npmUpdateNotice(current, latest) {
  if (!latest || !isNewerVersion(latest, current)) return null;
  return `Update available: ${current} → ${latest}  ·  run: npm i -g mulmoterminal`;
}

// Whether `git status --porcelain` output means a tree too dirty to fast-forward. Untracked
// files (`??`) don't count: build output, .env, logs and other scratch are normal in any
// working clone and `git pull` proceeds past them, so an untracked-only tree is treated as
// clean here — otherwise a checkout that is genuinely behind never hears about it just
// because it has a stray file. Tracked modifications (anything not `??`) are the real block.
export function isTreeDirtyForUpdate(porcelain) {
  return String(porcelain ?? "")
    .split("\n")
    .some((line) => line.trim() !== "" && !line.startsWith("??"));
}

// Whether a git checkout should hear that an update exists, and what to say.
// Silent whenever the notice could not be acted on or trusted: a dirty tree
// cannot fast-forward, a missing sha means local or remote could not be read,
// and equal shas mean it is already current. Only a clean checkout whose HEAD
// differs from the remote's is behind — count is deliberately absent, since
// counting commits needs the objects a `git fetch` would bring and we skip it.
export function gitUpdateNotice({ localSha, localShort, remoteSha, dirty }) {
  if (dirty) return null;
  if (!localSha || !remoteSha || localSha === remoteSha) return null;
  return `Update available: ${localShort || localSha.slice(0, 7)} → origin  ·  run: git pull`;
}
