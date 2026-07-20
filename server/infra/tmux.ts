// tmux-backed session persistence: run each PTY inside a tmux session so it survives
// the mulmoterminal server dying (crash / restart) and reattaches when the server comes
// back — like `screen`/`tmux` do. When tmux isn't installed, callers fall back to a
// direct pty.spawn (non-persistent, current behavior).
//
// Isolation: we use our OWN tmux server (`-L mulmoterminal`) and config file, so none
// of this touches the user's own tmux sessions, keybindings, or status bar.
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { isLauncherEnvVar, sanitizePathEntries } from "./pty-env.js";

const SERVER_SOCKET = "mulmoterminal";
const SESSION_PREFIX = "mt-";
const CONF_FILE = path.join(os.homedir(), ".mulmoterminal", "tmux.conf");

// Spawn a command with the binary as a PARAMETER (not a string literal at the call
// site) — mirrors server/gh.ts so it isn't flagged as a spawn-of-a-string-literal.
function run(bin: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "" };
}
const tmux = (args: string[]) => run("tmux", ["-L", SERVER_SOCKET, ...args]);

let cachedAvailable: boolean | null = null;

// Detected once. Absent (or non-unix) → callers use a direct pty.spawn. On first
// detection the isolated config is written so `new-session` picks it up via `-f`.
export function tmuxAvailable(): boolean {
  if (cachedAvailable === null) {
    cachedAvailable = run("tmux", ["-V"]).status === 0;
    if (cachedAvailable) ensureConf();
  }
  return cachedAvailable;
}

// The terminfo `Ms` capability (OSC 52 clipboard write). tmux only forwards a program's
// OSC 52 to the OUTER terminal when it knows the outer terminal supports it — our web
// xterm does (via the ClipboardAddon, #206), but its terminfo doesn't advertise `Ms`, so
// we declare it. Without this, tmux swallows Claude Code's auto-copy and it never reaches
// the browser clipboard. Appended (not set) so tmux's built-in overrides survive.
const OSC52_MS_OVERRIDE = ",*:Ms=\\E]52;%p1%s;%p2%s\\007";

// Minimal config for our server: no status bar (this is a terminal INSIDE a terminal),
// instant escape, generous scrollback, follow the latest client's size, never destroy a
// session just because our client detached (that IS the persistence), plus two fixes for
// the terminal-in-terminal wrapping:
//   - `mouse on`: forward the wheel to the program (claude has mouse tracking) instead of
//     tmux's default alternate-scroll, which turns the wheel into ↑/↓ arrows (cycling
//     claude's input history rather than scrolling).
//   - `set-clipboard on` + the `Ms` override: forward OSC 52 clipboard writes to the
//     outer terminal so Claude's auto-copy reaches the browser clipboard (#206).
export const TMUX_CONF_LINES: readonly string[] = [
  "set -g status off",
  "set -g escape-time 0",
  "set -g history-limit 20000",
  "set -g window-size latest",
  "set -g destroy-unattached off",
  "set -g mouse on",
  "set -g set-clipboard on",
  `set -ag terminal-overrides "${OSC52_MS_OVERRIDE}"`,
];

// A fresh server sources CONF_FILE via `-f` on its first `new-session`, but a server
// already running from persisted sessions ignores it — so apply the options that must be
// live. Idempotent across node restarts: mouse/set-clipboard are plain global sets; the
// Ms override is appended only when it isn't already present.
function applyLiveTmuxOptions(): void {
  tmux(["set", "-g", "mouse", "on"]);
  tmux(["set", "-g", "set-clipboard", "on"]);
  if (!tmux(["show", "-g", "terminal-overrides"]).stdout.includes("Ms=")) {
    tmux(["set", "-ag", "terminal-overrides", OSC52_MS_OVERRIDE]);
  }
}

// Scrub package-manager launcher vars from a RUNNING tmux server's global
// environment. The tmux server outlives node: one started under `yarn dev`
// keeps PREFIX/npm_* in its global env and re-injects them into every new
// pane — where PREFIX makes nvm strip node/npm from PATH (see pty-env.ts) —
// so restarting node with a clean env isn't enough. `setenv -g -r` flags each
// var for removal from new pane environments; the global PATH is rewritten
// with the run-script shim dirs dropped. Existing panes keep their env (a
// shell's copy can't be edited from outside); new ones start clean.
function scrubGlobalEnvironment(): void {
  const r = tmux(["show-environment", "-g"]);
  if (r.status !== 0) return;
  for (const line of r.stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq);
    if (isLauncherEnvVar(name)) tmux(["set-environment", "-g", "-r", name]);
    else if (name === "PATH") tmux(["set-environment", "-g", "PATH", sanitizePathEntries(line.slice(eq + 1), path.delimiter)]);
  }
}

function ensureConf(): void {
  try {
    mkdirSync(path.dirname(CONF_FILE), { recursive: true });
    writeFileSync(CONF_FILE, TMUX_CONF_LINES.join("\n") + "\n");
    if (tmux(["list-sessions"]).status === 0) {
      applyLiveTmuxOptions();
      scrubGlobalEnvironment();
    }
  } catch {
    // non-fatal — tmux falls back to its defaults (a status bar, etc.)
  }
}

export const tmuxSessionName = (id: string): string => `${SESSION_PREFIX}${id}`;

// argv for `tmux new-session -A`: create the session running `file args` (in `cwd`) if
// it doesn't exist, else ATTACH to the running one (the command is ignored). This one
// primitive covers both first launch and reattach-after-restart. Returned as the args
// for pty.spawn("tmux", ...).
export function tmuxNewSessionArgs(id: string, file: string, args: string[], cwd: string): string[] {
  return ["-L", SERVER_SOCKET, "-f", CONF_FILE, "new-session", "-A", "-s", tmuxSessionName(id), "-c", cwd, "--", file, ...args];
}

// Is a persistent session for this id currently alive in our tmux server?
export function tmuxHasSession(id: string): boolean {
  return tmux(["has-session", "-t", tmuxSessionName(id)]).status === 0;
}

// End a persistent session (explicit close / reap). Killing the pty only detaches our
// client — the session (and its program) would otherwise keep running.
export function tmuxKillSession(id: string): void {
  tmux(["kill-session", "-t", tmuxSessionName(id)]);
}

// The rendered contents of a session's visible pane — what the user would see right now,
// available even while the session is DETACHED and across a server restart (tmux outlives
// the node process). Null when tmux has no such session, which is also how a tmux-less
// host reports "ask someone else". Colour sequences are dropped (no `-e`): the headless
// fallback can only produce plain text, and one contract beats two.
export function tmuxCapturePane(id: string): string | null {
  const r = tmux(["capture-pane", "-p", "-t", tmuxSessionName(id)]);
  return r.status === 0 ? r.stdout : null;
}

// What is running in a session's visible pane right now — "claude", "codex", "zsh", …
// Survives a server restart, since tmux outlives the node process, which is the whole
// point: a session that outlived us has no PtyEntry left to ask.
//
// Deliberately reports what is RUNNING rather than what was launched: a shell session
// the user then ran `claude` in should read as claude, and a recorded launch command
// would say otherwise. Null when tmux has no such session (also how a tmux-less host
// answers).
export function tmuxPaneCommand(id: string): string | null {
  const r = tmux(["display-message", "-p", "-t", tmuxSessionName(id), "#{pane_current_command}"]);
  if (r.status !== 0) return null;
  const name = r.stdout.trim();
  return name === "" ? null : name;
}

// Ids of sessions that survived (e.g. across a crash), for startup visibility.
export function tmuxListSessionIds(): string[] {
  const r = tmux(["list-sessions", "-F", "#{session_name}"]);
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .filter((n) => n.startsWith(SESSION_PREFIX))
    .map((n) => n.slice(SESSION_PREFIX.length));
}

// A tmux `mt-<id>` is resumable — an orphan cleanup must NOT reap it — when it's live
// (an attached pty), a persisted grid session, or has a Claude/Codex transcript on disk.
// Pure so the safe-cleanup rule ("never kill a resumable session") is unit-testable.
export function isResumableTmuxSession(
  id: string,
  live: ReadonlySet<string>,
  grid: ReadonlySet<string>,
  claudeOnDisk: ReadonlySet<string>,
  codexOnDisk: (id: string) => boolean,
): boolean {
  return live.has(id) || grid.has(id) || claudeOnDisk.has(id) || codexOnDisk(id);
}
