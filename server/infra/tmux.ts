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
// The bind port, to tell OUR leaked PORT from the user's own (see isOwnPort). config/ is
// otherwise above this layer; the alternative was threading the same two values through
// tmuxAvailable's four call sites, where a path that forgot them would scrub nothing.
import { PORT } from "../config/env.js";
import { isLauncherEnvVar } from "./pty-env.js";
import { spawnCapture, spawnCaptureAsync } from "./spawnCapture.js";
import { splitLines } from "./split-lines.js";

const SERVER_SOCKET = "mulmoterminal";
const SESSION_PREFIX = "mt-";
const CONF_FILE = path.join(os.homedir(), ".mulmoterminal", "tmux.conf");

const tmux = (args: string[]) => spawnCapture("tmux", ["-L", SERVER_SOCKET, ...args]);
const tmuxAsync = (args: string[]) => spawnCaptureAsync("tmux", ["-L", SERVER_SOCKET, ...args]);

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
// the browser clipboard.
export const MS_OVERRIDE_ENTRY = "*:Ms=\\E]52;%p1%s;%p2%s\\007";
// Appended (not set) so tmux's built-in overrides survive.
const OSC52_MS_OVERRIDE = `,${MS_OVERRIDE_ENTRY}`;

// The wheel inside tmux's own scrollback (copy-mode), one line per report instead of tmux's
// default FIVE (#978). Nothing else in the stack has a five-line step, so this is what a reader
// feels as "it jumps a paragraph at a time" while scrolling a long shell output: a plain shell
// pane has no mouse mode of its own, so tmux's root binding puts the wheel into copy-mode, and
// `send -X -N 5 scroll-up` is what copy-mode does with it.
//
// Only this path changes. A pane running a mouse-tracking program (Claude Code) never reaches
// copy-mode — tmux forwards the report to the program with `send -M` — so the step size there
// stays the program's own. The client compensates for the smaller step with a higher notch rate
// (TRACKPAD_GAIN in src/composables/mouseReports.ts); the two are a matched pair, and changing
// one alone changes the scroll SPEED, not just its smoothness.
//
// Both tables, because which one is live follows `mode-keys` (tmux derives it from $EDITOR), and
// a user with a vi-ish EDITOR would otherwise keep the five-line jump.
//
// `select-pane` is kept from tmux's own default: `send -X` acts on the ACTIVE pane, so dropping it
// would scroll the focused pane when the pointer is over a different split. Nothing this app
// creates is split, but a user can split one by hand, and the wrong pane scrolling is a worse bug
// than the one being fixed.
const WHEEL_SCROLL_TABLES = ["copy-mode", "copy-mode-vi"] as const;
const WHEEL_SCROLL_KEYS = [
  { key: "WheelUpPane", command: "select-pane ; send -X -N 1 scroll-up" },
  { key: "WheelDownPane", command: "select-pane ; send -X -N 1 scroll-down" },
] as const;

// A conf FILE needs the command separator escaped (`\;`), or tmux ends the bind-key there and runs
// the rest as its own command — which binds the key to `select-pane` alone. Passing the command as
// ONE argument is what does the same job for the live rebinding below (an argv `;` is a separator
// there too, and `\;` only reaches tmux as one because a shell would have unescaped it).
const WHEEL_SCROLL_BINDINGS: readonly string[] = WHEEL_SCROLL_TABLES.flatMap((table) =>
  WHEEL_SCROLL_KEYS.map(({ key, command }) => `bind -T ${table} ${key} ${command.replace(" ; ", " \\; ")}`),
);

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
  // Declare that the outer terminal (our web xterm) understands OSC 8 hyperlinks, so tmux
  // FORWARDS them instead of stripping them. Without this, a program's `PR #123`-style
  // hyperlink (Claude Code's statusline, and any OSC 8 link) never reaches xterm and isn't
  // clickable. Same shape as the `Ms` clipboard fix: xterm supports it (linkHandler), but
  // tmux only passes it through when told the terminal has the `hyperlinks` feature.
  "set -as terminal-features '*:hyperlinks'",
  // SINGLE quotes: inside double quotes tmux runs its own escape processing over the
  // value, which eats the `\E` (leaving a bare `E` that is not an escape at all) and turns
  // `\007` into a raw BEL — so the capability tmux stores emits `E]52;…` as literal text
  // instead of an OSC 52 sequence. Measured on tmux 3.6a.
  `set -ag terminal-overrides '${OSC52_MS_OVERRIDE}'`,
  ...WHEEL_SCROLL_BINDINGS,
];

export type MsOverridePlan = { kind: "ok" } | { kind: "append" } | { kind: "replace"; index: number };

// What a RUNNING server's `show -g terminal-overrides` says we must do to get a working
// `Ms`. Its own function because the repair case only exists for servers that stored the
// double-quoted (broken) value before this was fixed, and that is not reachable from a
// test without standing up a tmux server.
//
// tmux prints one `terminal-overrides[N] value` line per entry and doubles each stored
// backslash, so a correct entry shows as `Ms=\\E]52;` and the broken one as `Ms=E]52;`.
export function planMsOverride(showStdout: string): MsOverridePlan {
  for (const line of splitLines(showStdout)) {
    const entry = /^terminal-overrides\[(\d+)\] (.*)$/.exec(line);
    if (!entry) continue;
    const [, index, value] = entry;
    if (value === undefined || !value.includes("Ms=") || !value.includes("]52;")) continue; // someone else's override
    return value.includes("Ms=\\\\E]52;") ? { kind: "ok" } : { kind: "replace", index: Number(index) };
  }
  return { kind: "append" };
}

// A fresh server sources CONF_FILE via `-f` on its first `new-session`, but a server
// already running from persisted sessions ignores it — so apply the options that must be
// live. Idempotent across node restarts: mouse/set-clipboard are plain global sets; the
// Ms override is appended when absent and rewritten in place when a previous version
// stored the broken value (a server can outlive the upgrade that fixed it).
function applyLiveTmuxOptions(): void {
  tmux(["set", "-g", "mouse", "on"]);
  tmux(["set", "-g", "set-clipboard", "on"]);
  // The status bar is off in CONF_FILE for looks, but the size check (session/tmux-size-sync.ts)
  // now DEPENDS on it: a status line reserves a row, so `window_height` would sit one below the
  // client's forever and every resize would read as a disagreement. A tmux server that predates
  // the conf keeps its status bar across every node restart, so it has to be set live too.
  tmux(["set", "-g", "status", "off"]);
  // Rebinding is idempotent, so this needs no "is it already ours?" check (unlike the
  // append-only overrides below). A tmux server started before this shipped keeps the
  // five-line jump until it is rebound here — it outlives every node restart.
  for (const table of WHEEL_SCROLL_TABLES) {
    for (const { key, command } of WHEEL_SCROLL_KEYS) tmux(["bind-key", "-T", table, key, command]);
  }
  // Forward OSC 8 hyperlinks to the outer xterm (see TMUX_CONF_LINES). Append only when
  // absent — `set -as` does NOT de-dupe, so an unguarded call grows the list on every restart.
  if (!tmux(["show", "-g", "terminal-features"]).stdout.includes("hyperlinks")) {
    tmux(["set", "-as", "terminal-features", "*:hyperlinks"]);
  }
  const plan = planMsOverride(tmux(["show", "-g", "terminal-overrides"]).stdout);
  if (plan.kind === "append") tmux(["set", "-ag", "terminal-overrides", OSC52_MS_OVERRIDE]);
  if (plan.kind === "replace") tmux(["set", "-g", `terminal-overrides[${plan.index}]`, MS_OVERRIDE_ENTRY]);
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
  for (const line of splitLines(stdout.replace(/\r?\n$/, ""))) {
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
// Beyond the launcher vars: a session pointed at an Anthropic-compatible backend must not
// see ANTHROPIC_API_KEY, which silently outranks the auth token that aims it there. The
// settings `env` block cannot express a REMOVAL, and a pane inherits the tmux server's
// environment rather than ours, so this is where it has to be taken out (#579).
const SCRUBBED_NAMES = new Set(["ANTHROPIC_API_KEY"]);

/** The port we are listening on, as a string: the one value under `PORT` that is identifiably OURS.
 *  Read off the process here, so the rules below can take it as an argument and be tested. */
export const ownBindPort = (): string => String(PORT);

/** Is this PORT the address we are holding? That is the ONLY PORT we take away: a pane that
 *  inherits it tells its dev server to bind the port this server is already on (#1857, #1919).
 *
 *  Everything else under the name stays, because nothing distinguishes it from a value the user
 *  set. `PORT=3000 mulmoterminal --port 34601` leaves a 3000 in our own environment that is the
 *  user's and reaches a cell as it always did (#1873) — and a tmux server that outlives the run
 *  which admitted it keeps handing that 3000 out, so a later restart carrying no PORT of its own
 *  must not take it away either.
 *
 *  The accepted cost: a leftover from before #1873 is recovered only when it names the port we are
 *  on now. That is the reported case, and the only one that can cost this server its address — a
 *  stale value naming some OTHER port cannot take what we are holding, and telling it from the
 *  user's own would need provenance the tmux environment does not carry. */
export function isOwnBindPort(value: string | undefined, boundPort: string): boolean {
  return value === boundPort;
}

/** Must this entry go from a RUNNING tmux server's global environment? */
export function isScrubbedGlobalEnvEntry(name: string, value: string, boundPort: string): boolean {
  if (isLauncherEnvVar(name) || SCRUBBED_NAMES.has(name)) return true;
  return name === "PORT" && isOwnBindPort(value, boundPort);
}

/** What a spawn must drop from the tmux CLIENT's own environment, because scrubbing a RUNNING
 *  server cannot reach the one that does not exist yet: `new-session` starts the server when none
 *  is up, and that server keeps the environment it was started with for life — so our own bind port
 *  would reach every pane it ever opens (#1919). Measured: `set-environment` and `has-session` do
 *  not start a server, so a spawn's client is the only way in.
 *
 *  Only server CREATION is affected. A pane's environment comes from `new-session -e`, so a
 *  directory that reserved PORT for its worktree (#1367) still gets it. */
export function tmuxClientUnsetNames(inheritedPort: string | undefined, boundPort: string): readonly string[] {
  return isOwnBindPort(inheritedPort, boundPort) ? ["PORT"] : [];
}

function scrubGlobalEnvironment(): void {
  const r = tmux(["show-environment", "-g"]);
  if (r.status !== 0) return;
  const boundPort = ownBindPort();
  for (const [name, value] of parseTmuxEnvironment(r.stdout)) {
    if (isScrubbedGlobalEnvEntry(name, value, boundPort)) tmux(["set-environment", "-g", "-r", name]);
  }
}

// Flag names for removal from the RUNNING tmux server's global environment, so panes
// created from here on don't inherit them.
//
// ensureConf's scrub is not enough on its own: it only runs when a server already existed
// when this process started. A server that a LATER spawn creates inherits that spawn's
// environment instead — measured — so a first non-provider session can seed the server
// with ANTHROPIC_API_KEY and every provider pane after it would inherit the key that
// silently outranks its auth token (#579). Called before a provider spawn; a no-op (and
// harmless failure) when no server is running yet, where the fresh server inherits the
// already-stripped environment.
export function tmuxScrubEnvNames(names: readonly string[]): void {
  for (const name of names) tmux(["set-environment", "-g", "-r", name]);
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
// `env` is set on the new session with `-e`, NOT inherited from our own process: a tmux pane
// takes the tmux SERVER's environment, and that server outlives any one session, so a variable
// exported here would either be missing or — worse — hold a previous session's value.
//
// With `-A` the flag only applies when the session is CREATED; reattaching an existing one
// keeps the environment it was created with, which is what we want (its claude process is
// already running with the value it was given).
//
// `-u` forces this client's output to UTF-8 instead of deciding from LC_ALL/LC_CTYPE/LANG.
// Without it a client that finds no UTF-8 name among those writes every character it cannot
// map to DEC ACS as one `_` per cell, so Japanese arrives as pairs of underscores (#1634).
// Forcing it is not a guess about the user's terminal: the reader of this client's output is
// our own xterm.js, which is always UTF-8. pty-env.ts supplies a LANG for everything else in
// the session, but only where the environment named no locale at all — `-u` also covers a
// machine that explicitly names a non-UTF-8 one.
export function tmuxNewSessionArgs(id: string, file: string, args: string[], cwd: string, env: Readonly<Record<string, string>> = {}): string[] {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  return ["-L", SERVER_SOCKET, "-f", CONF_FILE, "-u", "new-session", "-A", "-s", tmuxSessionName(id), "-c", cwd, ...envArgs, "--", file, ...args];
}

// Is a persistent session for this id currently alive in our tmux server?
export function tmuxHasSession(id: string): boolean {
  return tmux(["has-session", "-t", tmuxSessionName(id)]).status === 0;
}

// End a persistent session (explicit close / reap). Killing the pty only detaches our
// client — the session (and its program) would otherwise keep running.
// Whether tmux actually ended it. Callers that just want it gone can ignore the answer; the boot
// sweep cannot — it reports what it ended, and `server/index.ts` then deletes the settings file of
// every session it was told about. A kill that failed silently would take a live session's file,
// which can hold a provider's API token (CodeRabbit on #1486).
export function tmuxKillSession(id: string): boolean {
  return tmux(["kill-session", "-t", tmuxSessionName(id)]).status === 0;
}

// The rendered contents of a session's pane — the visible screen plus `historyLines` of
// scrollback above it — available even while the session is DETACHED and across a server
// restart (tmux outlives the node process). Null when tmux has no such session, which is
// also how a tmux-less host reports "ask someone else".
//
// `-e` keeps the escape sequences, which the caller strips back out (session/screen-rows).
// Only one attribute is actually wanted — dim, the thing that marks an agent's ghost
// suggestion apart from text the user typed — but tmux has no way to emit that alone.
//
// `-S -n` starts n lines into the history, clamped to whatever the session actually has,
// so a young session simply yields less. How much is worth asking for is the caller's
// call — this only knows how to ask.
export function tmuxCaptureStyledPane(id: string, historyLines: number): string | null {
  const r = tmux(["capture-pane", "-p", "-e", "-S", `-${historyLines}`, "-t", tmuxSessionName(id)]);
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

// The pane state that an application SETS ONCE and then relies on forever: which screen buffer
// it owns, and which mouse reports it asked for. Read back as the DEC private modes that would
// re-establish it (#1073).
//
// Needed because the reattach replay is a bounded tail: `CSI ? 1049 h` is written at pty offset 0
// (when our tmux client attaches) and never again, so past ~1 MiB it is gone from the replay and
// the browser restores into the normal buffer — which silently disables the wheel and click
// synthesis, both gated on the alternate buffer (see session/terminal-replay.ts).
//
// Asking tmux instead of tracking the byte stream is what keeps this small: tmux is the emulator
// that owns the state, so there is no DECRST bookkeeping and no CSI split across pty chunks.
//
// 1001/1015/1016 are in the client's swallow set but tmux has no flag for them. No agent we run
// asks for them, and the client needs 1006 plus one tracking mode — which this covers.
const TERMINAL_MODE_FLAGS = [
  { flag: "alternate_on", mode: 1049 },
  { flag: "mouse_standard_flag", mode: 1000 },
  { flag: "mouse_button_flag", mode: 1002 },
  { flag: "mouse_all_flag", mode: 1003 },
  { flag: "mouse_utf8_flag", mode: 1005 },
  { flag: "mouse_sgr_flag", mode: 1006 },
] as const;

// Comma-separated, not space: a variable an older tmux doesn't know renders EMPTY, and only a
// delimiter that survives an empty field keeps the rest of the values on their own modes.
const TERMINAL_MODE_FORMAT = TERMINAL_MODE_FLAGS.map(({ flag }) => `#{${flag}}`).join(",");

/** Parse one `TERMINAL_MODE_FORMAT` line into the modes that are on. Positional against the same
 *  table the format is built from, so the two cannot drift. */
export function parseTmuxTerminalModes(stdout: string): number[] {
  const values = stdout.trim().split(",");
  return TERMINAL_MODE_FLAGS.filter((_, i) => values[i] === "1").map(({ mode }) => mode);
}

// Empty rather than null when tmux can't answer: an unreadable session and a plain shell lead to
// the same action — restore nothing — so a nullable would only push a `?? []` onto every caller.
export function tmuxTerminalModes(id: string): number[] {
  const r = tmux(["display-message", "-p", "-t", tmuxSessionName(id), TERMINAL_MODE_FORMAT]);
  return r.status === 0 ? parseTmuxTerminalModes(r.stdout) : [];
}

// Which client ttys to repaint, from `list-clients -F '#{client_pid} #{client_tty}'`.
//
// A session can carry SEVERAL clients — another mulmoterminal server holding it (the case
// tmuxAttachedClientCount exists for), or a stray `tmux attach` — and tmux promises nothing about
// their order, so "the first line" can be somebody else's terminal. Ours is identifiable: the pty
// we spawned IS the tmux client, so `client_pid` is `entry.term.pid`. Measured on a live session:
// list-clients reported `29421`, and the `new-session -A -s mt-<id>` process we spawned was 29421.
//
// When no line carries our pid — a tmux that doesn't report it, or a client someone else attached
// after ours went away — every client is repainted rather than none. A repaint is idempotent, and
// skipping ours is the single outcome that leaves the bug in place.
export function redrawTargets(stdout: string, clientPid: number): string[] {
  const clients = splitLines(stdout)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([pid, tty]) => ({ pid: Number(pid), tty: tty ?? "" }));
  const ours = clients.filter((client) => client.pid === clientPid);
  return (ours.length > 0 ? ours : clients).map((client) => client.tty);
}

// Make tmux repaint the WHOLE pane onto our client, even though nothing about the pane changed.
//
// The reattach replay is a bounded tail of tmux's output — a stream of DELTAS, not a screen. Fed to
// a freshly reset terminal it reconstructs only the cells that happened to change inside that
// window: rows that never changed stay blank, and cells written at different moments end up side by
// side. A pty resize normally hides this, because tmux answers a size change with a full redraw —
// but a reattach that ends at the size the pty already had leaves tmux with nothing to say, and the
// browser keeps the half-built screen. Since the replay now lands in the ALTERNATE buffer, which
// does not reflow, there is also no later resize that can repair it (#1073).
//
// Measured against a live session: one `refresh-client` returns every row of a 25-row screen in a
// single 666-byte burst, where an idle pane sends nothing at all.
export function tmuxRedrawClient(id: string, clientPid: number): void {
  const clients = tmux(["list-clients", "-t", tmuxSessionName(id), "-F", "#{client_pid} #{client_tty}"]);
  if (clients.status !== 0) return;
  redrawTargets(clients.stdout, clientPid).forEach((tty) => tmux(["refresh-client", "-t", tty]));
}

/** Parse `#{window_width}x#{window_height}`. Null for anything that isn't a pair of numbers —
 *  a caller deciding "tmux disagrees with the client" must not read an unreadable answer as a
 *  disagreement and start resizing on the strength of it. */
export function parseTmuxWindowSize(stdout: string): { cols: number; rows: number } | null {
  const pair = /^(\d+)x(\d+)$/.exec(stdout.trim());
  return pair ? { cols: Number(pair[1]), rows: Number(pair[2]) } : null;
}

// How big tmux believes the window is. While things are in step this equals the attached
// client's size — our conf turns the status line off, so no row is reserved — and a difference
// means the client's SIGWINCH never landed. Nothing repaints its way out of that (see
// session/tmux-size-sync.ts).
//
// Async, unlike its neighbours: a browser window resize settles every open grid cell at once, and
// ten synchronous tmux spawns in a row would block the event loop for all of them.
export async function tmuxWindowSize(id: string): Promise<{ cols: number; rows: number } | null> {
  const r = await tmuxAsync(["display-message", "-p", "-t", tmuxSessionName(id), "#{window_width}x#{window_height}"]);
  return r.status === 0 ? parseTmuxWindowSize(r.stdout) : null;
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

// `list-clients -F '#{session_name}'` → how many clients each of OUR sessions carries. One line
// per client, so a session with two holders appears twice and one with none does not appear at
// all. Names outside our prefix belong to nobody here.
export function parseTmuxClientSessions(stdout: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of splitLines(stdout)) {
    const name = line.trim();
    if (!name.startsWith(SESSION_PREFIX)) continue;
    const id = name.slice(SESSION_PREFIX.length);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// Every session's client count in ONE call, unlike tmuxAttachedClientCount's per-session probe.
// A list of rows is the caller here (the launcher's worktrees, its resume list), and one spawn per
// row is what this exists to avoid.
//
// Null — not an empty map — when tmux could not answer (not installed, no server running yet), so
// the caller can tell "nobody holds these" from "nobody could say"; isSessionAttached is where
// that distinction is spent.
export function tmuxAttachedCounts(): Map<string, number> | null {
  const r = tmux(["list-clients", "-F", "#{session_name}"]);
  return r.status === 0 ? parseTmuxClientSessions(r.stdout) : null;
}

// `list-sessions -F '<name> <activity>'` → when tmux last saw each session do anything, as an epoch
// second. Parsed apart from the call so the shapes tmux can hand back — a name outside our prefix,
// a line missing its number — are pinned without a tmux server.
export function parseTmuxSessionActivity(stdout: string): Map<string, number> {
  const activity = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const [name, seconds] = line.trim().split(/\s+/);
    if (!name?.startsWith(SESSION_PREFIX) || seconds === undefined) continue;
    const epoch = Number(seconds);
    if (Number.isFinite(epoch)) activity.set(name.slice(SESSION_PREFIX.length), epoch);
  }
  return activity;
}

// How long each surviving session has been sitting, in one call (#1478). Null — not an empty map —
// when tmux could not answer, so a caller can tell "nothing is idle" from "nobody could say"; the
// list shows no age rather than an invented one.
export function tmuxSessionActivity(): Map<string, number> | null {
  const r = tmux(["list-sessions", "-F", "#{session_name} #{session_activity}"]);
  return r.status === 0 ? parseTmuxSessionActivity(r.stdout) : null;
}

/** Parse `#{pane_pid} #{session_name}` rows into pane pid -> our session id. Split out so the
 *  format, which is the one thing that can silently change under us, is asserted by a spec. */
export function parseTmuxPanePids(stdout: string): Map<number, string> {
  const panes = new Map<number, string>();
  for (const line of stdout.split("\n")) {
    const [pid, name] = line.trim().split(/\s+/, 2);
    const numeric = Number(pid);
    if (!Number.isInteger(numeric) || numeric <= 0 || !name?.startsWith(SESSION_PREFIX)) continue;
    panes.set(numeric, name.slice(SESSION_PREFIX.length));
  }
  return panes;
}

/**
 * The root process of every pane, keyed to the session it belongs to.
 *
 * This is what lets a process started BY an agent be traced back to the session that agent runs
 * in, when nothing was handed to it: muse gives a plugin's MCP server a curated environment of 16
 * variables (measured) — none of them ours — so the only thing that survives is the process tree,
 * and the pane pid is where that tree meets a session id. See server/session/bridge-session.ts.
 */
export function tmuxPanePids(): Map<number, string> {
  const r = tmux(["list-panes", "-a", "-F", "#{pane_pid} #{session_name}"]);
  if (r.status !== 0) return new Map<number, string>();
  return parseTmuxPanePids(r.stdout);
}

/** What `tmux list-sessions` reported, read as one of three answers rather than two.
 *
 *  `no server running` is not a failure: it is tmux saying, reliably, that it holds nothing. So is
 *  a missing socket, which is how a named socket (`-L mulmoterminal`) says the same thing:
 *  `error connecting to /tmp/tmux-501/mulmoterminal (No such file or directory)`. A different
 *  non-zero status is tmux failing to ANSWER — the binary missing, the socket unreadable, the call
 *  timing out (status null) — and reading that as "it holds nothing" is what turns a broken tmux
 *  into "every persisted session has ended" (CodeRabbit, PR #2002).
 *
 *  It is the MISSING FILE that means empty, never the words "error connecting" on their own: the
 *  same prefix carries `(Permission denied)` and `(Connection refused)`, which are a socket that
 *  exists and cannot be read — the case above, not this one (Codex, PR #2016).
 *
 *  Pure so the three-way rule can be tested without a tmux server. */
export function tmuxSessionIdsFrom(result: { status: number | null; stdout: string; stderr: string }): string[] | null {
  if (result.status !== 0) return /no server running|no such file or directory/i.test(result.stderr) ? [] : null;
  return result.stdout
    .split("\n")
    .filter((n) => n.startsWith(SESSION_PREFIX))
    .map((n) => n.slice(SESSION_PREFIX.length));
}

/** Ids tmux is holding, or null when tmux could not be ASKED — see `tmuxSessionIdsFrom`. A caller
 *  deciding whether a session still exists must not read that null as "none". */
export function tmuxHeldSessionIds(): string[] | null {
  return tmuxSessionIdsFrom(tmux(["list-sessions", "-F", "#{session_name}"]));
}

/** The same answer, without blocking the event loop — the form a REQUEST must use.
 *
 *  `spawnSync` holds Node still until the child answers or its 15s timeout fires, so one hung tmux
 *  in a handler stalls every other request AND every open terminal. The collection pane asks this
 *  on every reconnect, which is exactly the traffic that must not be able to do that (Codex,
 *  PR #2002). */
export async function tmuxHeldSessionIdsAsync(): Promise<string[] | null> {
  return tmuxSessionIdsFrom(await tmuxAsync(["list-sessions", "-F", "#{session_name}"]));
}

// Ids of sessions that survived (e.g. across a crash), for startup visibility. An unreadable tmux
// reads as none here on purpose: this one only decides what to MENTION at boot.
export function tmuxListSessionIds(): string[] {
  return tmuxHeldSessionIds() ?? [];
}

// Whether a tmux `mt-<id>` is worth OFFERING: it's live (an attached pty), a persisted grid
// session, or has a Claude/Codex transcript on disk — the phone's session picker, which must not
// list a row that opens onto nothing.
//
// It is NOT the rule for ending one, though it was used as that for a long time (#1467). Every limb
// here except `live` is a record of the PAST — a transcript is never deleted, and the grid log is
// append-only — so read as "may we reap this?", it answers no forever, and nothing was ever
// cleaned up. The two questions below are the ones a cleanup actually asks.
export function isResumableTmuxSession(
  id: string,
  live: ReadonlySet<string>,
  grid: ReadonlySet<string>,
  claudeOnDisk: ReadonlySet<string>,
  codexOnDisk: (id: string) => boolean,
): boolean {
  return live.has(id) || grid.has(id) || claudeOnDisk.has(id) || codexOnDisk(id);
}

// Whether ending this session keeps the conversation: something on disk can bring it back, so what
// is lost is the work in flight and the scrollback — not the history.
//
// Only the on-disk halves, deliberately. A live pty says the session is in USE, and the grid log
// says it once was a cell; neither restores anything, and counting them is why the Settings list
// reported 20 of 22 sessions restorable when 15 were (#1479).
export function isRestorableSession(id: string, claudeOnDisk: ReadonlySet<string>, codexOnDisk: (id: string) => boolean): boolean {
  return claudeOnDisk.has(id) || codexOnDisk(id);
}

/** What ending a session without asking depends on. Every field is about NOW; nothing here is a
 *  record of the past, which is the whole correction (#1467). */
export interface ReapFacts {
  /** Terminals holding it, or null when tmux could not say. */
  attachedCount: number | null;
  /** A pty for it in THIS process — a cell has it, whatever tmux thinks. */
  liveHere: boolean;
  /** Seconds since tmux last saw output, or null when tmux could not say. */
  idleSeconds: number | null;
  /** The threshold, in seconds. Zero means the sweep is off and nothing is reapable. */
  idleThresholdSeconds: number;
  /** The id parses as a session id at all. One that does not (a live `mt-undefined` was found —
   *  #1533) is unreachable by EVERY route: nothing can attach it, resume it, or terminate it (the
   *  routes validate the id), so it can only leak. Callers compute this with SESSION_ID_RE. */
  validId: boolean;
}

/**
 * May this session be ended on its own?
 *
 * Every "unknown" answers NO. An unreadable attach count and an unreadable age are the two ways
 * tmux can decline to answer, and reaping on either would be killing a session on a guess — the one
 * outcome worse than the pile-up this exists to clear.
 */
export function reapableTmuxSession({ attachedCount, liveHere, idleSeconds, idleThresholdSeconds, validId }: ReapFacts): boolean {
  if (idleThresholdSeconds <= 0) return false;
  if (liveHere || attachedCount !== 0) return false;
  // Unreachable garbage does not get the idle grace: no amount of recency can make an invalid id
  // reachable, and this sweep is the only thing that can ever end it (the terminate route refuses
  // the id). Still only when nobody holds it — someone inspecting the pane by hand keeps it.
  if (!validId) return true;
  return idleSeconds !== null && idleSeconds >= idleThresholdSeconds;
}
