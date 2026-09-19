// What the Files pane had open, remembered ACROSS RELOADS and keyed by directory (#958).
//
// The in-memory map beside this one is keyed by cell uid and stays that way: two terminals in
// the same repository is the ordinary case, and during a session each should remember its own
// tree. A uid is not the same number after a reload though, so it cannot be what survives one
// — the directory is. The two layers are read memory-first, so nothing about a live session
// changes; the directory layer only answers when the memory layer is empty, which is exactly
// the first look after a reload.
//
// Pure: no localStorage here. The host reads and writes the string through its own best-effort
// storage helpers, which is also what makes this testable without a DOM.
import type { FilesPaneState } from "./filesPaneState";
import type { CaretAt } from "./cmEditor";
import { isRecord } from "../../common/isRecord";

export interface RememberedPane {
  cwd: string;
  state: FilesPaneState;
}

/** A pane state as it comes back OUT of storage. `showPreview` is `unknown` on purpose: it is
 *  absent in everything written before the view mode was remembered (#2137), and a value of any
 *  other shape must cost the reader the MODE alone — never the open file they came back for.
 *  `capped` is what turns one of these into a `FilesPaneState`. */
type StoredPaneState = Omit<FilesPaneState, "showPreview" | "caret" | "treeScrollTop"> & {
  showPreview?: unknown;
  caret?: unknown;
  treeScrollTop?: unknown;
};

/** A caret is two WHOLE numbers and nothing else — a document position is an integer, and a
 *  fractional one is not rejected downstream: it lands on a fractional offset and reads back as a
 *  fractional column, which is then what gets remembered (Codex on #2156). Anything else costs the
 *  CARET — the reader lands at the top of the file they asked for, which is where they landed
 *  before this existed. */
const asCaret = (value: unknown): CaretAt | undefined =>
  isRecord(value) && Number.isInteger(value.line) && Number.isInteger(value.col) && typeof value.line === "number" && typeof value.col === "number"
    ? { line: value.line, col: value.col }
    : undefined;

/** A scroll offset the browser could actually be at. A negative or non-finite one is dropped rather
 *  than clamped: it did not come from a scrollbar, so guessing what it meant helps nobody. */
const asScrollTop = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

/** A line number the document could actually have: whole, and at least the first line. */
const asLine = (value: unknown): number | undefined => (Number.isInteger(value) && typeof value === "number" && value >= 1 ? value : undefined);

interface StoredPane {
  cwd: string;
  state: StoredPaneState;
}

/** Directories kept, newest first. A browser-wide cap: without one this grows for as long as the
 *  user opens new projects, and localStorage answers a quota error by failing the whole write. */
export const MAX_REMEMBERED_DIRS = 20;

/** Expanded paths kept per directory. One pathological tree (a node_modules walked open) would
 *  otherwise be large enough to cost every OTHER directory its entry. */
export const MAX_EXPANDED_PATHS = 200;

const isPaneState = (value: unknown): value is StoredPaneState => {
  if (!isRecord(value)) return false;
  const { openPath, expanded } = value;
  const openPathOk = openPath === null || typeof openPath === "string";
  return openPathOk && Array.isArray(expanded) && expanded.every((p) => typeof p === "string");
};

/** Both caps applied. Shared by the write and the read so the two cannot drift: a bound only
 *  enforced on write is no bound at all once a value written by another build — or by hand —
 *  is in storage, and `restore()` walks every path in the list. */
const capped = (state: StoredPaneState): FilesPaneState => {
  const caret = asCaret(state.caret);
  const topLine = asLine(state.topLine);
  const treeScrollTop = asScrollTop(state.treeScrollTop);
  return {
    openPath: state.openPath,
    expanded: state.expanded.slice(0, MAX_EXPANDED_PATHS),
    showPreview: state.showPreview === true,
    // Spread rather than assigned: `exactOptionalPropertyTypes` makes an explicit `undefined`
    // different from an absent key, and absent is what "nothing was remembered" means here.
    ...(caret ? { caret } : {}),
    ...(topLine ? { topLine } : {}),
    ...(treeScrollTop === undefined ? {} : { treeScrollTop }),
  };
};

const isRemembered = (value: unknown): value is StoredPane => {
  if (!isRecord(value)) return false;
  const { cwd, state } = value;
  return typeof cwd === "string" && cwd !== "" && isPaneState(state);
};

/** Read back what was stored. Anything unparseable or the wrong shape is dropped rather than
 *  thrown: this is a convenience, and a bad entry must not cost the user a working pane. */
export function parsePaneStore(raw: string | null): RememberedPane[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRemembered)
      .slice(0, MAX_REMEMBERED_DIRS)
      .map((entry) => ({ cwd: entry.cwd, state: capped(entry.state) }));
  } catch {
    return []; // not JSON at all — a foreign or half-written value
  }
}

/** `store` with `cwd` recorded at the front, its previous entry removed. Newest-first order is
 *  what makes the cap an LRU rather than an arbitrary truncation. */
export function rememberPane(store: RememberedPane[], cwd: string, state: FilesPaneState): RememberedPane[] {
  return [{ cwd, state: capped(state) }, ...store.filter((entry) => entry.cwd !== cwd)].slice(0, MAX_REMEMBERED_DIRS);
}

/** What this directory had open, or null when it is not remembered. */
export function recallPane(store: RememberedPane[], cwd: string | null): FilesPaneState | null {
  if (!cwd) return null;
  return store.find((entry) => entry.cwd === cwd)?.state ?? null;
}
