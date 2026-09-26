// The user-defined keyboard shortcuts, in `~/.mulmoterminal/config.json` under `keymap`.
//
// There are NO defaults: an absent or empty `keymap` means the shortcuts are OFF. Every
// binding is something the user opted into, because any key this claims is a key the
// terminal underneath stops receiving — that trade is the user's to make, not ours.
//
// The server sanitizes and persists it; the browser matches keydowns against it. One
// definition here so the accepted syntax can't drift between the two.
//
//   "keymap": { "zoom-next": "PageDown", "zoom-prev": "Shift+PageUp", "files-find": "Cmd+K p" }

// Actions a key can be bound to. Adding one here is all it takes for the config to accept it.
import { isRecord } from "./isRecord.js";

export const KEYMAP_ACTIONS = [
  "zoom-toggle",
  "zoom-next",
  "zoom-prev",
  "focus-next",
  "focus-prev",
  "next-attention",
  "terminal-new",
  "terminal-new-here",
  "terminal-new-adjacent",
  "terminal-close",
  "terminal-restart",
  "files-find",
  "files-search",
  "copy",
  "paste",
] as const;
export type KeymapAction = (typeof KEYMAP_ACTIONS)[number];

export const isKeymapAction = (value: unknown): value is KeymapAction => typeof value === "string" && KEYMAP_ACTIONS.some((action) => action === value);

// action -> binding string. Absent action = unbound = that shortcut does nothing.
// Actions the GRID's key handler must never claim, because they are decided inside the terminal
// instead (see terminalClipboard.ts). One `keymap` block stays the user's single place to bind a
// key; only the dispatch differs, and it has to:
//
//   - The grid handler ends every match with preventDefault(). For `paste` that is fatal — the
//     browser's own paste is what actually inserts the text, and cancelling the keydown cancels
//     it. xterm implements paste as a `paste` DOM listener, not a key binding.
//   - `copy` must fall through to the terminal when there is NO selection, so Ctrl+C still sends
//     ^C. A handler that has already swallowed the key cannot change its mind.
export const TERMINAL_SCOPED_ACTIONS: readonly KeymapAction[] = ["copy", "paste"];

// Actions that act ON a terminal and so need one the grid can name. The enlarged cell is the only
// such state the grid has, so un-zoomed these do nothing rather than guessing which cell was meant.
// `terminal-new` is exempt (appending needs no subject), and so are `zoom-toggle` / `next-attention`,
// which pick the cell themselves — that is what makes them the keyboard's way INTO the zoom.
//
// Here rather than beside gridShortcutFor because BOTH sides decide from it: the grid dispatches on
// it, and validateKeymap has to know that these decline the key — the handler returns WITHOUT
// stopping the event, so a `send` on the same keystroke fires instead (codex on #1906).
// `files-find` and `files-search` are here because the pane they open exists only in the ENLARGED
// row (see docs/grid-view-modes.md) — a tiled grid has nowhere to put it, so the key declines
// rather than guessing which of nine terminals was meant.
export const NEEDS_A_CURRENT_TERMINAL: readonly KeymapAction[] = [
  "zoom-next",
  "zoom-prev",
  "terminal-new-adjacent",
  "terminal-close",
  "terminal-restart",
  "files-find",
  "files-search",
];

// The mirror of the list above: actions that walk the TILED grid, and so need nothing enlarged.
// While a cell is, every other cell is either off-screen or parked in the roster, and moving the
// cursor into one would put it somewhere the user cannot see.
//
// This is deliberately NOT one key meaning two things by state. An action has ONE meaning and
// declines where it has none — exactly as NEEDS_A_CURRENT_TERMINAL does in the other state. Binding
// one keystroke to `zoom-prev` AND `focus-prev` still resolves to a single action, because
// `actionForKey` stops at the first bound one, and validateKeymap reports that. Picking the action
// by state would mean an ordered-candidates resolver plus action-to-action collision reporting; see
// plans/feat-2106-focus-prev-next.md for why that is a change of its own.
export const NEEDS_NOTHING_ENLARGED: readonly KeymapAction[] = ["focus-next", "focus-prev"];

// A key that puts BYTES into the focused terminal instead of running an app action (#1005) —
// Cmd+Right as Ctrl+E for end-of-line, say, or Alt+B for word-back.
//
// A LIST, where every action above is a single field, because the two are shaped differently:
// an action is one behaviour that a key is pointed at, while every send binding carries its own
// payload. `{ "send": "\u0005" }` could only ever name one key.
//
// `bytes` goes to the PTY verbatim. Control characters are written the way JSON writes them
// (`"\u0005"` is Ctrl+E); nothing here interprets or re-escapes them.
export interface SendBinding {
  key: string;
  bytes: string;
}

export type Keymap = Partial<Record<KeymapAction, string>> & { send?: SendBinding[] };

// A parsed binding. `key` is matched against `KeyboardEvent.key` exactly as the browser
// reports it, so it is case-sensitive for printable characters ("a" and "A" differ, the
// latter implying Shift) — except while Cmd is held on macOS, where the browser reports the
// UNSHIFTED character and an uppercase letter is unreachable (validateKeymap warns, #2125).
export interface KeyBinding {
  key: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

// Modifier spellings accepted in a binding string, mapped to the flag they set. "Cmd",
// "Command" and "Meta" are the same modifier; "Option" is macOS's name for Alt.
const MODIFIERS: Record<string, keyof Omit<KeyBinding, "key">> = {
  shift: "shift",
  alt: "alt",
  option: "alt",
  ctrl: "ctrl",
  control: "ctrl",
  meta: "meta",
  cmd: "meta",
  command: "meta",
};

// Parse "Shift+PageUp" into its parts, or null when the string is malformed (empty, no
// key left after the modifiers, an unknown modifier, or a duplicate one). Callers treat
// null as "unbound" rather than throwing: a typo in a hand-edited config must cost the
// user that one shortcut, never the app.
export function parseKeyBinding(input: string): KeyBinding | null {
  const parts = input.split("+").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part === "")) return null;
  const key = parts[parts.length - 1];
  if (key === undefined) return null; // unreachable: parts.length was checked above
  // No browser reports a key with whitespace in it, so `"Cmd+K p"` read as ONE keystroke named
  // "K p" was accepted and never fired. A sequence is spelled with a space; see parseKeySequence.
  if (/\s/.test(key)) return null;
  const binding: KeyBinding = { key, shift: false, alt: false, ctrl: false, meta: false };
  for (const part of parts.slice(0, -1)) {
    const flag = MODIFIERS[part.toLowerCase()];
    if (!flag || binding[flag]) return null; // unknown, or named twice
    binding[flag] = true;
  }
  // A lone modifier ("Shift") binds nothing usable.
  return MODIFIERS[key.toLowerCase()] ? null : binding;
}

// The most keystrokes one binding can be. Two is a prefix and a key after it, as in tmux or Emacs's
// `C-x b` — enough to put many actions behind one key the browser lets through (#2265).
export const MAX_SEQUENCE_STROKES = 2;

// Parse `"Cmd+K p"` into its keystrokes, or null when it is malformed. Strokes are separated by
// whitespace, which no single keystroke can contain. A single keystroke is a sequence of one.
export function parseKeySequence(input: string): KeyBinding[] | null {
  const strokes = input.trim().split(/\s+/);
  if (strokes.length > MAX_SEQUENCE_STROKES) return null;
  const parsed = strokes.map(parseKeyBinding);
  return parsed.every((stroke): stroke is KeyBinding => stroke !== null) ? parsed : null;
}

// Actions that can be bound to a sequence. Not `copy` / `paste`: they are decided inside the
// terminal, one keystroke at a time (TERMINAL_SCOPED_ACTIONS), and nothing there can wait.
export const takesSequence = (action: KeymapAction): boolean => !TERMINAL_SCOPED_ACTIONS.includes(action);

/** One action bound to two keystrokes. */
export interface SequenceBinding {
  action: KeymapAction;
  first: KeyBinding;
  second: KeyBinding;
  /** How the user wrote each keystroke, for the hint shown while waiting for the second. */
  firstLabel: string;
  secondLabel: string;
}

// Every two-keystroke binding in a keymap, in action order.
export function sequenceBindings(keymap: Keymap): SequenceBinding[] {
  return KEYMAP_ACTIONS.flatMap((action): SequenceBinding[] => {
    const raw = keymap[action];
    const strokes = raw === undefined || !takesSequence(action) ? null : parseKeySequence(raw);
    const [first, second] = strokes ?? [];
    const [firstLabel, secondLabel] = raw?.trim().split(/\s+/) ?? [];
    return first && second && firstLabel && secondLabel ? [{ action, first, second, firstLabel, secondLabel }] : [];
  });
}

// The structural shape of a keydown a binding is matched against. A real KeyboardEvent
// satisfies it, and so does a plain test object — no DOM dependency.
export interface KeymapKeyEvent {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

// Every modifier must match exactly, so a binding on "PageDown" does NOT fire for
// Shift+PageDown — that keystroke stays with the terminal (xterm's scrollback) unless the
// user binds it too.
export const matchesBinding = (binding: KeyBinding, e: KeymapKeyEvent): boolean =>
  e.key === binding.key && e.shiftKey === binding.shift && e.altKey === binding.alt && e.ctrlKey === binding.ctrl && e.metaKey === binding.meta;

// The action this keydown is bound to, or null. Bindings that fail to parse are skipped.
export function actionForKey(keymap: Keymap, e: KeymapKeyEvent): KeymapAction | null {
  for (const action of KEYMAP_ACTIONS) {
    const raw = keymap[action];
    if (raw === undefined) continue;
    // A sequence is resolved by prefixStep (src/composables/prefixKeys.ts), never here.
    const binding = parseKeyBinding(raw);
    if (binding && matchesBinding(binding, e)) return action;
  }
  return null;
}

const isSendBinding = (value: unknown): value is SendBinding => isRecord(value) && typeof value.key === "string" && typeof value.bytes === "string";

// The bytes this keydown should put into the terminal, or null when it is not a send binding.
//
// Only reachable for keys the GRID did not claim: its handler listens on `window` in the capture
// phase and calls stopPropagation(), so an action and a send binding on one keystroke is not a
// race — the action always wins and the send silently never fires. validateKeymap warns about it
// for that reason.
//
// First match wins, so a keystroke listed twice uses the earlier entry.
export function sendBytesFor(keymap: Keymap, e: KeymapKeyEvent & { type: string; isComposing?: boolean }): string | null {
  if (e.type !== "keydown" || e.isComposing) return null;
  for (const entry of keymap.send ?? []) {
    const binding = parseKeyBinding(entry.key);
    if (binding && matchesBinding(binding, e)) return entry.bytes;
  }
  return null;
}

// What is wrong with one `keymap` entry. `fatal` separates a typo the user clearly meant to
// work (a binding we cannot parse — the shortcut would silently never fire) from an action
// name we simply do not know, which is what a config written for a NEWER version looks like
// and must stay loadable.
export interface KeymapProblem {
  action: string;
  binding: unknown;
  reason: string;
  fatal: boolean;
}

// Report everything wrong with a `keymap`, for a caller that wants to tell the user instead
// of quietly dropping entries. Pure: the caller decides whether to warn, throw, or exit.
export function validateKeymap(input: unknown): KeymapProblem[] {
  if (input === undefined || input === null) return [];
  if (typeof input !== "object" || Array.isArray(input)) {
    return [{ action: "keymap", binding: input, reason: "`keymap` must be an object of action -> key binding", fatal: true }];
  }
  const entries = Object.entries(input);
  // A claim on one keystroke. `rank` is DISPATCH order, so the winner can be named — with ONE
  // exception, which is why `kind` is carried alongside it.
  //
  // Most actions are claimed by the grid in the capture phase, before the terminal sees the key.
  // `copy` and `paste` are not (TERMINAL_SCOPED_ACTIONS — gridShortcutFor skips them); they are
  // decided inside the terminal by clipboardActionFor, which runs ahead of the send handler. So
  // `paste` still outranks a send.
  //
  // `copy` does NOT, unconditionally: clipboardActionFor returns null when nothing is selected —
  // deliberately, so Ctrl+C stays an interrupt — and the same-key send fires then. Naming `copy`
  // as the winner there tells the user the opposite of what they will see half the time (#1901).
  const bound = new Map<string, Claim[]>();
  const claim = (strokes: KeyBinding[], entry: Claim): void => {
    const key = canonicalSequence(strokes); // as PARSED: "Shift+PageUp" and "shift+pageup" are one keystroke
    bound.set(key, [...(bound.get(key) ?? []), entry]);
  };
  const problems = entries.flatMap(([action, binding]): KeymapProblem[] =>
    action === "send" ? sendProblems(binding, claim) : actionProblems(action, binding, claim),
  );
  return [...problems, ...duplicateWarnings(bound), ...prefixWarnings(bound)];
}

// Everything wrong with one action's binding, claiming its keystrokes when it is well-formed.
function actionProblems(action: string, binding: unknown, claim: (strokes: KeyBinding[], entry: Claim) => void): KeymapProblem[] {
  if (!isKeymapAction(action)) {
    return [{ action, binding, reason: `unknown action (known: ${KEYMAP_ACTIONS.join(", ")}, send)`, fatal: false }];
  }
  if (typeof binding !== "string") return [{ action, binding, reason: "binding must be a string", fatal: true }];
  const strokes = parseKeySequence(binding);
  if (strokes === null) {
    return [{ action, binding, reason: 'unparseable key binding — expected e.g. "PageDown", "Shift+PageUp" or two keys "Cmd+K p"', fatal: true }];
  }
  if (strokes.length > 1 && !takesSequence(action)) {
    return [{ action, binding, reason: "takes a single keystroke — it is decided inside the terminal, which cannot wait for a second key", fatal: true }];
  }
  claim(strokes, { label: action, binding, rank: KEYMAP_ACTIONS.indexOf(action), kind: "action" });
  return strokes.flatMap((stroke) => unshiftedUnderCmdWarnings(action, binding, stroke));
}

// A sequence whose FIRST key is also a keystroke of its own. The single keystroke is claimed before
// any sequence can start (see GridView's handler), so the sequence never gets its first key.
function prefixWarnings(bound: Map<string, Claim[]>): KeymapProblem[] {
  return [...bound.entries()].flatMap(([key, claims]) => {
    const [first, second] = key.split(SEQUENCE_SEPARATOR);
    const single = second === undefined || first === undefined ? undefined : bound.get(first)?.[0];
    return single
      ? claims.map((claim) => ({
          action: claim.label,
          binding: claim.binding,
          reason: `its first key is also bound to \`${single.label}\` on its own, which takes it — this sequence never starts`,
          fatal: false,
        }))
      : [];
  });
}

// A binding that says one keystroke and waits for another. While Cmd is held, a macOS browser puts
// the UNSHIFTED character in `KeyboardEvent.key` — Cmd+Shift+P arrives as `"p"` — so a binding
// written `"Cmd+Shift+P"` waits for a `"P"` that never comes, and nothing downstream can see the
// difference between that and a shortcut the user has not pressed yet (#2125).
//
// Safari and Chrome both do this and w3c/uievents#169 is still open, so it is the platform, not a
// bug to route around: matching stays case-sensitive (`"a"` and `"A"` are different keystrokes,
// pinned by the specs) and this only says so out loud.
//
// A WARNING, not an error: the deviation is macOS's, so a browser following the spec reports `"P"`
// and the identical entry is correct there — and the server cannot know which one will connect.
const UPPERCASE_ASCII_LETTER = /^[A-Z]$/;
const unshiftedUnderCmdWarnings = (action: string, binding: string, parsed: KeyBinding): KeymapProblem[] =>
  parsed.meta && parsed.shift && UPPERCASE_ASCII_LETTER.test(parsed.key)
    ? [
        {
          action,
          binding,
          reason: `never fires in a macOS browser — with Cmd held it reports the unshifted letter, so write the key lowercase ("${parsed.key.toLowerCase()}")`,
          fatal: false,
        },
      ]
    : [];

interface Claim {
  label: string;
  binding: string;
  rank: number;
  /** Which side of the dispatch this is. `copy` vs a `send` is the one collision whose winner
   *  depends on runtime state, and that cannot be read back off `label`. */
  kind: "action" | "send";
}

// Everything wrong with the `send` list, claiming the keystrokes that are well-formed.
//
// Fatal throughout, for the reason the module header gives: a send binding is invisible until
// the key is pressed, so a dropped one is indistinguishable from a shortcut that "doesn't work".
// Empty `bytes` is fatal too — it would take the key away from the terminal and put nothing back.
function sendProblems(input: unknown, claim: (strokes: KeyBinding[], entry: Claim) => void): KeymapProblem[] {
  if (!Array.isArray(input)) {
    return [{ action: "send", binding: input, reason: "`send` must be an array of { key, bytes }", fatal: true }];
  }
  return input.flatMap((entry, i): KeymapProblem[] => {
    const label = `send[${i}]`;
    if (!isSendBinding(entry)) return [{ action: label, binding: entry, reason: "expected { key: string, bytes: string }", fatal: true }];
    const parsed = parseKeyBinding(entry.key);
    if (parsed === null) {
      return [{ action: label, binding: entry.key, reason: 'unparseable key binding — expected e.g. "Cmd+ArrowRight"', fatal: true }];
    }
    if (entry.bytes === "") {
      return [{ action: label, binding: entry.key, reason: "`bytes` is empty — the key would be taken from the terminal and nothing sent", fatal: true }];
    }
    // Ranked after every action, matching who actually wins (see the `bound` comment above).
    claim([parsed], { label, binding: entry.key, rank: KEYMAP_ACTIONS.length + i, kind: "send" });
    return unshiftedUnderCmdWarnings(label, entry.key, parsed);
  });
}

// Two claims on one keystroke: only one can fire, so the others silently never work.
//
// The winner is the one DISPATCH picks, not the one written first in the config file. Reporting
// the config-order winner would name the wrong entry whenever the two orders disagree, which is
// worse than not naming one.
function duplicateWarnings(bound: Map<string, Claim[]>): KeymapProblem[] {
  return [...bound.values()].flatMap((claims) => {
    if (claims.length < 2) return [];
    const [winner, ...losers] = [...claims].sort((a, b) => a.rank - b.rank);
    if (!winner) return []; // unreachable: claims.length >= 2 was checked above
    const runnerUp = fallthroughWinner(winner, losers);
    return losers.map((loser) => ({
      action: loser.label,
      binding: loser.binding,
      reason: collisionReason(winner, runnerUp, loser),
      fatal: false,
    }));
  });
}

// An action that DECLINES the keystroke in some runtime state, letting it fall through to a `send`
// binding on the same key. Naming such an action as the sole winner is wrong whenever the user is
// in the other state, which is the whole of #1901.
//
// Two handlers decline, for the same structural reason — each returns WITHOUT stopping the event:
//
//   - `copy` with no selection (clipboardActionFor), deliberately, so Ctrl+C stays interrupt.
//   - NEEDS_A_CURRENT_TERMINAL with nothing enlarged (gridShortcutFor).
//   - NEEDS_NOTHING_ENLARGED with something enlarged (gridShortcutFor), the mirror of it.
//
// `acts` and `otherwise` are the two halves of what the user is told.
interface StandsAside {
  acts: string;
  otherwise: string;
}
const WHILE_ENLARGED: StandsAside = { acts: "only while a terminal is enlarged", otherwise: "when none is" };
const WHILE_NOT_ENLARGED: StandsAside = { acts: "only while no terminal is enlarged", otherwise: "when one is" };
const standsAside = (label: string): StandsAside | null => {
  if (label === "copy") return { acts: "only while text is selected", otherwise: "when nothing is" };
  if (NEEDS_NOTHING_ENLARGED.some((action) => action === label)) return WHILE_NOT_ENLARGED;
  return NEEDS_A_CURRENT_TERMINAL.some((action) => action === label) ? WHILE_ENLARGED : null;
};

// The claim that fires when the winner stands aside, or null when the winner takes every state.
//
// Only a send can be this one. `actionForKey` returns the lowest-ranked bound action and stops, so
// a second ACTION on the key is never reached in either state; and `sendBytesFor` takes the FIRST
// match, so only the first send is. A conditional collision therefore has exactly TWO reachable
// claims and every later one is unreachable in BOTH states.
const fallthroughWinner = (winner: Claim, losers: Claim[]): Claim | null =>
  winner.kind === "action" && standsAside(winner.label) !== null ? (losers.find((claim) => claim.kind === "send") ?? null) : null;

// What the user will actually see, which is not always a single winner.
const collisionReason = (winner: Claim, runnerUp: Claim | null, loser: Claim): string => {
  const aside = standsAside(winner.label);
  if (runnerUp === null || aside === null) return `same keystroke as \`${winner.label}\` — only \`${winner.label}\` will fire`;
  if (loser === runnerUp) {
    return `same keystroke as \`${winner.label}\` — \`${winner.label}\` acts ${aside.acts}, and \`${loser.label}\` fires ${aside.otherwise}`;
  }
  return `same keystroke as \`${winner.label}\` and \`${runnerUp.label}\` — \`${winner.label}\` acts ${aside.acts} and \`${runnerUp.label}\` fires ${aside.otherwise}, so \`${loser.label}\` never fires`;
};

// A binding's identity as a keystroke, for spotting two actions that claim the same one.
const canonicalBinding = (b: KeyBinding): string => `${b.shift ? "S" : ""}${b.alt ? "A" : ""}${b.ctrl ? "C" : ""}${b.meta ? "M" : ""}|${b.key}`;

// The same for a sequence. A keystroke's identity cannot contain the separator, because no key
// does (parseKeyBinding refuses whitespace), so a sequence's first key splits back out exactly.
const SEQUENCE_SEPARATOR = " ";
const canonicalSequence = (strokes: KeyBinding[]): string => strokes.map(canonicalBinding).join(SEQUENCE_SEPARATOR);

// A binding the dispatch can act on: it parses, and it is a single keystroke unless the action can
// wait for a second one.
const isUsableBinding = (action: KeymapAction, binding: string): boolean => {
  const strokes = parseKeySequence(binding);
  return strokes !== null && (strokes.length === 1 || takesSequence(action));
};

// Keep only known actions bound to a parseable, non-empty string. Unknown keys and
// malformed bindings are dropped rather than rejecting the whole map, matching how the
// rest of the config treats one bad entry.
export function sanitizeKeymap(input: unknown): Keymap {
  if (!isRecord(input)) return {};
  const entries = Object.entries(input).filter(
    (entry): entry is [KeymapAction, string] => isKeymapAction(entry[0]) && typeof entry[1] === "string" && isUsableBinding(entry[0], entry[1]),
  );
  const send = sanitizeSendBindings(input.send);
  return { ...Object.fromEntries(entries), ...(send.length ? { send } : {}) };
}

// An entry survives only if it names a parseable key AND carries bytes to send. An empty `send`
// is dropped entirely rather than kept as `[]`, so an absent and an emptied list look the same
// to everything downstream.
const sanitizeSendBindings = (input: unknown): SendBinding[] =>
  Array.isArray(input) ? input.filter(isSendBinding).filter((entry) => entry.bytes !== "" && parseKeyBinding(entry.key) !== null) : [];
