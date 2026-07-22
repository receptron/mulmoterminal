// tmux-backed session persistence: run each PTY inside a tmux session so it survives
// the mulmoterminal server dying (crash / restart) and reattaches when the server comes
// back — like `screen`/`tmux` do. When tmux isn't installed, callers fall back to a
// direct pty.spawn (non-persistent, current behavior).
//
// Isolation: we use our OWN tmux server (`-L mulmoterminal`) and config file, so none
// of this touches the user's own tmux sessions, keybindings, or status bar.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { isLauncherEnvVar } from "./pty-env.js";
import { spawnCapture } from "./spawnCapture.js";

const SERVER_SOCKET = "mulmoterminal";
const SESSION_PREFIX = "mt-";
const CONF_FILE = path.join(os.homedir(), ".mulmoterminal", "tmux.conf");

const tmux = (args: string[]) => spawnCapture("tmux", ["-L", SERVER_SOCKET, ...args]);

let cachedAvailable: boolean | null = null;

// Detected once. Absent (or non-unix) → callers use a direct pty.spawn. On first
// detection the isolated config is written so `new-session` picks it up via `-f`.
export function tmuxAvailable(): boolean {
  if (cachedAvailable === null) {
    cachedAvailable = spawnCapture("tmux", ["-V"]).status === 0;
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

// The two line shapes `show-environment` emits. Anything else continues the
// previous value: env values may contain newlines — an exported bash function is
// the common case — and a naive line split reads those continuations as variable
// names. The format is ambiguous at the margin (a continuation that is itself
// flush-left `NAME=…` is indistinguishable from a real assignment); these
// patterns resolve everything a shell profile realistically produces.
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;
const ENV_FLAGGED_REMOVED = /^-[A-Za-z_]\w*$/;

// `show-environment` output → name/value pairs. Vars flagged for removal carry
// no value and are omitted, as are names outside the patterns above (an exported
// bash function's `BASH_FUNC_x%%`): we only ever act on plainly-named vars, so
// skipping what we can't parse is the safe outcome. Pure, hence unit-testable.
export function parseTmuxEnvironment(stdout: string): Map<string, string> {
  const entries = new Map<string, string>();
  let current: string | null = null;
  for (const line of stdout.replace(/\n$/, "").split("\n")) {
    if (ENV_ASSIGNMENT.test(line)) {
      const eq = line.indexOf("=");
      current = line.slice(0, eq);
      entries.set(current, line.slice(eq + 1));
    } else if (ENV_FLAGGED_REMOVED.test(line)) {
      current = null;
    } else if (current !== null) {
      entries.set(current, `${entries.get(current)}\n${line}`);
    }
  }
  return entries;
}

// Scrub package-manager launcher vars from a RUNNING tmux server's global
// environment. The tmux server outlives node: one started under `yarn dev` keeps
// PREFIX/npm_* in its global env and hands them to every new pane — where PREFIX
// makes nvm strip node/npm from PATH (see pty-env.ts) — so restarting node with a
// clean env isn't enough. `set-environment -r` flags each var for removal from
// new pane environments. Existing panes keep their env (a running shell's copy
// can't be edited from outside); panes created from here on start clean.
//
// PATH is deliberately NOT rewritten here. Measured on tmux 3.6a: a new pane takes
// PATH from the CLIENT that spawns it, never from the server's environment (global
// `/GLOBAL/only` + client `/CLIENT/only` → the pane gets `/CLIENT/only`), so a
// clean PATH written here would have no effect. Our client is spawnPty, whose env
// sanitizePtyEnv already cleans.
//
// Session environments need no scrub either: tmux copies only `update-environment`
// vars (DISPLAY, SSH_*, …) into them, never launcher vars.
function scrubGlobalEnvironment(): void {
  const r = tmux(["show-environment", "-g"]);
  if (r.status !== 0) return;
  for (const name of parseTmuxEnvironment(r.stdout).keys()) {
    if (isLauncherEnvVar(name)) tmux(["set-environment", "-g", "-r", name]);
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

// Parse `#{session_attached}`. Its own function so the "unreadable means nobody" rule is
// testable: a caller deciding whether to KILL a session must not read a failure as 0.
export function parseAttachedClientCount(stdout: string): number | null {
  const text = stdout.trim();
  if (text === "") return null; // Number("") is 0 — which would read as "nobody is attached"
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// How many clients are attached to a session, or null when tmux can't say. Each
// mulmoterminal server holds ONE tmux client per live session, so a count above our own
// means ANOTHER server process is holding it — the only cross-process signal we have for
// "someone else would lose this session if we killed it".
export function tmuxAttachedClientCount(id: string): number | null {
  const r = tmux(["display-message", "-p", "-t", tmuxSessionName(id), "#{session_attached}"]);
  return r.status === 0 ? parseAttachedClientCount(r.stdout) : null;
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
