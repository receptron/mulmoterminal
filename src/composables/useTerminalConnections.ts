// ── CHANGING THE TERMINAL? UPDATE THE DOCS IN THE SAME COMMIT ─────────────────────────
// Terminal behaviour is documented in three places, and a spec that changes in code but
// not in prose leaves a reader believing something that is no longer true — which is
// exactly what happened to the file-path link routing (#834):
//   - docs/terminal-notes.md — the developer reference for this stack (xterm addons,
//     tmux passthrough, links, mouse tracking, renderer) AND its upgrade regression
//     checklist. Read it before touching xterm, an addon, tmux, or node-pty.
//   - README.md — the user-facing behaviour (keys, selection, file paths, the GUI panel).
//   - docs/guide/en/features.md + docs/guide/ja/features.md — the feature table, in BOTH
//     languages; they are meant to stay in sync.
// ──────────────────────────────────────────────────────────────────────────────────────
//
// A module-singleton manager that owns each terminal's durable runtime — its
// WebSocket, xterm instance, reconnect/backoff state — independent of the Vue
// component lifecycle. This is what lets a session's PTY stay alive (and its
// socket stay open) while its Terminal.vue is unmounted: navigating away, flipping
// to an off-page grid tab, or toggling Grid<->single only DETACHES the view (the
// xterm's host element is re-parented out of the DOM), it does not close the socket.
//
// Why this matters: the server keeps a PTY alive for exactly as long as its
// WebSocket is open (it only arms the reap grace timer on socket close). So holding
// the socket open here means coming back reattaches an already-live session — no
// `claude --resume`, no "restoring session" token cost — instead of a cold resume.
//
// Each terminal "slot" is addressed by a stable key: the grid cell's uid
// (`cell-<uid>`), the single view's `single`, or an ephemeral id for command/Run
// terminals (which are NOT persisted — their process is unresumable, so their slot
// is released on unmount like before).
import { reactive, watch } from "vue";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon, type IClipboardProvider } from "@xterm/addon-clipboard";
import { guardMouseClicks, guardMouseTracking } from "./terminalMouseInput";
import { getTerminalScrollSpeed } from "./useTerminalScrollSpeed";
import { isTypedInput } from "./terminalUserInput";
import { bufferIsShort, readBufferShape } from "./terminalBufferHealth";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { connWsUrl, type LaunchChoice } from "../components/wsUrl";
import { connectionWillReturn, reconnectDelayMs, shouldReconnect } from "./reconnectPolicy";
import type { RunCommand } from "../components/runCommand";
import { readableSlot, type SlotCandidate, type SlotInfo } from "./readableSlot";
import { exitCodeOf, messageEffect, parseServerFrame } from "./serverMessage";
import {
  enterKeyOverride,
  submitSequence,
  submittableLine,
  DEFAULT_TERMINAL_SUBMIT_MODE,
  type EnterKeyEvent,
  type TerminalSubmitMode,
} from "../../common/terminalSubmit";
import { TERMINAL_FONT_SIZE_DEFAULT } from "../../common/terminalFontSize";
import { TERMINAL_FONT_FAMILY_DEFAULT } from "../../common/terminalFontFamily";
import { getTerminalSubmitMode } from "./terminalSubmitMode";
import { clipboardActionFor, selectionToCopy } from "../../common/terminalClipboard";
import { isImeConfirming } from "./imeComposition";
import { sendBytesFor, type Keymap, type KeymapKeyEvent } from "../../common/keymap";
import { getActiveKeymap } from "./activeKeymap";
import { isCopyOnSelectEnabled } from "./copyOnSelect";
import { createFilePathLinkProvider } from "./terminalFilePathLinkProvider";
import { tryOpenInPane } from "./filesPaneOpener";
import { filesGotoFile } from "./useFilesView";
import type { TerminalAgent } from "../../common/sessionAgent";

export type ConnStatus = "connecting" | "connected" | "disconnected";

// Enter submits and Shift/Option+Enter make a newline — but which BYTES carry each meaning
// depends on the host's Claude binding, so the choice lives in `enterKeyOverride` (keyed by
// the user's `terminalSubmit` setting) rather than being hardcoded here. xterm emits "\r" for
// both Enter and Shift+Enter, so whenever we need anything else we intercept the key and send
// the right bytes ourselves.
//
// The handler: when `enterKeyOverride` returns bytes, `send` them and return false to cancel
// xterm's default \r; otherwise return true so xterm handles the key normally.
// `preventDefault()` is essential: xterm's _keyDown returns early on a false custom handler
// WITHOUT preventDefault, so the browser fires a follow-up keypress that _keyPress turns into a
// bare \r — submitting the prompt. Cancelling the default stops that keypress.
type EnterHandlerEvent = EnterKeyEvent & { preventDefault: () => void };
export function makeEnterHandler(getMode: () => TerminalSubmitMode, send: (data: string) => void): (e: EnterHandlerEvent) => boolean {
  return (e) => {
    const bytes = enterKeyOverride(getMode(), e);
    if (bytes === null) return true;
    e.preventDefault();
    send(bytes);
    return false;
  };
}

// The user's `keymap.send` bindings, turned into bytes on this terminal's PTY (#1005) — the
// same three lines as the Enter handler above, and `preventDefault()` matters here for the same
// reason: without it xterm leaves the browser to fire a keypress that arrives as stray input.
//
// Per terminal rather than on the grid's handler, because the bytes go to ONE pty — the one
// whose xterm saw the key — and the grid has no such subject when nothing is enlarged.
type SendHandlerEvent = KeymapKeyEvent & { type: string; isComposing?: boolean; preventDefault: () => void };
export function makeSendHandler(getKeymap: () => Keymap, send: (data: string) => void): (e: SendHandlerEvent) => boolean {
  return (e) => {
    const bytes = sendBytesFor(getKeymap(), e);
    if (bytes === null) return true;
    e.preventDefault();
    send(bytes);
    return false;
  };
}

// What a slot connects to. Mirrors the relevant Terminal.vue props; a connectKey
// change (session switch / relaunch) hands a fresh target to retarget().
export interface ConnTarget {
  sessionId: string | null;
  cwd: string | null;
  devTerminal: boolean;
  command: RunCommand | null;
  // A configured launcher (shell/codex/command) by index, or the OS default shell
  // (`{ shell: true }`, the header "new terminal" button). Unlike `command` this is a
  // PERSISTENT session — it reconnects on drop and reattaches by session id, like a Claude cell.
  launcher: { index: number } | { shell: true } | null;
  // A first-class non-Claude session (/ws/codex, /ws/antigravity) instead of a Claude one.
  // Persistent & reattachable like a Claude cell; the server discovers + resumes that agent's
  // own conversation id. Absent means Claude.
  agent?: TerminalAgent;
  // The provider/model the launch form picked for this session (#584). Claude only —
  // it rides the /ws query and overrides the directory's default.
  launch?: LaunchChoice | null;
  // The custom agent this session was started from (#1414) — one of the user's own ways of
  // starting Claude Code. `agent` stays "claude" for it: that IS what runs.
  customAgent?: string | null;
}

// The `terminalSubmit` mapping describes the user's CLAUDE binding, so it only applies to
// Claude cells. A launcher / another agent / command / dev-terminal cell is a shell or another TUI
// where a bare Enter must stay xterm's native \r — a reversed setting must not rewrite it.
export const isClaudeTarget = (t: ConnTarget): boolean => !t.devTerminal && !t.command && !t.launcher && (t.agent ?? "claude") === "claude";

// The submit/newline byte mapping in effect for one connection: the user's `terminalSubmit`
// setting for a Claude cell, the standard binding for everything else. Used by the keyboard
// handler AND the GUI-originated sends (submitText / pasteAndSubmit), so all three agree on
// which byte submits.
const effectiveSubmitMode = (c: Conn): TerminalSubmitMode => (isClaudeTarget(c.target) ? getTerminalSubmitMode() : DEFAULT_TERMINAL_SUBMIT_MODE);
const submitBytesFor = (c: Conn): string => submitSequence(effectiveSubmitMode(c));

// A line WE are about to submit, ended so Claude's completion menu isn't holding the submit key
// (#1142). Claude cells only, and scoped by the same predicate as the submit bytes: in a shell the
// guard's trailing space would be real input (a line ending in `\` escapes the newline there).
const submittableFor = (c: Conn, text: string): string => (isClaudeTarget(c.target) ? submittableLine(text) : text);

// Forwarded to whatever component is currently attached, so the parent's existing
// session/cwd/exit wiring (grid_v2 persistence, recent-dir recording, re-run UI)
// keeps working unchanged. Cleared on detach; a detached slot still tracks its
// knownSessionId internally for a later reattach.
export interface ConnHandlers {
  onSession?: (id: string) => void;
  onCwd?: (cwd: string) => void;
  onLiveCwd?: (cwd: string) => void;
  // `exitCode` is the command's status when the server reported one, else null (a start
  // failure, or an agent session that ended without one). A Run cell reads it to tell a
  // clean finish from a broken build.
  onExit?: (exitCode: number | null) => void;
  // The user put something INTO this terminal. Fired from the one place keystrokes, bound keys
  // and pastes all funnel through on their way to the socket, so it cannot be reached by output
  // the server writes back or by anything the app renders — only by someone using the session.
  onInput?: () => void;
  // …and it went nowhere, because the socket is not open. Fired for a keystroke and for anything
  // the GUI sends into the PTY (a header button, a picked skill, a pasted block), because the
  // silence is the same either way and a button press is the worse of the two: whoever pressed it
  // has no sense of having typed, so nothing points at the connection (#1315). Rate-limited, so a
  // held-down key doesn't turn into a stream of notices. `willReconnect` is false for a session
  // that ended and for a Run cell, neither of which comes back — telling those to wait would be a
  // promise nothing will keep.
  onInputDropped?: (willReconnect: boolean) => void;
}

// The two xterm options that decide the CELL METRICS, so they travel together: both change how
// many columns and rows fit, and every path that applies either has to re-fit and tell the PTY.
// Kept as one value so a change to both costs one fit, and so attach() doesn't grow a parameter
// per option.
export interface TerminalFont {
  size: number;
  family: string;
}

const sameFont = (a: TerminalFont, b: TerminalFont): boolean => a.size === b.size && a.family === b.family;

const DEFAULT_FONT: Readonly<TerminalFont> = { size: TERMINAL_FONT_SIZE_DEFAULT, family: TERMINAL_FONT_FAMILY_DEFAULT };

interface Conn {
  key: string;
  term: Terminal;
  fitAddon: FitAddon;
  host: HTMLDivElement; // term.open()'d into this ONCE; re-parented on attach/detach
  ws: WebSocket | null;
  knownSessionId: string | null;
  knownCwd: string | null; // server-resolved cwd, replayed on (re)attach
  liveCwd: string | null;
  target: ConnTarget;
  handlers: ConnHandlers;
  sawExit: boolean; // an intentional end (exit/superseded/error) — suppress reconnect
  released: boolean; // torn down — suppress reconnect and stray socket events
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  attachedEl: HTMLElement | null;
  // Mouse modes swallowed for the CURRENT session (#729/#737). Session-scoped: an app that
  // dies without sending DECRST must not leave the next one looking like it asked for mouse
  // reports, or its wheel would get synthesized reports it never wanted.
  swallowedMouseModes: Set<number>;
  theme: ITheme | undefined; // last applied, so a rebuilt terminal keeps the cell's colours
  font: TerminalFont; // same reason as `theme` — a rebuilt terminal must not snap back to the default
  lastRebuildMs: number; // rate-limits the #846 recovery so a stuck reading can't spin
  // A drop has already been LOGGED for this disconnected stretch. One line is all a post-mortem
  // needs; fifty say nothing more. The banner is timed separately below. Both clear on open.
  warnedDroppedInput: boolean;
  // -Infinity rather than 0 so "never notified" outlasts any cooldown: a spec that stubs Date.now
  // to a small number would otherwise lose the FIRST banner and still read as passing.
  lastDroppedInputNoticeMs: number;
}

// The banner is re-armed on a timer rather than shown once per stretch, because a stretch has no
// upper bound: the backoff retries forever at a 5s cap, so a server that stays down outlives the
// notice by hours, and whoever comes back and types again meets the silence this exists to break
// (#1316). One notice per banner-lifetime still cannot become a stream — the next one can only
// land once the previous has left the screen. Matches DROP_HINT_MS in Terminal.vue.
const DROPPED_INPUT_NOTICE_MS = 6_000;

// Input that reached a socket which is not open — a keystroke, or anything the GUI sends.
function reportDroppedInput(c: Conn): void {
  const willReconnect = connectionWillReturn({ released: c.released, sawExit: c.sawExit, isCommand: !!c.target.command });
  if (!c.warnedDroppedInput) {
    c.warnedDroppedInput = true;
    const fate = willReconnect ? "reconnecting" : "not reconnecting";
    console.warn(`[terminal] slot ${c.key}: dropped input — the socket is not open (status ${connView.get(c.key)?.status ?? "unknown"}, ${fate})`);
  }
  const now = Date.now();
  if (now - c.lastDroppedInputNoticeMs < DROPPED_INPUT_NOTICE_MS) return;
  c.lastDroppedInputNoticeMs = now;
  c.handlers.onInputDropped?.(willReconnect);
}

// A rebuild costs a re-attach and the client-side scrollback, so a slot gets at most one per
// window — enough for a real recovery, not enough to loop if the reading never clears.
const REBUILD_COOLDOWN_MS = 10_000;

// The heavy per-slot runtime (non-reactive — Vue never needs to track these).
const conns = new Map<string, Conn>();

// Fit the terminal to its host, push the new size to the PTY, and stick to the
// bottom. The fit() can throw when the host isn't laid out yet — the caller's
// ResizeObserver fit() then follows — so it's swallowed.
function fitAndSyncSize(c: Conn): void {
  try {
    c.fitAddon.fit();
  } catch {
    // host not laid out yet
  }
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "resize", cols: c.term.cols, rows: c.term.rows }));
  c.term.scrollToBottom();
}

// The reactive projection the view binds to (status pill, RunMenu cwd). Keyed by
// the same slot key; a slot that hasn't connected yet (or was released) is absent.
export const connView = reactive(new Map<string, { status: ConnStatus; serverCwd: string | null }>());

function setStatus(c: Conn, s: ConnStatus) {
  const v = connView.get(c.key);
  if (v) v.status = s;
}

// Claude Code emits OSC 52 with an EMPTY selection (`ESC ] 52 ; ; <base64>`), which
// the addon's default provider silently drops (it only writes for selection "c").
// Route the empty (and "c") selection to the system clipboard so the auto-copy lands.
export const isSystemClipboard = (selection: string): boolean => selection === "" || selection === "c";
const clipboardProvider: IClipboardProvider = {
  // OSC 52 clipboard READ is disabled: letting a terminal program read the user's
  // clipboard (`ESC ] 52 ; <sel> ; ?`) is an exfiltration vector, and nothing here
  // needs it (paste uses the browser's native Cmd+V). This is write-only.
  readText() {
    return "";
  },
  async writeText(selection, text) {
    if (!isSystemClipboard(selection)) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard blocked (no focus / permission) — best effort
    }
  },
};

// Put the terminal's selection on the system clipboard, by whichever route the browser allows.
//
// `navigator.clipboard` is the direct one, but it is secure-context-only: at `http://<lan-ip>` it
// does not exist AT ALL, and reaching this app that way from a second machine is ordinary. The
// fallback hands the job back to xterm — with its helper textarea focused, `execCommand("copy")`
// fires xterm's own `copy` listener, which writes THE CURRENT SELECTION.
//
// Which is why this takes the terminal's host and not merely a string: it can only ever copy what
// the terminal has selected, and must not be generalised into "write this text to the clipboard".
async function writeTerminalSelection(host: HTMLDivElement, text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // document not focused, or permission refused — fall through instead of giving up
    }
  }
  // Focus is NOT taken here. Reaching this line means the user just dragged inside this terminal,
  // so xterm has already focused its textarea; if something else holds focus by now, stealing it
  // back would be worse than not copying.
  const textarea = host.querySelector(".xterm-helper-textarea");
  if (!textarea || document.activeElement !== textarea) return false;
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

// How long the selection must hold still before it is copied. xterm fires onSelectionChange on
// every coordinate change during a drag, so writing on each one would put every intermediate
// selection into the OS clipboard HISTORY (Win+V) — one drag, twenty entries. Restarting this
// timer on each event leaves only the last one.
//
// A pause longer than this MID-drag still writes what was selected so far, and then again at the
// end. That is the accepted cost of not keying this to mouseup: the settle timer serves a keyboard
// or select-all selection too, where there is no mouse event to key to. The clipboard still ends
// up holding the right text either way — only the history gets one extra entry.
const SELECTION_SETTLE_MS = 150;

// Copy-on-select (#900): a settled mouse selection reaches the clipboard with no key pressed. Off
// unless config.json asks for it; what gets skipped and why is in common/terminalClipboard.ts.
//
// This is the app's only clipboard write of its own. The `copy` keymap action looks like the same
// feature but isn't: there a keystroke had already made the browser copy, and xterm's own listener
// served it — nothing here had to write anything.
function wireCopyOnSelect(term: Terminal, host: HTMLDivElement): void {
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCopied: string | null = null;
  // Writes run one after another rather than the moment each one is due. A settle can land while
  // the previous write is still pending — a browser that ASKS for clipboard permission leaves it
  // pending for as long as the user takes to answer — and two overlapping writes then resolve in
  // whichever order the browser picks, which can leave the clipboard holding the OLDER selection.
  let writes: Promise<void> = Promise.resolve();
  const copySettledSelection = async (): Promise<void> => {
    const text = selectionToCopy(isCopyOnSelectEnabled(), term.getSelection(), lastCopied);
    // Remembered only once it has actually landed, so a write blocked by a lost focus is retried
    // rather than treated as already done.
    if (text !== null && (await writeTerminalSelection(host, text))) lastCopied = text;
  };
  const enqueueCopy = (): void => {
    // The catch matters more than it looks: one rejected link would poison the chain and end
    // copy-on-select for this terminal for good, with nothing to show for it.
    writes = writes.then(copySettledSelection).catch(() => {});
  };
  term.onSelectionChange(() => {
    // The default path, and it must cost nothing: xterm fires this on every coordinate change, so
    // without the early return every ordinary drag would schedule and cancel a timer per cell
    // crossed for a feature nobody turned on.
    if (!isCopyOnSelectEnabled()) return;
    // A cleared selection retires the last one, so selecting the same text again afterwards copies
    // again: between two drags the user may well have put something else on the clipboard, and
    // "you already copied that" would then leave them with the wrong thing and no sign of it.
    //
    // Read per EVENT rather than at settle, because a click that clears and the drag that follows
    // can both land inside one settle window — by the time the timer runs, only the new selection
    // is visible and the clear would go unnoticed. hasSelection() is the cheap half of the API;
    // getSelection() rebuilds the text from the buffer, which is not worth doing per event.
    if (!term.hasSelection()) lastCopied = null;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(enqueueCopy, SELECTION_SETTLE_MS);
  });
}

// Which OSC 8 hyperlink targets we open on click. Restricted to http(s) so a program can't
// emit a `javascript:`/`file:` link that runs on click — the safeguard xterm's docs call for.
export const isOpenableTerminalLink = (uri: string): boolean => /^https?:\/\//i.test(uri);

// Keep a drag as a text selection: refuse the mouse-tracking modes an app would use to take it
// over, so its coordinate reports never land in the agent's prompt (#729). Registered per
// terminal and disposed with it.
//
// SET only. The matching reset (`CSI ? … l`) is deliberately left alone: dropping it gains
// nothing (it disables what was never enabled) but would strand mouse mode ON for good in the
// one case that gets past this hook — a sequence mixing tracking with an unrelated mode, which
// is honoured on purpose. Letting every reset through keeps that recoverable.
//
// What was swallowed is still remembered, because the app still needs the mouse: the wheel (#737)
// and its own click targets (#845) are synthesized from the record by ./terminalMouseInput.
//
// The record is owned by the connection, not this closure, because it is per SESSION: connect()
// clears it alongside term.reset() so a crashed app's modes can't outlive it.

// Terminal input -> the slot's CURRENT socket (survives reconnects: `c.ws` is re-read
// each keystroke, so input always targets the live socket). The Enter-family key handler
// rides the same socket: keys whose bytes differ from xterm's native \r (per the user's
// Claude-scoped `terminalSubmit` mapping) are sent by us and the default \r suppressed.
function wireTerminalInput(term: Terminal, c: Conn): void {
  const send = (data: string): void => {
    // Announced even when the socket is down: the user typed either way, and what a parked cell
    // reads it for (#992) is "someone is using this", not "the PTY received it".
    //
    // Pointer and focus reports ride this same function — the app feeds its own clicks and wheel
    // through `term.input()` — so they have to be excluded here or clicking a parked cell to READ
    // it would wake it, which is the one thing parking is for.
    if (isTypedInput(data)) {
      c.handlers.onInput?.();
      // Someone typing is the ONLY sign of life an idle cell gets, so it is also the only chance to
      // notice that its terminal is dead. guardBufferHealth's other two callers are a fit and an
      // incoming output frame, and #846 strands a cell where neither ever runs again: the keystroke
      // reaches the pty, the reply lands in a write queue xterm will never drain, and the screen
      // stays frozen. Nothing resizes it, nothing renders, so the cell sits dead until a reload —
      // while the person in front of it types and reads it as "input is broken".
      guardBufferHealth(c);
    }
    if (c.ws && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(JSON.stringify({ type: "input", data }));
    } else if (isTypedInput(data)) {
      // A keystroke with nowhere to go is dropped in silence — the status pill is the only sign,
      // and a filmstrip cell doesn't render one. Say so once per disconnected stretch, so "I typed
      // and nothing happened" leaves evidence of WHICH of the two silences it was: a socket that is
      // down, or a terminal that has stopped drawing.
      reportDroppedInput(c);
    }
  };
  term.onData(send);
  const onEnter = makeEnterHandler(() => effectiveSubmitMode(c), send);
  const onSend = makeSendHandler(getActiveKeymap, send);
  // Clipboard first: it answers for at most two bindings and, when it answers, the key must
  // NOT be turned into bytes. Returning false here (without preventDefault) is what lets the
  // browser run the copy/paste xterm already listens for — see common/terminalClipboard.ts.
  //
  // Then `send`, then Enter. Order only decides a key bound BOTH ways, and it settles it the way
  // the more specific binding should win: copy/paste answer for at most two keys, and a `send`
  // on Enter is someone deliberately overriding the submit behaviour for this one keystroke.
  term.attachCustomKeyEventHandler((e) => {
    // Before any of the three: a key that is confirming an IME candidate belongs to the IME, and
    // all three below would otherwise claim it. Each already refuses `e.isComposing`, which covers
    // Chrome and Firefox — this is the Safari case, where compositionend has already fired and the
    // flag is false by now (#1353). `true` hands the key back to xterm, which is what happens
    // anyway when none of the three matches.
    if (isImeConfirming(e)) return true;
    if (clipboardActionFor(getActiveKeymap(), e, term.hasSelection())) return false;
    if (!onSend(e)) return false;
    return onEnter(e);
  });
}

// Linkify file paths in the output, scoped to the session's live cwd (read lazily, since
// it's learned after connect). The pane beside an enlarged cell gets first refusal, so a
// click can land NEXT to the terminal it came from; failing that, a document or an image
// opens in a new tab through the file routes, and source opens in the app's own Files view.
function registerFilePathLinks(term: Terminal, c: Conn): void {
  term.registerLinkProvider(
    createFilePathLinkProvider(
      term,
      () => c.knownCwd,
      (url) => window.open(url, "_blank", "noopener,noreferrer"),
      (filePath, cwd) => filesGotoFile(cwd, filePath),
      (filePath, cwd) => tryOpenInPane(filePath, cwd),
    ),
  );
}

interface TerminalRuntime {
  term: Terminal;
  fitAddon: FitAddon;
  host: HTMLDivElement;
}

// Everything a slot's xterm is made of. Built here rather than inline in ensure() because a
// terminal that xterm has killed can only be replaced, never revived (see rebuildTerminal).
// The mouse-mode record is passed in: it belongs to the connection and outlives any one terminal.
function buildTerminal(swallowedMouseModes: Set<number>, font: TerminalFont): TerminalRuntime {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: font.size,
    fontFamily: font.family,
    // The scrollback half of the scroll-speed setting (the alternate buffer's half is the wheel
    // accumulator in ./terminalMouseInput). Read here rather than passed in: it is one per-browser
    // value for every terminal, and setScrollSpeed() below carries a change to the live ones.
    scrollSensitivity: getTerminalScrollSpeed(),
    // Treat macOS Option as Meta so Claude's Alt bindings reach the PTY — Alt+Enter
    // (newline), Alt+B/F (word nav), Alt+Backspace (delete word). The cost is Option
    // dead-key accent entry (é etc.), which a coding terminal doesn't need.
    macOptionIsMeta: true,
    // The escape hatch for any mouse mode that still slips through the parser hooks below: on
    // macOS xterm only bypasses tracking for Option+drag, and ONLY when this is on (elsewhere it
    // is Shift+drag, which needs no option). Without it a Mac has no way to select at all (#729).
    macOptionClickForcesSelection: true,
    // `term.parser` is proposed API and THROWS without this, so the hooks below would take the
    // terminal down at construction rather than degrade.
    allowProposedApi: true,
    // OSC 8 hyperlinks in terminal output (e.g. Claude Code's statusline "PR #123"). Without a
    // handler, xterm falls back to a confirm() dialog with a strongly-worded warning on every
    // click — which reads as "the link is broken". Open http(s) targets in a new tab instead.
    linkHandler: {
      activate: (_event, uri) => {
        if (isOpenableTerminalLink(uri)) window.open(uri, "_blank", "noopener,noreferrer");
      },
    },
  });
  guardMouseTracking(term, swallowedMouseModes);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  // OSC 52 clipboard: Claude Code auto-copies the selection via OSC 52 — without this
  // addon xterm ignores it, so the copy silently never reaches the browser clipboard.
  term.loadAddon(new ClipboardAddon(undefined, clipboardProvider));
  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.height = "100%";
  term.open(host);
  guardMouseClicks(term, swallowedMouseModes);
  // After open(), so the helper textarea the clipboard fallback looks for exists in `host`.
  wireCopyOnSelect(term, host);
  // Render each glyph in its own cell (canvas) instead of the default DOM renderer, which flows text
  // as inline runs: a full-width CJK glyph that isn't exactly 2× the Latin cell lets a long Japanese
  // line drift right and spill its tail past the terminal's edge (the reason this was added, b12cc48).
  // A fixed-grid renderer makes that structurally impossible.
  //
  // CAVEAT — version mismatch: @xterm/addon-canvas is xterm-5 era (its peerDependency is
  // `@xterm/xterm@^5`, and there is no xterm-6 build — even 0.8.0-beta still peers ^5), but the app
  // runs @xterm/xterm@6. It renders, and it is NOT known to break anything: an earlier version of
  // this comment named it the suspected cause of #782 (selection auto-scroll + scrollbar) and #783
  // (OSC 8 links), and measurement disproved both. #782 is tmux owning the scrollback — the outer
  // xterm only ever receives the visible screen — and reproduced identically with the addon off.
  // #783 was tmux stripping hyperlinks (fixed in #785). Neither is a reason to change renderer.
  //
  // What the mismatch DOES mean is that a future xterm bump cannot be repaired by bumping this
  // addon, because no such release exists — see the Renderer section of docs/terminal-notes.md for
  // what to move to on the day it breaks, and what to settle before moving.
  // Best-effort: if the canvas renderer can't initialise, xterm keeps the DOM renderer.
  try {
    term.loadAddon(new CanvasAddon());
  } catch (err) {
    console.warn("[terminal] canvas renderer unavailable — falling back to the DOM renderer", err);
  }
  return { term, fitAddon, host };
}

// The wiring that needs the connection itself, so it is re-applied to every terminal a slot owns.
function wireTerminalToConn(term: Terminal, c: Conn): void {
  registerFilePathLinks(term, c);
  wireTerminalInput(term, c);
  if (c.theme) term.options.theme = c.theme;
}

function ensure(key: string, target: ConnTarget, font: TerminalFont): Conn {
  const existing = conns.get(key);
  if (existing) {
    existing.target = target;
    return existing;
  }
  const swallowedMouseModes = new Set<number>();
  const { term, fitAddon, host } = buildTerminal(swallowedMouseModes, font);
  const c: Conn = {
    key,
    term,
    fitAddon,
    host,
    ws: null,
    knownSessionId: target.sessionId,
    knownCwd: null,
    liveCwd: null,
    target,
    handlers: {},
    sawExit: false,
    released: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    attachedEl: null,
    swallowedMouseModes,
    theme: undefined,
    font,
    lastRebuildMs: 0,
    warnedDroppedInput: false,
    lastDroppedInputNoticeMs: Number.NEGATIVE_INFINITY,
  };
  conns.set(key, c);
  connView.set(key, { status: "connecting", serverCwd: target.cwd });
  wireTerminalToConn(term, c);
  return c;
}

// A terminal xterm has killed cannot be revived, so the slot gets a new one (#846). The upstream
// buffer bug (xtermjs/xterm.js#6063) throws inside xterm's own write task, which leaves the write
// queue permanently stuck — nothing written afterwards is ever parsed, and term.reset() does not
// clear it. The session itself is fine: it lives on the server, and re-attaching replays its tail
// into the fresh terminal, so the user sees the cell blink rather than a dead panel.
function rebuildTerminal(c: Conn): void {
  const deadTerm = c.term;
  const deadHost = c.host;
  const hadFocus = deadHost.contains(document.activeElement);
  console.warn(`[terminal] slot ${c.key}: xterm buffer corrupted (xtermjs/xterm.js#6063) — rebuilding the terminal and re-attaching`);
  const { term, fitAddon, host } = buildTerminal(c.swallowedMouseModes, c.font);
  c.term = term;
  c.fitAddon = fitAddon;
  c.host = host;
  c.lastRebuildMs = Date.now();
  wireTerminalToConn(term, c);
  c.attachedEl?.appendChild(host);
  deadHost.remove();
  deadTerm.dispose();
  connect(c);
  fitAndSyncSize(c);
  if (hadFocus) term.focus();
}

// A slot whose buffer went short is on its way to freezing, so it is replaced — but only once the
// state survives a task. Mid-parse the app can observe a buffer that xterm is still growing, and
// the repair costs the session's client-side scrollback, so a single sighting is not enough.
// A terminal that is genuinely dead cannot recover on its own: the reading will not change.
function guardBufferHealth(c: Conn): void {
  if (c.released || c.sawExit || Date.now() - c.lastRebuildMs < REBUILD_COOLDOWN_MS) return;
  if (!bufferIsShort(readBufferShape(c.term))) return;
  const suspect = c.term;
  setTimeout(() => {
    if (c.term !== suspect || c.released || c.sawExit) return;
    if (bufferIsShort(readBufferShape(c.term))) rebuildTerminal(c);
  });
}

function scheduleReconnect(c: Conn) {
  if (!shouldReconnect({ released: c.released, sawExit: c.sawExit, reconnectPending: c.reconnectTimer !== null, isCommand: !!c.target.command })) return;
  const delay = reconnectDelayMs(c.reconnectAttempts);
  c.reconnectAttempts++;
  c.reconnectTimer = setTimeout(() => {
    c.reconnectTimer = null;
    if (!c.released) connect(c);
  }, delay);
}

function connect(c: Conn) {
  if (c.released) return;
  if (c.reconnectTimer) {
    clearTimeout(c.reconnectTimer);
    c.reconnectTimer = null;
  }
  // Neutralise the old socket's late events via the `sock !== c.ws` guards below.
  if (c.ws) c.ws.close();
  c.term.reset();
  // The mouse modes belonged to the session being replaced. Keeping them would make the next
  // app inherit "wants wheel reports" it never asked for, and its wheel would deliver escape
  // bytes instead of scrolling (#737).
  c.swallowedMouseModes.clear();
  c.sawExit = false;
  setStatus(c, "connecting");
  // Drop the previous session's resolved cwd so the Run menu can't list/launch the
  // prior project's scripts before the new `session` message arrives.
  const v = connView.get(c.key);
  if (v) v.serverCwd = c.target.cwd;
  c.liveCwd = null;

  // Resume the known id (server-learned, or the prop) so a reconnect re-attaches the
  // same session instead of spawning a fresh one each retry.
  const resumeId = c.knownSessionId ?? c.target.sessionId;
  const secure = location.protocol === "https:";
  // The geometry rides on the URL as well as in the `resize` frame below: the frame is what keeps a
  // live pty in step, but it arrives as a separate message, and a pty spawned before it lands draws
  // its first frame at the server's default (#1178). Callers fit before connecting, so by here
  // `term.cols/rows` is the real cell.
  const url = connWsUrl(c.target, resumeId, location.host, secure, { cols: c.term.cols, rows: c.term.rows });
  const sock = new WebSocket(url);
  c.ws = sock;

  sock.onopen = () => {
    if (sock !== c.ws) return;
    c.reconnectAttempts = 0;
    // A new stretch: worth a line again, and worth saying at once rather than after whatever was
    // left of the previous stretch's cooldown.
    c.warnedDroppedInput = false;
    c.lastDroppedInputNoticeMs = Number.NEGATIVE_INFINITY;
    setStatus(c, "connected");
    sock.send(JSON.stringify({ type: "resize", cols: c.term.cols, rows: c.term.rows }));
  };
  sock.onmessage = (event) => {
    if (sock !== c.ws) return;
    handleMessage(c, event);
  };
  sock.onclose = () => {
    if (sock !== c.ws) return;
    setStatus(c, "disconnected");
    scheduleReconnect(c);
  };
  sock.onerror = () => {
    if (sock !== c.ws) return;
    setStatus(c, "disconnected");
  };
}

// The live session id, so a later reconnect resumes THIS session (esp. a brand-new one that had
// no id yet), plus the effective cwd.
function applySessionFrame(c: Conn, msg: Record<string, unknown>): void {
  if (typeof msg.id === "string") {
    c.knownSessionId = msg.id;
    c.handlers.onSession?.(msg.id);
  }
  if (typeof msg.cwd === "string") {
    c.knownCwd = msg.cwd;
    const v = connView.get(c.key);
    if (v) v.serverCwd = msg.cwd;
    c.handlers.onCwd?.(msg.cwd);
  }
}

// exit / superseded / error — a terminal message. messageEffect decides which retries, which
// fires onExit (NOT superseded — the session is alive in another tab), and the wording.
function applyTerminalFrame(c: Conn, msg: Record<string, unknown>): void {
  const effect = messageEffect(typeof msg.type === "string" ? msg.type : undefined, !!c.target.command, msg.message, exitCodeOf(msg));
  if (!effect.terminal) return;
  c.sawExit = true;
  if (effect.banner) c.term.write(effect.banner);
  setStatus(c, "disconnected");
  if (effect.callsOnExit) c.handlers.onExit?.(exitCodeOf(msg));
}

function handleMessage(c: Conn, event: MessageEvent) {
  const msg = parseServerFrame(event.data);
  if (!msg) return;
  if (msg.type === "output") {
    // Checked here as well as on fit() because a slot that is only receiving output would
    // otherwise sit frozen until something happened to resize it (#846).
    guardBufferHealth(c);
    if (typeof msg.data === "string") c.term.write(msg.data);
  } else if (msg.type === "session") {
    applySessionFrame(c, msg);
  } else if (msg.type === "cwd") {
    if (typeof msg.cwd === "string") {
      c.liveCwd = msg.cwd;
      c.handlers.onLiveCwd?.(msg.cwd);
    }
  } else {
    applyTerminalFrame(c, msg);
  }
}

// Mount a view onto a slot: create the runtime on first acquire (and connect),
// otherwise reattach the persisted xterm to the new DOM host. Never reconnects an
// already-live slot — that's the whole point (no cold resume on remount).
export function attach(key: string, target: ConnTarget, handlers: ConnHandlers, el: HTMLElement, theme?: ITheme, font: TerminalFont = DEFAULT_FONT) {
  const created = !conns.has(key);
  const c = ensure(key, target, font);
  c.released = false;
  c.handlers = handlers;
  c.attachedEl = el;
  // Replay server-learned session/cwd to the freshly-bound handlers. Without this,
  // a slot that learned its id/cwd WHILE DETACHED (handlers were cleared) would
  // never forward them, leaving the parent persisted as `session: null` and the
  // session unrestorable on reload. Only the new-vs-known case actually fires a
  // useful update; the parent's setters are idempotent for already-known values.
  if (c.knownSessionId) handlers.onSession?.(c.knownSessionId);
  if (c.knownCwd) handlers.onCwd?.(c.knownCwd);
  if (c.liveCwd) handlers.onLiveCwd?.(c.liveCwd);
  el.appendChild(c.host);
  if (theme) {
    c.theme = theme;
    c.term.options.theme = theme;
  }
  // A slot that was detached while the font changed (Settings edited from another view, a
  // different dir config, /api/config landing late) still holds the old metrics. The
  // fitAndSyncSize below re-derives cols/rows from the new cell size, so this must land
  // before it, not after.
  if (!sameFont(c.font, font)) applyFont(c, font);
  // Fit BEFORE connecting, not after: connect() puts the terminal's geometry on the URL so the pty
  // is spawned at it, and an unfitted terminal would send xterm's 80x24 default there (#1178). For
  // an already-live slot this is the same sync it always was — the send is a no-op until OPEN.
  fitAndSyncSize(c);
  if (created) connect(c);
  c.term.focus();
  // The persisted xterm was just re-parented into a new host. The sync fit() above can no-op (same size)
  // or run before layout, leaving the canvas renderer blank until a scroll. Re-fit + force a repaint next
  // frame, once the host is laid out. Guarded so a slot that detached/re-attached meanwhile is left alone.
  requestAnimationFrame(() => {
    if (c.attachedEl === el) fit(key);
  });
}

// Unmount a view but KEEP the slot alive (socket stays open, PTY stays alive). The
// xterm's host is re-parented out of the DOM; the buffer/scrollback are preserved.
export function detach(key: string, el: HTMLElement | null) {
  const c = conns.get(key);
  if (!c) return;
  if (el && c.attachedEl !== el) return; // a newer attach already took over this slot
  c.handlers = {};
  if (c.host.parentElement) c.host.remove();
  c.attachedEl = null;
}

// connectKey changed (session switch / relaunch in the same slot): point the slot
// at the new target and reconnect. Closes the previous socket, so the previous
// session falls back to the server's reap grace.
export function retarget(key: string, target: ConnTarget) {
  const c = conns.get(key);
  if (!c) return;
  c.target = target;
  c.knownSessionId = target.sessionId;
  c.knownCwd = null;
  c.reconnectAttempts = 0;
  c.sawExit = false;
  c.released = false;
  connect(c);
}

// Permanently tear the slot down (close socket, dispose xterm). Used for ephemeral
// (command) slots on unmount, and as the back end of terminate().
export function release(key: string) {
  const c = conns.get(key);
  if (!c) return;
  c.released = true;
  if (c.reconnectTimer) {
    clearTimeout(c.reconnectTimer);
    c.reconnectTimer = null;
  }
  try {
    c.ws?.close();
  } catch {
    // already closing
  }
  c.ws = null;
  try {
    c.host.remove();
  } catch {
    // not in the DOM
  }
  try {
    c.term.dispose();
  } catch {
    // already disposed
  }
  conns.delete(key);
  connView.delete(key);
}

// Explicit close (the cell's close button): tell the server to reap this session NOW instead
// of holding it through the disconnect grace window, then tear the slot down.
export function terminate(key: string) {
  const c = conns.get(key);
  if (!c) return;
  c.sawExit = true;
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "terminate" }));
  release(key);
}

// Submit a GUI-originated message into the PTY (text + a SEPARATE delayed submit — a
// same-burst text+submit reads as a paste in Claude's TUI). The submit byte follows the
// connection's `terminalSubmit` mapping (ESC+CR for a Claude cell in esc-cr mode), so a GUI
// send commits the same way the keyboard does. Both writes pin to the socket captured now;
// if the slot reconnects before the submit fires we skip it rather than submit a stray turn.
// A Claude cell's text goes through submittableFor so an open completion menu can't eat that
// submit — the Skill menu's `/<slug>` is the case that made it necessary (#1142).
// Returns whether the text was delivered.
export function submitText(key: string, text: string): boolean {
  const c = conns.get(key);
  if (!c) return false;
  const sock = c.ws;
  // The `false` used to be the whole answer, and only one caller ever read it — the rest pressed
  // a button into a closed socket and showed nothing (#1315). Saying so here reaches every host,
  // including the ones written after this line.
  if (!sock || sock.readyState !== WebSocket.OPEN) {
    reportDroppedInput(c);
    return false;
  }
  const submit = submitBytesFor(c);
  sock.send(JSON.stringify({ type: "input", data: submittableFor(c, text) }));
  setTimeout(() => {
    if (c.ws === sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "input", data: submit }));
    }
  }, 60);
  return true;
}

// Insert a MULTI-LINE block at the cursor, wrapped as a bracketed paste. Without the
// wrapper each newline in the block reads as Enter and the agent submits a fragment per
// line; inside it, the TUI takes the whole thing as one edit. No trailing CR — the user
// reads what arrived and sends it themselves. The text must already be free of control
// bytes (the server sanitizes it), or it could close the paste early.
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
export function pasteText(key: string, text: string): boolean {
  const c = conns.get(key);
  // Empty text is not a dropped paste — there was nothing to deliver, so it stays silent (#1315).
  if (!text || !c) return false;
  if (c.ws?.readyState !== WebSocket.OPEN) {
    reportDroppedInput(c);
    return false;
  }
  c.ws.send(JSON.stringify({ type: "input", data: `${PASTE_START}${text}${PASTE_END}` }));
  c.term.focus();
  return true;
}

// Paste a MULTI-LINE block and submit it. Two separate writes: same-burst text+CR reads
// as a paste in claude's TUI and the CR is swallowed, and a CR glued onto a bracketed
// paste can arrive before the paste has been committed to the input box. Both writes pin
// to the socket captured now, so a slot that reconnects mid-flight never gets a stray CR
// that would submit whatever the user had typed there instead.
const PASTE_SUBMIT_MS = 200;
export function pasteAndSubmit(key: string, text: string): boolean {
  const c = conns.get(key);
  const sock = c?.ws;
  if (!text || !c) return false; // nothing to deliver — not a drop (#1315)
  if (!sock || sock.readyState !== WebSocket.OPEN) {
    reportDroppedInput(c);
    return false;
  }
  const submit = submitBytesFor(c);
  // The guard's space rides INSIDE the paste, where the TUI takes it as text — after the
  // terminator it would be a keystroke, and an open completion menu is what reads those (#1142).
  sock.send(JSON.stringify({ type: "input", data: `${PASTE_START}${submittableFor(c, text)}${PASTE_END}` }));
  setTimeout(() => {
    if (c.ws === sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: "input", data: submit }));
  }, PASTE_SUBMIT_MS);
  return true;
}

// The slots whose conversation another cell can read. A snapshot, not a reactive view:
// the caller is a menu that opens, gets picked from, and closes. What counts as
// readable lives in readableSlot — this only flattens each Conn for it to judge.
const slotCandidate = (c: Conn): SlotCandidate => ({
  key: c.key,
  connected: c.ws?.readyState === WebSocket.OPEN,
  isCommand: c.target.command !== null,
  isShellLauncher: !!c.target.launcher && "shell" in c.target.launcher,
  sessionId: c.knownSessionId,
  cwd: c.knownCwd ?? c.target.cwd,
  agent: c.target.agent ?? "claude",
});

export function listSlots(): SlotInfo[] {
  return [...conns.values()].map(slotCandidate).flatMap((candidate) => readableSlot(candidate) ?? []);
}

// Insert text (a path, or space-joined paths) at the cursor via the normal input
// channel — no trailing CR, so the user reviews and submits.
export function insertText(key: string, text: string) {
  if (!text) return; // nothing to deliver — not a drop
  const c = conns.get(key);
  if (!c) return;
  // The quietest of the GUI paths: what arrives here was dictated, dropped or pasted, so the user
  // is watching for text to appear in the input box rather than for a reply (#1315).
  if (c.ws?.readyState === WebSocket.OPEN) {
    c.ws.send(JSON.stringify({ type: "input", data: text }));
  } else {
    reportDroppedInput(c);
  }
  c.term.focus();
}

export function focus(key: string) {
  conns.get(key)?.term.focus();
}

// Tell the server whether this slot is the user's actively-viewed pane (a grid cell
// zoomed to fill, vs. one tile among many). An active pane suppresses its attention
// flag and marks it read; an inactive grid cell can surface blocked/done while
// unfocused. No-op if the socket isn't open — Terminal.vue re-sends on (re)connect.
export function sendView(key: string, active: boolean) {
  const c = conns.get(key);
  if (c?.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "view", active }));
}

// Read a slot's xterm buffer (scrollback + viewport) as plain text — used to hand a
// command cell's captured output to the AI summariser. Each line is trailing-trimmed
// by translateToString; trailing blank lines are dropped. "" for an unknown slot.
export function readBuffer(key: string): string {
  const c = conns.get(key);
  if (!c) return "";
  const buf = c.term.buffer.active;
  const lines = Array.from({ length: buf.length }, (_, i) => buf.getLine(i)?.translateToString(true) ?? "");
  return lines.join("\n").trimEnd();
}

// A slot whose xterm is still on screen IS attached, whatever the bookkeeping says. `attachedEl` is
// what fit() and the rAF repaint key off, and it used to be a one-way door: a detach that raced a
// re-attach cleared it, and from then on the cell never fit, never sent a resize and never repainted
// — the pty froze at its last size while the browser drew the cell at a new one (#1178, and the
// blank-terminal half of #957). The host's own parent is the truth, so read it back rather than
// leaving the slot dead.
// `isConnected`, not merely "has a parent": a host sitting in a container that was itself removed
// from the document is not on screen, and adopting that orphan would point the slot at an element
// nothing can measure.
function attachedHostOf(c: Conn): HTMLElement | null {
  if (!c.attachedEl && c.host.isConnected) c.attachedEl = c.host.parentElement;
  return c.attachedEl;
}

// Refit to the current host size and push the new dimensions to the PTY.
export function fit(key: string) {
  const c = conns.get(key);
  if (!c || !attachedHostOf(c)) return;
  fitAndSyncSize(c);
  // A resize is what trips the upstream buffer bug, so this is where a short buffer shows up
  // first — usually while the terminal is still alive (#846).
  guardBufferHealth(c);
  // Force the canvas renderer to repaint. `fit()` only redraws when cols/rows actually change, so a
  // re-parent / KeepAlive reactivation with the SAME size (attach, onActivated) would otherwise leave
  // the viewport blank until a scroll. The buffer is intact — this just repaints it.
  if (c.term.rows > 0) c.term.refresh(0, c.term.rows - 1);
}

export function setTheme(key: string, theme: ITheme) {
  const c = conns.get(key);
  if (!c) return;
  c.theme = theme;
  c.term.options.theme = theme;
}

// Set both options together, without fitting — attach() calls this because it fits immediately
// after, and setFont() because it fits itself. Splitting them would fit twice for one change.
function applyFont(c: Conn, font: TerminalFont): void {
  c.font = font;
  c.term.options.fontSize = font.size;
  c.term.options.fontFamily = font.family;
}

// Unlike setTheme, this changes the CELL METRICS — a different size or a different face means a
// different advance width — so the terminal's cols/rows no longer match the host while the PTY
// still believes the old geometry. Without the re-fit the canvas grid and the PTY disagree: the
// same misalignment (drifting cursor, wrong wrap points) that made browser zoom useless as a
// workaround in #860.
export function setFont(key: string, font: TerminalFont) {
  const c = conns.get(key);
  if (!c || sameFont(c.font, font)) return;
  applyFont(c, font);
  fitAndSyncSize(c);
}

// The scroll speed changes nothing about the cell metrics, so unlike setFont this needs no
// re-fit. Applied to EVERY slot, not one: the setting is per browser, and a terminal in another
// grid cell that kept the old speed would look like the setting only half worked. The alternate
// buffer's wheel handler reads the same value per event, so it needs no push.
export function setScrollSpeed(speed: number) {
  conns.forEach((c) => {
    c.term.options.scrollSensitivity = speed;
  });
}

// Watched here, at module scope, rather than in Terminal.vue the way the font is: the font is a
// per-slot value (a directory can pin its own), the scroll speed is one value for the browser, so
// a per-component watch would run the same global update once per open terminal. This manager
// outlives every component, which is exactly the lifetime the watch wants.
watch(getTerminalScrollSpeed, setScrollSpeed);
