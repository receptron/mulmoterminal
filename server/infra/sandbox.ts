// Docker sandbox for the SINGLE-VIEW interactive Claude session (opt-in, default off).
// Runs `claude` inside a container to CONTAIN it: it can't reach the host filesystem
// outside the bind-mounts, host processes, or arbitrary host ports. It is NOT full
// isolation — the project directory and ~/.claude are bind-mounted READ-WRITE by design
// (Claude edits your code and writes its transcript/auth), so those specific host paths
// stay mutable from inside. The container reaches the host's GUI MCP + activity hooks
// over host.docker.internal. The grid keeps its host + tmux path — sandbox and tmux are
// alternative spawn wrappers.
//
// Verified in Phase 0 (#202): a sandboxed claude authenticates via the mounted ~/.claude
// and connects to the host GUI MCP over host.docker.internal.
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import pty from "node-pty";
import { spawnCapture } from "./spawnCapture.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const IMAGE = process.env.MULMOTERMINAL_SANDBOX_IMAGE || "mulmoterminal-sandbox";
const CONTAINER_HOME = "/home/node";

// The hostname a container uses to reach the host (Docker Desktop provides it natively;
// Linux gets it via `--add-host host.docker.internal:host-gateway`).
export const SANDBOX_HOST = "host.docker.internal";

// Opt-in, default off. Enable with MULMOTERMINAL_SANDBOX=1.
export function sandboxEnabled(): boolean {
  const v = process.env.MULMOTERMINAL_SANDBOX;
  return v === "1" || v === "true";
}

// macOS only for Phase 1 (the only platform verified). Docker Desktop maps bind-mount
// ownership transparently there, so running as the image's uid 1000 Just Works. Linux is
// gated off because the spawn passes no `--user`, so bind-mounted host files would be
// written as uid 1000 (ownership failures on non-1000 hosts — proper uid mapping is a
// follow-up, #202). Windows is gated off because the same-path mount (`-v <cwd>:<cwd>`)
// isn't a valid Linux container path. Both fall back to the host spawn.
export function sandboxPlatformSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

// Rewrite a host-loopback URL so it's reachable from inside the container. Same regex
// MulmoClaude uses: anchored at the scheme, only localhost/127.0.0.1 followed by :/ or end.
export function rewriteLoopbackForDocker(url: string): string {
  return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/, `$1${SANDBOX_HOST}`);
}

export const sandboxContainerName = (sessionId: string): string => `mulmoterminal-${sessionId}`;

// Bin as a parameter (not a spawn-of-a-string-literal), mirroring server/gh.ts + tmux.ts.
function run(bin: string, args: string[]): { status: number | null } {
  return { status: spawnSync(bin, args, { stdio: "ignore" }).status };
}

// Like run(), but inherits stdio so the user sees the (slow, one-time) image build.
function runInherit(bin: string, args: string[]): { status: number | null } {
  return { status: spawnSync(bin, args, { stdio: "inherit" }).status };
}

// Is Docker usable (daemon reachable)? Only a POSITIVE result is cached — a failed check
// (e.g. the daemon still starting when the server boots) is retried on the next spawn, so
// transient unavailability doesn't permanently disable sandboxing until a restart.
let cachedDockerOk = false;
export function dockerAvailable(): boolean {
  if (!cachedDockerOk) cachedDockerOk = run("docker", ["info"]).status === 0;
  return cachedDockerOk;
}

// The Dockerfile shipped with the package (package.json `files`), resolved relative to
// this module like plugins-registry.ts does: <pkg>/server/sandbox.ts → <pkg>/Dockerfile.sandbox.
// Works in dev and in an npm install.
// ../.. climbs server/infra/ → server/ → package root, where Dockerfile.sandbox lives.
const DOCKERFILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "Dockerfile.sandbox");
// The Dockerfile's sha256 is stored as an image label so a changed Dockerfile rebuilds.
const IMAGE_SHA_LABEL = "mulmoterminal.dockerfile.sha256";

// Is the sandbox image present locally? The gate checks this so a missing image falls
// back to the host spawn instead of a cryptic `docker run` failure ("Unable to find image").
export function sandboxImageExists(): boolean {
  return run("docker", ["image", "inspect", IMAGE]).status === 0;
}

function builtImageSha(): string {
  const r = spawnCapture("docker", ["image", "inspect", IMAGE, "--format", `{{index .Config.Labels "${IMAGE_SHA_LABEL}"}}`]);
  return r.status === 0 ? r.stdout.trim() : "";
}

// Build the sandbox image when it's missing or the Dockerfile changed since the last build.
// Blocking (~1 min on first build) — call ONCE at startup, never per spawn. Returns whether
// the image is ready afterwards; a failed build (e.g. offline) leaves the gate to fall back
// to the host spawn. If the Dockerfile isn't shipped, we can't build — report existing state.
export function ensureSandboxImage(): boolean {
  if (!existsSync(DOCKERFILE)) return sandboxImageExists();
  const sha = createHash("sha256").update(readFileSync(DOCKERFILE)).digest("hex");
  if (sandboxImageExists() && builtImageSha() === sha) return true;
  console.log("[sandbox] building the sandbox image (first run / Dockerfile changed — takes ~1 min)...");
  // Tiny, secret-free build context: the Dockerfile COPYs nothing, so hand docker a dir
  // holding only it — NOT SANDBOX_DIR, which holds credentials. `--load` for the buildx driver.
  const ctx = path.join(SANDBOX_DIR, "build");
  mkdirSync(ctx, { recursive: true });
  copyFileSync(DOCKERFILE, path.join(ctx, "Dockerfile"));
  return runInherit("docker", ["build", "-t", IMAGE, "--label", `${IMAGE_SHA_LABEL}=${sha}`, "--load", ctx]).status === 0;
}

// A per-session ~/.claude.json for the container. We deliberately do NOT mount the
// host's ~/.claude.json: it records a `native` install at ~/.local/bin (which doesn't
// exist in the container, so claude warns "missing or broken"), and mounting it
// read-write would let the container mutate the user's global config. Instead we mount
// auth via ~/.claude (the dir) — overlaid with the live Keychain credential (see
// writeSandboxCredentials) — plus a minimal generated config that marks onboarding done
// and pre-trusts the workspace (so no theme / trust prompts). Under the app's own
// (user-owned) home, not a world-writable temp dir.
const SANDBOX_DIR = path.join(os.homedir(), ".mulmoterminal", "sandbox");
export function sandboxClaudeConfigPath(sessionId: string): string {
  return path.join(SANDBOX_DIR, `claude-${sessionId}.json`);
}

export function writeSandboxClaudeConfig(sessionId: string, cwd: string): string {
  mkdirSync(SANDBOX_DIR, { recursive: true });
  const file = sandboxClaudeConfigPath(sessionId);
  const config = {
    hasCompletedOnboarding: true,
    theme: "dark",
    hasSeenAutoModeEntryWarning: true,
    // cwd is mounted at its SAME path in the container, so this key matches there.
    projects: {
      [cwd]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, projectOnboardingSeenCount: 1, allowedTools: [] },
    },
  };
  writeFileSync(file, JSON.stringify(config));
  return file;
}

// The macOS Keychain service Claude Code stores its OAuth credential under. On macOS
// the LIVE token lives here — NOT in ~/.claude/.credentials.json, which is often absent
// or stale. The container can't read the Keychain, so we export the current credential
// to a per-session file and overlay it read-only onto the mounted
// ~/.claude/.credentials.json (see buildDockerRunArgs). The host's own file is never
// touched. macOS-only: `security` doesn't exist elsewhere, and the sandbox is
// darwin-gated anyway.
const KEYCHAIN_CREDENTIAL_SERVICE = "Claude Code-credentials";

export function sandboxCredentialsPath(sessionId: string): string {
  return path.join(SANDBOX_DIR, `creds-${sessionId}.json`);
}

// macOS Claude Code refreshes its OAuth token into the KEYCHAIN, never into
// ~/.claude/.credentials.json. So the value we export can be an EXPIRED token the host
// hasn't been prompted to refresh yet — the container then reads it and 401s ("Not
// logged in"). These helpers detect that and force the host CLI to refresh before export.

const EXPIRY_MARGIN_MS = 60_000; // treat a token as expired 60s early
const RENEWAL_TIMEOUT_MS = 30_000; // give the host claude this long to refresh
const RENEWAL_INPUT_DELAY_MS = 3_000; // let the CLI reach its prompt before typing
const RENEWAL_POLL_INTERVAL_MS = 500; // how often to re-check the Keychain for a fresh token

// The token's expiry (ISO string) from the raw Keychain blob, or null when the JSON is
// unparseable or carries none. JSON.parse yields `any`, so narrow once here.
export function readExpiresAt(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const oauth = parsed.claudeAiOauth;
  if (!isRecord(oauth)) return null;
  return typeof oauth.expiresAt === "string" || typeof oauth.expiresAt === "number" ? String(oauth.expiresAt) : null;
}

// Is the credential's access token expired (with the safety margin)? Unparseable or
// missing expiry counts as expired, so we err toward forcing a refresh.
export function isTokenExpired(raw: string): boolean {
  const expiresAt = readExpiresAt(raw);
  if (!expiresAt) return true;
  const expiresMs = new Date(isNaN(Number(expiresAt)) ? expiresAt : Number(expiresAt)).getTime();
  if (isNaN(expiresMs)) return true;
  return Date.now() >= expiresMs - EXPIRY_MARGIN_MS;
}

// The current Keychain token, or "" if the entry is absent / unreadable.
function readKeychainCredential(): string {
  const r = spawnCapture("security", ["find-generic-password", "-s", KEYCHAIN_CREDENTIAL_SERVICE, "-w"]);
  return r.status === 0 ? r.stdout.trim() : "";
}

// Spawn the host `claude` in a PTY and nudge it into an API call, which makes the CLI
// refresh its expired OAuth token and write the fresh one back to the Keychain. Success
// is detected by POLLING the Keychain for a no-longer-expired token — locale-agnostic and
// authoritative (vs. scraping the CLI's prose, which varies by language). Resolves true
// once the token is fresh, false on timeout. Best-effort — never throws.
function renewViaHostClaude(claudeBin: string): Promise<boolean> {
  return new Promise((resolve) => {
    let proc: import("node-pty").IPty;
    try {
      proc = pty.spawn(claudeBin, [], { name: "xterm-color", cols: 80, rows: 30, cwd: process.cwd(), env: process.env });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      resolve(ok);
    };
    const poll = setInterval(() => {
      const cred = readKeychainCredential();
      if (cred && !isTokenExpired(cred)) finish(true);
    }, RENEWAL_POLL_INTERVAL_MS);
    const timer = setTimeout(() => finish(false), RENEWAL_TIMEOUT_MS);
    setTimeout(() => {
      if (!settled) proc.write("hi\r");
    }, RENEWAL_INPUT_DELAY_MS);
  });
}

// Before a sandbox spawn: if the Keychain's token is expired, drive the host CLI to
// refresh it so writeSandboxCredentials exports a LIVE token. No-op off macOS, when the
// token is still valid, or when there's nothing in the Keychain. Never throws — a failed
// renewal just leaves the (stale) token, and the caller still spawns with a warning.
export async function refreshHostKeychainIfExpired(claudeBin: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const credential = readKeychainCredential();
  if (!credential || !isTokenExpired(credential)) return;
  console.log("[sandbox] Keychain access token expired — asking the host claude to refresh it...");
  const renewed = await renewViaHostClaude(claudeBin);
  if (!renewed || isTokenExpired(readKeychainCredential()))
    console.warn("[sandbox] token refresh did not complete — the container may show 'Not logged in'. Run `claude` on the host to log in.");
  else console.log("[sandbox] token refreshed.");
}

// Export the host's live Claude credential from the macOS Keychain to a 0600 per-session
// file for the container to mount. Returns the path, or null when the Keychain has no
// entry (never logged in) or on a non-macOS host — the caller then spawns without the
// overlay, falling back to whatever ~/.claude/.credentials.json holds.
export function writeSandboxCredentials(sessionId: string): string | null {
  if (process.platform !== "darwin") return null;
  const r = spawnCapture("security", ["find-generic-password", "-s", KEYCHAIN_CREDENTIAL_SERVICE, "-w"]);
  const credential = r.status === 0 ? r.stdout.trim() : "";
  if (!credential) return null;
  mkdirSync(SANDBOX_DIR, { recursive: true });
  const file = sandboxCredentialsPath(sessionId);
  writeFileSync(file, credential, { mode: 0o600 });
  chmodSync(file, 0o600); // writeFileSync's mode only applies on creation; enforce it if the file pre-existed
  return file;
}

// Best-effort teardown: force-remove the container (killing the `docker run` client
// alone can leave it behind) and delete the throwaway per-session config + credential.
// Used before a spawn (clear stale) and on reap.
export function cleanupSandbox(sessionId: string): void {
  run("docker", ["rm", "-f", sandboxContainerName(sessionId)]);
  rmSync(sandboxClaudeConfigPath(sessionId), { force: true });
  rmSync(sandboxCredentialsPath(sessionId), { force: true });
}

// --- Opt-in host credentials for the sandbox ---
// A FIXED allowlist: the user picks names via SANDBOX_MOUNT_CONFIGS (comma-separated),
// never arbitrary paths, and each is mounted READ-ONLY. macOS-scoped like the sandbox.
const CONFIG_MOUNTS: Record<string, { host: () => string; container: string }> = {
  gh: { host: () => path.join(os.homedir(), ".config", "gh"), container: `${CONTAINER_HOME}/.config/gh` },
  gitconfig: { host: () => path.join(os.homedir(), ".gitconfig"), container: `${CONTAINER_HOME}/.gitconfig` },
};

// Known allowlist names from the csv; unknown names dropped and duplicates collapsed
// (a repeated name would otherwise emit a duplicate -v mount and fail `docker run`).
export function parseMountConfigNames(csv: string | undefined): string[] {
  const names = (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    // Object.hasOwn, not `in`: `in` would accept prototype keys (__proto__, constructor,
    // toString) whose CONFIG_MOUNTS[name] has no .host() → a startup crash from env input.
    .filter((s) => Object.hasOwn(CONFIG_MOUNTS, s));
  return [...new Set(names)];
}

// gh on macOS keeps its token in the Keychain (not ~/.config/gh/hosts.yml), so mounting
// the config dir alone won't authenticate gh / git-over-https. Best-effort: pass the
// token as GH_TOKEN so it works inside the container.
function ghTokenArgs(): string[] {
  const r = spawnCapture("gh", ["auth", "token"]);
  const token = r.status === 0 ? r.stdout.trim() : "";
  return token ? ["-e", `GH_TOKEN=${token}`] : [];
}

// Docker Desktop (macOS) exposes the host ssh-agent at this fixed in-VM socket path.
const DESKTOP_SSH_SOCK = "/run/host-services/ssh-auth.sock";

// Extra `docker run` args for opt-in host credentials (all env-gated + read-only). Only
// reached from buildDockerRunArgs (the sandbox path), so it has no effect otherwise.
export function resolveSandboxAuthArgs(): string[] {
  const args: string[] = [];
  for (const name of parseMountConfigNames(process.env.SANDBOX_MOUNT_CONFIGS)) {
    const m = CONFIG_MOUNTS[name];
    const host = m.host();
    if (existsSync(host)) args.push("-v", `${host}:${m.container}:ro`);
    if (name === "gh") args.push(...ghTokenArgs());
  }
  if (process.env.SANDBOX_SSH_AGENT_FORWARD === "1") {
    // The socket lives inside Docker Desktop's VM, not the host FS — don't existsSync it.
    // `:ro` keeps the read-only guarantee; agent forwarding is socket I/O, not file writes.
    args.push("-v", `${DESKTOP_SSH_SOCK}:/ssh-agent:ro`, "-e", "SSH_AUTH_SOCK=/ssh-agent");
  }
  return args;
}

// The `docker run` argv that runs interactive `claude` in the sandbox. The workspace is
// bind-mounted at its SAME absolute path so claude's transcript encodes identically to
// the host (~/.claude/projects/<encoded-cwd>) — resume interoperates with host sessions.
// ~/.claude (dir) is mounted for auth + transcripts; `credentialsPath` (when set)
// overlays the live Keychain credential onto ~/.claude/.credentials.json; `claudeConfigPath`
// is the generated per-session ~/.claude.json. `claudeArgs` already have their
// --settings/--mcp-config URLs rewritten to host.docker.internal by the caller.
export function buildDockerRunArgs(
  sessionId: string,
  claudeArgs: string[],
  cwd: string,
  claudeConfigPath: string,
  credentialsPath: string | null = null,
): string[] {
  const claudeDir = path.join(os.homedir(), ".claude");
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    sandboxContainerName(sessionId),
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    `HOME=${CONTAINER_HOME}`,
    "-e",
    "DISABLE_AUTOUPDATER=1", // ephemeral container — never self-update the CLI
    "-v",
    `${cwd}:${cwd}`,
    "-v",
    `${claudeDir}:${CONTAINER_HOME}/.claude`,
    // Overlay the live Keychain credential over the dir mount's possibly-stale
    // ~/.claude/.credentials.json — a deeper bind-mount target shadows the file inside
    // the dir mount. NOT read-only: if the token expires mid-session the container's
    // claude refreshes it and must persist the new one. The mount target is our
    // throwaway per-session copy (creds-<sid>.json), so that write never touches the
    // host Keychain or the host's own credentials file. Absent → no overlay.
    ...(credentialsPath ? ["-v", `${credentialsPath}:${CONTAINER_HOME}/.claude/.credentials.json`] : []),
    "-v",
    `${claudeConfigPath}:${CONTAINER_HOME}/.claude.json`,
    // Opt-in host credentials (gh / gitconfig / SSH agent) — empty unless env-enabled.
    ...resolveSandboxAuthArgs(),
    "-w",
    cwd,
    IMAGE,
    "claude",
    ...claudeArgs,
  ];
}
