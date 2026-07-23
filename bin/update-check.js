// Update-check helpers, split out so the check is unit-testable and can be run from both the
// launcher (console notice) and the server (the header badge — the launcher isn't in the loop
// under `yarn dev`, so the server has to be able to check on its own). Network/git calls are
// best-effort and never throw.
import { spawn } from "node:child_process";

const REGISTRY = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/$/, "");

// Upper bound on every git probe, including the network ls-remote — matches the npm fetch
// timeout so a slow remote can't delay the caller.
const GIT_PROBE_TIMEOUT_MS = 1500;

// Run git inside pkgDir, best-effort. Resolves the trimmed stdout on a clean exit, or null on
// anything else (git absent, non-zero exit, timeout). GIT_TERMINAL_PROMPT=0 turns an auth
// prompt into a fast failure instead of a hang against a private remote.
export function runGit(pkgDir, gitArgs, timeout_ms = GIT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("git", ["-C", pkgDir, ...gitArgs], {
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch {
      return resolve(null);
    }
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout_ms);
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() : null);
    });
  });
}

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

// The remote's default branch, from the "ref: refs/heads/<branch>\tHEAD" line that
// `git ls-remote --symref origin HEAD` prints, or null. `git pull` with no args pulls the
// CURRENT branch's upstream — which isn't the release a clone is behind if you're on some
// other branch. Naming origin + the default branch is what actually updates it, and reading
// the name (rather than hardcoding "main") keeps it right for a "master" remote too.
export function parseLsRemoteDefaultBranch(stdout) {
  const match = String(stdout ?? "").match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m);
  return match ? match[1] : null;
}

// Whether a branch name is safe to drop into a copy/paste shell command. The name comes from
// the remote (`ls-remote --symref`), which is untrusted — git allows `;`, `$`, backticks and
// other shell metacharacters in ref names, so a hostile default branch like `main;rm -rf ~`
// would inject when pasted. Ordinary branch names (main, master, release/2.x) are all letters,
// digits, and `._/-`; anything outside that is refused rather than escaped, so the notice
// falls back to a bare `git pull` instead of showing a weird quoted command.
export function isSafeBranchName(name) {
  return typeof name === "string" && /^[A-Za-z0-9._/-]+$/.test(name);
}

// Whether a git checkout should hear that an update exists, and what to say.
// Silent whenever the notice could not be acted on or trusted: a dirty tree
// cannot fast-forward, a missing sha means local or remote could not be read,
// and equal shas mean it is already current. Only a clean checkout whose HEAD
// differs from the remote's is behind — count is deliberately absent, since
// counting commits needs the objects a `git fetch` would bring and we skip it.
export function gitUpdateNotice({ localSha, localShort, remoteSha, defaultBranch, dirty }) {
  if (dirty) return null;
  if (!localSha || !remoteSha || localSha === remoteSha) return null;
  const pull = isSafeBranchName(defaultBranch) ? `git pull origin ${defaultBranch}` : "git pull";
  return `Update available: ${localShort || localSha.slice(0, 7)} → origin  ·  run: ${pull}`;
}

// ls-remote reaches the network (an SSH/HTTPS handshake to the origin host), so it routinely
// takes several seconds — far longer than a local rev-parse. The default git timeout would
// kill it first and read the checkout as "no remote HEAD" → no notice. Give just that probe
// room; the check is background and best-effort, so waiting a few seconds costs nothing.
const LS_REMOTE_TIMEOUT_MS = 6000;

// The git branch of the check: local HEAD vs the remote's, read with ls-remote so no fetch is
// forced. Silent on a dirty tree (can't fast-forward) or any unreadable probe.
async function gitUpdateNotice_(git) {
  const status = await git(["status", "--porcelain"]);
  if (status === null || isTreeDirtyForUpdate(status)) return null;
  const [localSha, localShort, lsRemote] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", "--short", "HEAD"]),
    git(["ls-remote", "--symref", "origin", "HEAD"], LS_REMOTE_TIMEOUT_MS),
  ]);
  return gitUpdateNotice({
    localSha,
    localShort,
    remoteSha: parseLsRemoteHead(lsRemote),
    defaultBranch: parseLsRemoteDefaultBranch(lsRemote),
    dirty: false,
  });
}

// The whole check, front to back: which install this is, then its notice (or null when
// current). `pkgDir` is where the tool lives — a node_modules dir (→ npm) or a bare checkout
// (→ git). `deps` lets tests drive it without spawning git or hitting the network; production
// callers pass nothing and get the real git/registry probes bound to pkgDir.
export async function computeUpdateNotice(pkgDir, currentVersion, deps = {}) {
  const git = deps.runGit ?? ((args, timeout_ms) => runGit(pkgDir, args, timeout_ms));
  const fetchLatest = deps.fetchLatest ?? fetchLatestVersion;
  const inWorkTree = hasNodeModulesSegment(pkgDir) ? false : (await git(["rev-parse", "--is-inside-work-tree"])) === "true";
  if (classifyInstall(pkgDir, inWorkTree) === "git") return gitUpdateNotice_(git);
  return npmUpdateNotice(currentVersion, await fetchLatest());
}
