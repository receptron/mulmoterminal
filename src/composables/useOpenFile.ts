// The Files pane's OPEN FILE: the buffer, the editor it is shown in, how it is read, where the
// reader was in it, and how it is written back. Lifted out of FilesPane.vue, which had reached the
// repo's file-length limit with features queued behind it (#2158). The pane keeps all of the
// markup — this is the half that fetches, decides and remembers.
//
// The functions below are module-level and take a context rather than closing over one. Not a
// style choice: everything here inside a single `useOpenFile` would be one function several times
// past `max-lines-per-function`, and the shape that follows from the limit is also the shape a
// test can drive — each function takes a state it can be handed.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { createEditor, langKindForFilename, type CmEditor } from "../components/cmEditor";
import { askTheMachine, bankText, browseQuery, writeBuffer } from "../components/filesPaneApi";
import type { FilesPaneState } from "../components/filesPaneState";
import { restoresPreview, staysOnSameFile } from "../components/filesPreviewMode";
import { diskVersion, previewQuery } from "../components/filesPreviewSrc";
import { absoluteUnder } from "./canvasOpenFile";
import { watchExternalFileChanges } from "./externalFileChanges";
import { MARKDOWN_FILE_SCOPE, fileChannelPath, pluginFileChannel } from "../../common/fileChannel";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

/** What a save that came back 409 learned: the version now on disk, which "Overwrite" re-sends. */
export interface FileConflict {
  version: string | null;
}

/** Where a reader is in a file: the cursor, and what is on screen. ONE value because they are one
 *  fact — carrying the caret alone left a reader who never clicks at the top of the file (Codex
 *  found that twice, once per field, which is what a field-by-field rule earns). It is the shape a
 *  snapshot already stores, so neither end converts: a remembered state IS a place. */
export type FilePlace = Pick<FilesPaneState, "caret" | "topLine">;

/** The open file itself — what the functions below decide from and what the pane renders. Declared
 *  once: the context they take and the surface they are returned behind are the same buffer seen
 *  from two sides, and writing the fields twice is how the two drift. */
export interface OpenFileBuffer {
  openPath: Ref<string | null>;
  openName: ComputedRef<string>;
  isMarkdown: ComputedRef<boolean>;
  dirty: Ref<boolean>;
  /** Bumped on every edit. The search panel needs a dependency that MOVES — see its own comment. */
  editSeq: Ref<number>;
  saving: Ref<boolean>;
  fileError: Ref<string | null>;
  /** Set when the server refuses to serve a file as text (415). Its own state rather than an
   *  error: nothing went wrong — this file simply is not text, and the pane has something to say
   *  about it rather than a failure to report (#2038). */
  unpreviewable: Ref<string | null>;
  /** The version the open buffer was loaded from; sent back on save so the server can refuse a
   *  write that would clobber someone else's (null = the file didn't exist). */
  baseVersion: Ref<string | null>;
  conflict: Ref<FileConflict | null>;
  showPreview: Ref<boolean>;
  editor: ShallowRef<CmEditor | null>;
}

interface OpenFileCtx extends OpenFileBuffer {
  cwd: () => string | null;
  /** Which read is the current one. A box rather than a plain counter because the functions that
   *  bump it are module-level and have nothing to close over. */
  reqId: { n: number };
}

const qs = (ctx: OpenFileCtx, pathRel: string): string => browseQuery(ctx.cwd(), pathRel);

// Every /api route answers a failure as `res.status(4xx).json({ error })`, so the reason a read
// was refused is in the body — reporting only the status turns a fixable problem into a mystery.
const failureReason = (body: Record<string, unknown>, status: number): string =>
  typeof body.error === "string" && body.error !== "" ? body.error : `HTTP ${status}`;

// Save on the way out instead of asking. The editor sits beside a terminal the user is
// working in, so anything that moves the enlargement — a key, a click on the filmstrip —
// would otherwise raise a dialog mid-flow. Nothing is lost either way: the server banks
// three generations of every file it replaces.
//
// A save that loses the version race can't put a banner up (we are already leaving), so the
// buffer is banked instead and the file left as the other writer left it. Everything needed
// is read BEFORE the first await, so an unmount mid-flight can't take the content with it.
// Returns whether the buffer is safe to leave behind — false when NEITHER the save nor the
// backup landed (the server is down, the disk is full). Callers that can stay must stay: with
// no copy anywhere, walking away is the one outcome that loses what was typed.
async function flush(ctx: OpenFileCtx): Promise<boolean> {
  const editor = ctx.editor.value;
  if (!ctx.dirty.value || !ctx.openPath.value || !editor) return true;
  const pathRel = ctx.openPath.value;
  const text = editor.getDoc();
  const outcome = await writeBuffer(qs(ctx, pathRel), text, ctx.baseVersion.value);
  if (outcome.status !== "saved" && !(await bankText(qs(ctx, pathRel), text))) {
    ctx.fileError.value = outcome.status === "error" ? outcome.message : "could not save or back up this file";
    return false;
  }
  ctx.dirty.value = false;
  ctx.conflict.value = null;
  return true;
}

/** Whether the pane may leave the buffer it is on. `force` skips both questions: the conflict
 *  banner's "Reload" is a deliberate discard, and re-reading the open file is not leaving it. */
async function mayLeaveCurrent(ctx: OpenFileCtx, pathRel: string, force: boolean): Promise<boolean> {
  if (force) return true;
  if (pathRel === ctx.openPath.value) return false; // already open — no reload
  // Opening another file is leaving this one. If it couldn't be saved OR banked, staying is
  // the only way not to lose it.
  return await flush(ctx);
}

/** `remembered` is a restore asking for the view mode that path was left in. It is applied HERE
 *  rather than by the caller after the await, so the decision sits inside this request's own
 *  generation guard: a load that lost its race must not hand its mode to the file that won. */
async function loadFile(ctx: OpenFileCtx, pathRel: string, force: boolean, remembered: FilesPaneState | null): Promise<void> {
  if (!(await mayLeaveCurrent(ctx, pathRel, force))) return;
  const id = ++ctx.reqId.n;
  ctx.fileError.value = null;
  ctx.conflict.value = null;
  ctx.unpreviewable.value = null;
  // What survives a re-read of the SAME file, and what a different file leaves behind: the mode
  // belongs to the file it was turned on for, and so does the reader's place in it. Carried across
  // the read rather than restored from a snapshot, because this path has no snapshot — the agent
  // editing the file you are reading is what triggers it (see staysOnSameFile).
  const staying = staysOnSameFile(ctx.openPath.value, pathRel);
  const carried = staying ? placeNow(ctx) : null;
  if (!staying) ctx.showPreview.value = false;
  try {
    const res = await fetchWithTimeout(`/api/files/browse/text?${qs(ctx, pathRel)}`);
    const data = await jsonBody(res);
    // 415 is the one non-ok status that is not a failure: the file is simply not text, and showing
    // it as one is what destroyed spreadsheets before this existed (#2038).
    if (!res.ok && res.status !== 415) throw new Error(failureReason(data, res.status));
    if (id !== ctx.reqId.n) return;
    if (res.status === 415) adoptUnpreviewable(ctx, pathRel, data);
    else adoptText(ctx, pathRel, data);
    restorePlace(ctx, pathRel, remembered, carried);
  } catch (e) {
    if (id === ctx.reqId.n) ctx.fileError.value = e instanceof Error ? e.message : String(e);
  }
}

function placeNow(ctx: OpenFileCtx): FilePlace {
  const [caret, topLine] = [ctx.editor.value?.caretAt(), ctx.editor.value?.topLine()];
  // Absent rather than undefined: `exactOptionalPropertyTypes` treats the two as different, and
  // absent is what "the editor had nothing to say" means here.
  return { ...(caret ? { caret } : {}), ...(topLine ? { topLine } : {}) };
}

/** The screen goes back LAST: `goTo` scrolls the caret into view, and what was visible is the
 *  authoritative answer to "where was I". */
function goToPlace(ctx: OpenFileCtx, place: FilePlace): void {
  if (place.caret) ctx.editor.value?.goTo(place.caret);
  if (place.topLine) ctx.editor.value?.scrollLineToTop(place.topLine);
}

/** Put the reader back, from whichever of the two sources this read has. They are exclusive: a
 *  restore knows where they were LAST TIME, a same-file re-read where they are NOW. */
function restorePlace(ctx: OpenFileCtx, pathRel: string, remembered: FilesPaneState | null, carried: FilePlace | null): void {
  if (remembered) return applyRemembered(ctx, remembered);
  if (carried && ctx.openPath.value === pathRel && !ctx.unpreviewable.value) goToPlace(ctx, carried);
}

/** Put back what was remembered about the file that just landed. Both halves ask about what
 *  ACTUALLY arrived rather than what was asked for: the path may hold something else now, or
 *  nothing this pane can show. */
function applyRemembered(ctx: OpenFileCtx, remembered: FilesPaneState): void {
  ctx.showPreview.value = restoresPreview(remembered, {
    openPath: ctx.openPath.value,
    isMarkdown: ctx.isMarkdown.value,
    unpreviewable: ctx.unpreviewable.value !== null,
  });
  if (remembered.openPath !== ctx.openPath.value || ctx.unpreviewable.value) return;
  goToPlace(ctx, remembered);
}

/** Put a file the server served as text into the editor. Paired with `adoptUnpreviewable` so the
 *  two outcomes of one request read side by side rather than as branches inside the fetch. */
function adoptText(ctx: OpenFileCtx, pathRel: string, data: Record<string, unknown>): void {
  ctx.openPath.value = pathRel;
  ctx.baseVersion.value = typeof data.version === "string" ? data.version : null;
  ctx.editor.value?.setDoc(typeof data.text === "string" ? data.text : "", pathRel.split("/").pop() ?? pathRel);
  ctx.dirty.value = false;
}

/** Show the "not text" panel for a file the server refused to serve as text. The path is still
 *  adopted so the header names the file the user picked; the buffer is emptied and marked clean so
 *  nothing can be saved over it — an empty editor above real content is what destroyed it (#2038). */
function adoptUnpreviewable(ctx: OpenFileCtx, pathRel: string, data: Record<string, unknown>): void {
  ctx.openPath.value = pathRel;
  ctx.baseVersion.value = null;
  ctx.dirty.value = false;
  ctx.editor.value?.setDoc("", pathRel.split("/").pop() ?? pathRel);
  ctx.unpreviewable.value = typeof data.error === "string" ? data.error : "this file cannot be shown as text";
  // A file the server will not serve as text has no preview to be in. Reachable now that the mode
  // survives a re-read of the same path: the open `.md` can come back 415 on an external change.
  ctx.showPreview.value = false;
}

async function save(ctx: OpenFileCtx): Promise<void> {
  // Ctrl/Cmd+S reaches here even though the Save button is disabled, and the buffer shown for an
  // unpreviewable file is EMPTY — saving it truncates the file (CodeRabbit on #2038). The server
  // refuses this too; this is so the user sees why rather than an error from a keystroke.
  if (ctx.unpreviewable.value) return;
  if (!ctx.openPath.value || !ctx.editor.value || ctx.saving.value) return;
  ctx.saving.value = true;
  ctx.fileError.value = null;
  const outcome = await writeBuffer(qs(ctx, ctx.openPath.value), ctx.editor.value.getDoc(), ctx.baseVersion.value);
  ctx.saving.value = false;
  // 409: the file moved on under us (the agent working in this very directory is the likeliest
  // author). Nothing was written — offer the choice instead of picking a loser.
  if (outcome.status === "conflict") {
    ctx.conflict.value = { version: outcome.version };
    return;
  }
  if (outcome.status === "error") {
    ctx.fileError.value = outcome.message;
    return;
  }
  ctx.baseVersion.value = outcome.version;
  ctx.dirty.value = false;
  ctx.conflict.value = null;
}

/** Conflict banner — take the disk's copy. The buffer is banked first, so "discard" costs
 *  nothing that can't be fetched back out of the backup store. */
async function discardAndReload(ctx: OpenFileCtx): Promise<void> {
  if (!ctx.openPath.value || !ctx.editor.value) return;
  // "Kept as a backup either way" is the promise the banner makes. If the store refuses it,
  // the honest answer is to keep the buffer rather than discard it anyway.
  if (!(await bankText(qs(ctx, ctx.openPath.value), ctx.editor.value.getDoc()))) {
    ctx.fileError.value = "could not back up your version — nothing was discarded";
    return;
  }
  void loadFile(ctx, ctx.openPath.value, true, null);
}

/** Conflict banner — keep the buffer, adopting the disk's version as the new baseline so the
 *  retry is a deliberate overwrite rather than another conflict. */
function overwrite(ctx: OpenFileCtx): void {
  if (!ctx.conflict.value) return;
  ctx.baseVersion.value = ctx.conflict.value.version;
  ctx.conflict.value = null;
  void save(ctx);
}

/** Report what `askTheMachine` could not do, in the pane's own alert line (`role="alert"`) — the
 *  message names what failed, so it does not read as the open file's problem. */
async function reportFailure(ctx: OpenFileCtx, attempt: Promise<string | null>): Promise<void> {
  const message = await attempt;
  if (message !== null) ctx.fileError.value = message;
}

/** Hand the open file to the OS's default application (#2038) — the way out of a file the pane
 *  cannot show. */
async function openInOs(ctx: OpenFileCtx): Promise<void> {
  const pathRel = ctx.openPath.value;
  const cwd = ctx.cwd();
  if (!pathRel || !cwd) return;
  await reportFailure(ctx, askTheMachine("/api/files/open", absoluteUnder(cwd, pathRel), `could not open ${pathRel}`));
}

// The file may move under the editor at any moment — the agent working in this directory is
// editing the same files. Two ways of finding out, because neither alone is enough: the write
// hook is immediate but only speaks for Claude (Codex reports through a different channel, and
// git, a build or another editor report through none), while the poll misses nothing and is
// merely late. The 409 on save is still the hard guarantee; these two only get the news out
// before the user has typed into a file that already moved.
/** Re-read the version and react: a clean buffer just takes the new content (the pane reads as
 *  a live view), a dirty one raises the banner rather than choosing for the user. */
async function checkForExternalChange(ctx: OpenFileCtx): Promise<void> {
  if (!ctx.openPath.value || ctx.saving.value || ctx.conflict.value) return;
  const pathRel = ctx.openPath.value;
  try {
    const res = await fetchWithTimeout(`/api/files/browse/version?${qs(ctx, pathRel)}`);
    if (!res.ok) return;
    const data = await jsonBody(res);
    const onDisk = typeof data.version === "string" ? data.version : null;
    // Still the version we loaded, or the answer arrived after the user moved on.
    if (onDisk === ctx.baseVersion.value || pathRel !== ctx.openPath.value) return;
    if (ctx.dirty.value) ctx.conflict.value = { version: onDisk };
    else void loadFile(ctx, pathRel, true, null);
  } catch {
    // Offline or the server restarted: the next tick asks again, and the save still can't clobber.
  }
}

/** The channel the open document's own changes are announced on, or null when the pane is on
 *  something the server does not watch. Absolute and POSIX-spelled, because that is what the
 *  server resolves and what it will spell the channel back as (common/fileChannel.ts). */
function docChannel(ctx: OpenFileCtx): string | null {
  const pathRel = ctx.openPath.value;
  if (!pathRel || !ctx.isMarkdown.value) return null;
  return pluginFileChannel(MARKDOWN_FILE_SCOPE, fileChannelPath(absoluteUnder(ctx.cwd(), pathRel)));
}

// Closing the tab or reloading is also leaving the file. `keepalive` lets the request outlive
// the page — capped at 64 KB by the browser, so a very large buffer may not make it out, which
// is the one hole autosave can't close.
function onPageHide(ctx: OpenFileCtx): void {
  const editor = ctx.editor.value;
  if (!ctx.dirty.value || !ctx.openPath.value || !editor) return;
  const pathRel = ctx.openPath.value;
  const text = editor.getDoc();
  // Both, unconditionally: there is no awaiting an answer here, so the only way to honour
  // "your version is kept either way" is to bank it whether or not the write wins the race.
  // The cost is one redundant generation per tab-close with unsaved edits.
  void bankText(qs(ctx, pathRel), text, true);
  void writeBuffer(qs(ctx, pathRel), text, ctx.baseVersion.value, true);
}

/** Everything the pane's re-root has to undo here. The generation is bumped FIRST, for the reason
 *  the pane's own teardown gives: a read already in flight would otherwise land after the re-root
 *  and adopt the OLD project's content, because its `id === reqId` check still passes. */
function teardown(ctx: OpenFileCtx): void {
  ctx.reqId.n += 1;
  ctx.editor.value?.destroy();
  ctx.editor.value = null;
  ctx.openPath.value = null;
  ctx.dirty.value = false;
  ctx.baseVersion.value = null;
  ctx.conflict.value = null;
  ctx.showPreview.value = false;
}

export interface OpenFile extends OpenFileBuffer {
  /** The `src` of the Markdown preview iframe. The version is what makes this URL change when the
   *  file does — without it the browser keeps serving the rendering it already has, and a full
   *  page reload was the only way to see an edit another cell's agent had made (#2136). */
  previewSrc: ComputedRef<string>;
  /** Which read is current, for a caller whose own decision depends on not having been overtaken. */
  generation: () => number;
  attach: (host: HTMLElement) => void;
  teardown: () => void;
  load: (pathRel: string, force?: boolean, remembered?: FilesPaneState | null) => Promise<void>;
  flush: () => Promise<boolean>;
  save: () => Promise<void>;
  discardAndReload: () => Promise<void>;
  overwrite: () => void;
  openInOs: () => Promise<void>;
  /** Say why something the pane asked the machine for did not happen — a reveal, a Canvas open. */
  reportFailure: (attempt: Promise<string | null>) => Promise<void>;
  /** Where the reader is right now, for a snapshot. */
  place: () => FilePlace;
}

export function useOpenFile(cwd: () => string | null): OpenFile {
  const openPath = ref<string | null>(null);
  const openName = computed(() => (openPath.value ? (openPath.value.split("/").pop() ?? "") : ""));
  const buffer: OpenFileBuffer = {
    openPath,
    openName,
    isMarkdown: computed(() => langKindForFilename(openName.value) === "markdown"),
    dirty: ref(false),
    editSeq: ref(0),
    saving: ref(false),
    fileError: ref<string | null>(null),
    unpreviewable: ref<string | null>(null),
    baseVersion: ref<string | null>(null),
    conflict: ref<FileConflict | null>(null),
    showPreview: ref(false),
    editor: shallowRef<CmEditor | null>(null),
  };
  const ctx: OpenFileCtx = { ...buffer, cwd, reqId: { n: 0 } };

  const pageHide = (): void => onPageHide(ctx);
  let stopWatchingExternal: (() => void) | null = null;
  onMounted(() => {
    window.addEventListener("pagehide", pageHide);
    stopWatchingExternal = watchExternalFileChanges({
      cwd,
      openPath: () => ctx.openPath.value,
      docChannel: () => docChannel(ctx),
      recheck: () => void checkForExternalChange(ctx),
    });
  });
  onBeforeUnmount(() => {
    window.removeEventListener("pagehide", pageHide);
    stopWatchingExternal?.();
  });

  return {
    ...buffer,
    previewSrc: computed(() =>
      openPath.value ? `/api/files/browse/md?${previewQuery(cwd(), openPath.value, diskVersion(buffer.baseVersion.value, buffer.conflict.value))}` : "",
    ),
    generation: () => ctx.reqId.n,
    attach: (host) =>
      (buffer.editor.value = createEditor(host, () => {
        buffer.dirty.value = true;
        // `dirty` only ever goes false->true, so it cannot tell the search panel that the text has
        // changed AGAIN. CodeMirror's document is not reactive either, so this counter is the only
        // thing that moves on a second keystroke (see useFileSearchPanel's `buffer`).
        buffer.editSeq.value += 1;
      })),
    teardown: () => teardown(ctx),
    load: (pathRel, force = false, remembered = null) => loadFile(ctx, pathRel, force, remembered),
    flush: () => flush(ctx),
    save: () => save(ctx),
    discardAndReload: () => discardAndReload(ctx),
    overwrite: () => overwrite(ctx),
    openInOs: () => openInOs(ctx),
    reportFailure: (attempt) => reportFailure(ctx, attempt),
    place: () => placeNow(ctx),
  };
}
