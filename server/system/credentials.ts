// Export Claude Code's OAuth credentials so the Docker sandbox can authenticate.
//
// On macOS a "native" claude install keeps the OAuth token in the Keychain, not
// in a file — and the Linux container can't reach the Keychain. So host-side we
// read the token out of the Keychain and write it to ~/.claude/.credentials.json
// (mode 0600), which is bind-mounted into the container; the Linux claude there
// is file-based and reads it. Ported from mulmoclaude's server/system/credentials.ts.
//
// Net: Keychain → (renew if expired) → ~/.claude/.credentials.json → bind-mount →
// container reads it. macOS-only; on Linux the file must already exist.
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { join } from "path";
import fs from "fs/promises";

const execFileAsync = promisify(execFile);

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/** Treat tokens as expired 60s before actual expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** Max time to wait for the claude CLI to renew the token. */
const PTY_TIMEOUT_MS = 30_000;
/** Delay before typing into the claude CLI (let its prompt come up). */
const PTY_INPUT_DELAY_MS = 3_000;

interface CredentialsJson {
  claudeAiOauth?: { accessToken?: string; refreshToken?: string; expiresAt?: string };
}

/** Read the raw credentials string from the macOS Keychain (null if absent). */
async function readFromKeychain(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Whether the access token in the credentials JSON is expired (or unparseable). */
function isTokenExpired(raw: string): boolean {
  try {
    const expiresAt = (JSON.parse(raw) as CredentialsJson).claudeAiOauth?.expiresAt;
    if (!expiresAt) return true;
    const expiresMs = new Date(expiresAt).getTime();
    if (Number.isNaN(expiresMs)) return true;
    return Date.now() >= expiresMs - EXPIRY_MARGIN_MS;
  } catch {
    return true;
  }
}

/** Atomic write so the container can't read a half-written file; mode 0600. */
async function writeCredentialsFile(contents: string): Promise<void> {
  const tmp = `${CREDENTIALS_PATH}.tmp-${process.pid}`;
  await fs.writeFile(tmp, contents, { mode: 0o600 });
  await fs.rename(tmp, CREDENTIALS_PATH);
}

/**
 * Spawn `claude` interactively via a PTY to force the CLI to refresh its OAuth
 * token (the CLI writes the new token back to the Keychain). We send "hi" and
 * watch for a real conversational reply as proof the refresh succeeded.
 */
async function renewTokenViaPty(): Promise<boolean> {
  let pty: typeof import("node-pty");
  try {
    pty = await import("node-pty");
  } catch {
    console.error("[credentials] node-pty unavailable — cannot renew token");
    return false;
  }

  return new Promise((resolve) => {
    const proc = pty.spawn("claude", [], { name: "xterm-color", cols: 80, rows: 30, cwd: process.cwd() });
    let responded = false;
    let buffer = "";
    let settled = false;
    // `finish` clears `timeout`, and `timeout`'s callback calls `finish` — a
    // mutual-reference pair that has no const-only spelling. Written once below.
    // eslint-disable-next-line prefer-const -- mutual-reference pair
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      resolve(success);
    };

    timeout = setTimeout(() => {
      console.error(`[credentials] token renewal timed out after ${PTY_TIMEOUT_MS / 1000}s`);
      finish(false);
    }, PTY_TIMEOUT_MS);

    // "hi" as a whole token, then a conversational opener + non-trivial length
    // confirms a real reply (error chunks won't match, so they hit the timeout).
    const ECHO_RE = /\bhi\b/;
    const RESPONSE_PATTERN_RE = /\b(Hello|Hi|I['’]m|I can|How can)\b/i;
    const MIN_RESPONSE_CHARS = 20;
    let echoEndIdx = -1;

    proc.onData((data: string) => {
      buffer += data;
      if (!responded) {
        const match = ECHO_RE.exec(buffer);
        if (match) {
          responded = true;
          echoEndIdx = match.index + match[0].length;
        }
        return;
      }
      const response = buffer.slice(echoEndIdx);
      if (response.length >= MIN_RESPONSE_CHARS && RESPONSE_PATTERN_RE.test(response)) finish(true);
    });

    setTimeout(() => {
      if (!settled) proc.write("hi\r");
    }, PTY_INPUT_DELAY_MS);
  });
}

/**
 * Export the current OAuth credentials from the macOS Keychain to
 * ~/.claude/.credentials.json so the Docker sandbox can authenticate. If the
 * access token is expired, renew it via the claude CLI first. Returns true on
 * success. macOS-only — a no-op (false) elsewhere.
 */
export async function refreshCredentials(opts: { renew?: boolean } = {}): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const renew = opts.renew ?? true;

  try {
    let credentials = await readFromKeychain();
    if (!credentials) {
      console.error("[credentials] no credentials found in macOS Keychain");
      return false;
    }

    if (isTokenExpired(credentials)) {
      if (!renew) {
        // Fast path (per-spawn): don't block on an interactive renewal — write the
        // current creds anyway. The container's claude self-refreshes from the
        // (still-valid) refresh token in the file.
        console.warn("[credentials] access token expired — exporting as-is (container will self-refresh)");
        await writeCredentialsFile(`${credentials}\n`);
        return true;
      }
      console.warn("[credentials] access token expired — launching claude CLI to renew...");
      if (!(await renewTokenViaPty())) {
        console.error("[credentials] token renewal via claude CLI failed");
        return false;
      }
      credentials = await readFromKeychain();
      if (!credentials || isTokenExpired(credentials)) {
        console.error("[credentials] token still expired after renewal");
        return false;
      }
      console.log("[credentials] token renewed");
    }

    await writeCredentialsFile(`${credentials}\n`);
    return true;
  } catch (err) {
    console.error("[credentials] failed to refresh credentials from Keychain:", err);
    return false;
  }
}

/**
 * Ensure ~/.claude/.credentials.json exists before the sandbox needs it. On
 * macOS, exports it from the Keychain. Returns whether credentials are available;
 * the caller decides how loudly to warn (we don't hard-exit — the container's
 * claude may still self-refresh from a mounted refresh token).
 */
export async function ensureCredentialsAvailable(): Promise<boolean> {
  try {
    await fs.access(CREDENTIALS_PATH);
    // File exists; on macOS still refresh so a long-idle token is current.
    if (process.platform === "darwin") return (await refreshCredentials()) || true;
    return true;
  } catch {
    if (process.platform === "darwin") return refreshCredentials();
    console.error("[credentials] missing ~/.claude/.credentials.json — run `claude` to authenticate");
    return false;
  }
}
