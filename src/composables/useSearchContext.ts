// The lines around the search result the reader is on (#2159).
//
// A result row is one line, which is often not enough to tell whether it is the one you want. The
// surrounding lines are read HERE rather than asked of `git grep -C`, and that is the whole design
// decision: under `-z` git stops distinguishing a matched line from a context line, and the field
// that would distinguish them can be forged by a text file carrying a NUL past git's binary sniff
// window — a context line then becomes a selectable result whose text is silently cut. The search
// parser stays untouched and the context comes from an ordinary read.
//
// Which also gives the one answer no on-disk read could: the file open in the editor with unsaved
// edits is answered from the BUFFER, with no request at all.
import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from "vue";
import { CONTEXT_RADIUS_LINES, lineWindow, type LineWindow, type WindowLine } from "../../common/fileSearch";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { browseUrl } from "../components/filesPaneApi";

/** Shorter than the search's own debounce: this is a local file read, not a subprocess, and the
 *  reader is holding an arrow key rather than typing. Long enough that walking a list does not
 *  start a request per row. */
const CONTEXT_DEBOUNCE_MS = 90;

/** What the reader is looking at. */
export interface SelectedResult {
  path: string;
  line: number;
}

export interface SearchContextDeps {
  cwd: Ref<string | null>;
  /** The remote host the root is on; absent or null for this machine. */
  host?: () => string | null;
  /** The open buffer and its CURRENT text, when it has unsaved edits — the one file whose
   *  surroundings are not on disk. Null when nothing is dirty. */
  buffer: Ref<{ path: string; text: string } | null>;
  selected: Ref<SelectedResult | null>;
}

export interface SearchContext {
  /** The lines around the selection, or null when there is nothing selected, the read has not
   *  landed, or it failed. */
  surrounding: ComputedRef<LineWindow | null>;
  /** End this consumer's interest in the read: the pending one is dropped, and anything already
   *  in flight loses the right to apply its answer. Idempotent, and registered on scope disposal
   *  too, so a caller that never calls it is still covered. */
  stop: () => void;
}

const isWindowLine = (value: unknown): value is WindowLine => isRecord(value) && typeof value.text === "string" && typeof value.clipped === "boolean";

/** Checked off the wire like every other answer this panel renders: these lines are drawn under a
 *  line NUMBER, so a malformed entry would put text on screen against a line that does not hold
 *  it. `{}` from an unreadable body fails here, which is what keeps it off the success path. */
const asLineWindow = (data: Record<string, unknown>): LineWindow | null => {
  if (typeof data.from !== "number" || !Number.isInteger(data.from) || !isUnknownArray(data.lines)) return null;
  return data.lines.every(isWindowLine) ? { from: data.from, lines: data.lines } : null;
};

export function useSearchContext(deps: SearchContextDeps): SearchContext {
  // The buffer answers for itself, synchronously, and re-answers on every edit — the reader is
  // looking at the file they are changing, so context a keystroke old is the wrong context.
  const fromBuffer = computed((): LineWindow | null => {
    const selected = deps.selected.value;
    const buffer = deps.buffer.value;
    if (!selected || buffer?.path !== selected.path) return null;
    return lineWindow(buffer.text, selected.line, CONTEXT_RADIUS_LINES);
  });

  /** What identifies a read. Null when there is nothing to read — no selection, or the buffer has
   *  already answered. A STRING so that a buffer edit, which rebuilds the buffer object on every
   *  keystroke, does not look like a new selection and start a request; `JSON.stringify` rather
   *  than a joined separator because a path may contain any byte but NUL, newlines included. */
  const diskKey = computed((): string | null => {
    const selected = deps.selected.value;
    if (!selected || deps.buffer.value?.path === selected.path) return null;
    return JSON.stringify([deps.cwd.value, selected.path, selected.line]);
  });

  // Stored WITH the key it answers, and dropped on every key change. See `latest` for the rule
  // both of those serve.
  const fromDisk = ref<{ key: string; window: LineWindow } | null>(null);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;

  /**
   * THE RULE, and the only one: an answer may be applied only while its request is the newest.
   *
   * Two events end a request's right to write, and both advance this — the selection key changing,
   * and teardown. `cwd` and the buffer's hold on the open file are inputs to the key, so they
   * arrive as key changes; teardown arrives by two paths, an explicit `stop` and scope disposal,
   * and both are wired.
   *
   * It is stated as what MAY be applied rather than as a list of what must be rejected, because
   * three review rounds each found a different way for an older answer to win: the stored one was
   * re-served when the selection came back, an arriving one won by answering last, and one
   * outlived the composable. A list of those three would have invited a fourth.
   *
   * ABORTING IS NOT THIS RULE and cannot replace it. Abort is not retroactive: a body whose
   * promise has already resolved still runs its continuation, and that continuation would reach
   * the ref. Abort saves the transfer; this decides what may be written.
   *
   * `runSearch` in FileSearch.vue carries the same guard for the same reason (#620). Its absence
   * here was the inconsistency.
   */
  let latest = 0;

  async function load(key: string, cwd: string | null, selected: SelectedResult): Promise<void> {
    const seed = latest;
    const abort = new AbortController();
    inFlight = abort;
    try {
      const params = new URLSearchParams({ path: selected.path, line: String(selected.line) });
      if (cwd) params.set("cwd", cwd);
      const res = await fetchWithTimeout(browseUrl(deps.host?.() ?? null, "lines", params.toString()), { signal: abort.signal });
      const data = await jsonBody(res);
      // The generation, never the key: "is this the row we are on" is true again after leaving a
      // row and coming back, so an older request for it would pass. See `latest`.
      if (!res.ok || seed !== latest) return;
      const answered = asLineWindow(data);
      if (answered) fromDisk.value = { key, window: answered };
    } catch {
      // A peek that could not be read simply shows no peek. There is nothing to report: the result
      // row is unaffected and still opens, and an error banner here would be about a file the
      // reader has done no more than move the selection onto.
    }
  }

  watch(diskKey, (key) => {
    if (timer) clearTimeout(timer);
    inFlight?.abort();
    // Everything already in flight belongs to a generation that has passed, whatever it answers.
    latest += 1;
    fromDisk.value = null;
    if (key === null) return;
    const selected = deps.selected.value;
    const cwd = deps.cwd.value;
    if (!selected) return;
    timer = setTimeout(() => void load(key, cwd, selected), CONTEXT_DEBOUNCE_MS);
  });

  const surrounding = computed((): LineWindow | null => {
    if (fromBuffer.value) return fromBuffer.value;
    const disk = fromDisk.value;
    // A SECOND job, not a spare copy of `latest`: the generation decides what may be WRITTEN, this
    // decides what may be DRAWN. They are not the same moment, because the watch that clears the
    // stored answer runs on the `pre` flush — so between the selection moving and the watch
    // running, the stored answer is still here while the selection has already changed. Reading in
    // that window is what this catches, and a test pins it.
    return disk && disk.key === diskKey.value ? disk.window : null;
  });

  /** Teardown is a generation change like any other — see `latest`. */
  const stop = (): void => {
    if (timer) clearTimeout(timer);
    inFlight?.abort();
    latest += 1;
  };

  // The second of teardown's two paths: a caller that never calls `stop` still disposes the scope
  // this lives in, and then the watch dies while a request already past its await does not.
  // `stop` is idempotent, so the panel's own unmount call and this one can both run.
  onScopeDispose(stop);

  return { surrounding, stop };
}
