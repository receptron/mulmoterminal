// A file's history in the Files pane (#2574): the backups the store kept of it, compared with the
// buffer through the same change marks HEAD uses, and restored as an edit the reader then saves.
import { computed, ref, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { CmEditor } from "../components/cmEditor";
import { bankText, browseQuery, browseUrl } from "../components/filesPaneApi";
import { backupEntriesFrom, type BackupEntry } from "../../common/fileBackups";
import { isRecord } from "../../common/isRecord";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import type { FileHeadText } from "./useFileHeadText";

export interface FileHistoryDeps {
  cwd: () => string | null;
  /** The remote host the root is on; absent or null for this machine. */
  host?: () => string | null;
  openPath: Ref<string | null>;
  editor: ShallowRef<CmEditor | null>;
  head: FileHeadText;
  /** The pane's "show the removed lines" switch: comparing turns it on, and stopping puts it back. */
  showChanges: Ref<boolean>;
  dirty: Ref<boolean>;
  saving: Ref<boolean>;
}

/** The version the marks are drawn against, with its text: kept, because the store rotates old
 *  versions out while an agent keeps rewriting the file, and Restore must still have it. */
export interface ComparedVersion {
  entry: BackupEntry;
  text: string;
}

export interface FileHistory {
  open: Ref<boolean>;
  /** A restore that did not land — its own flag, so the banner never blames a restore for a list
   *  or a read that failed. */
  restoreFailed: Ref<boolean>;
  comparing: Ref<ComparedVersion | null>;
  entries: Ref<BackupEntry[]>;
  failed: Ref<boolean>;
  toggle: () => Promise<void>;
  close: () => void;
  compare: (entry: BackupEntry) => Promise<void>;
  restore: (entry: BackupEntry) => Promise<void>;
  /** The History menu's props, to bind in one go. */
  menu: ComputedRef<{ open: boolean; entries: BackupEntry[]; failed: boolean; restoreFailed: boolean }>;
}

/** The `/api/files/browse/backup` answer's text, or null. */
export const backupTextFrom = (body: unknown): string | null => (isRecord(body) && typeof body.text === "string" ? body.text : null);

/** The file's backups, newest first, or null when they could not be read. */
async function fetchBackups(host: string | null, query: string): Promise<BackupEntry[] | null> {
  try {
    const res = await fetchWithTimeout(browseUrl(host, "backups", query));
    return res.ok ? backupEntriesFrom(await jsonBody(res)) : null;
  } catch {
    return null;
  }
}

/** One backup's text, or null when it could not be read. */
async function fetchBackupText(host: string | null, query: string, id: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${browseUrl(host, "backup", query)}&id=${encodeURIComponent(id)}`);
    return res.ok ? backupTextFrom(await jsonBody(res)) : null;
  } catch {
    return null;
  }
}

// The editor turns CRLF and CR into LF as it loads, and a backup taken from disk keeps them.
const sameText = (a: string, b: string): boolean => a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");

/** Put `text` in `pathRel`'s buffer as an edit. A buffer with unsaved edits is banked first —
 *  restoring must never be the step that loses them — and nothing happens if that fails. Everything
 *  is asked again after the bank's round trip: a save may have started, or another file be open in
 *  the same editor, and either would take the restored text somewhere it was not meant to go. */
async function replaceBuffer(deps: FileHistoryDeps, pathRel: string, query: string, text: string): Promise<boolean> {
  const editor = deps.editor.value;
  const stillHere = (): boolean => deps.editor.value === editor && deps.openPath.value === pathRel && !deps.saving.value;
  // A save in flight read the buffer before it went out and will mark it saved when it lands.
  if (!editor || !stillHere()) return false;
  const current = editor.getDoc();
  if (sameText(current, text)) return true;
  if (deps.dirty.value && !(await bankText(deps.host?.() ?? null, query, current))) return false;
  // Keys typed during the bank are not in the bank: stop rather than replace them.
  if (!stillHere() || editor.getDoc() !== current) return false;
  editor.replaceDoc(text);
  return true;
}

type HistoryState = Pick<FileHistory, "open" | "restoreFailed" | "comparing" | "entries" | "failed">;

/** What comparing turned on, put back when it ends; and a new file starts with no list or failure. */
function resetWhenDone(deps: FileHistoryDeps, state: HistoryState): { rememberChanges: () => void } {
  // What the Changes switch was before comparing turned it on.
  let changesBefore: boolean | null = null;
  watch(deps.head.comparingAt, (at) => {
    if (at !== null) return;
    state.comparing.value = null;
    if (changesBefore !== null) deps.showChanges.value = changesBefore;
    changesBefore = null;
  });
  watch(deps.openPath, () => {
    state.open.value = false;
    state.entries.value = [];
    state.failed.value = false;
    state.restoreFailed.value = false;
  });
  return { rememberChanges: () => (changesBefore ??= deps.showChanges.value) };
}

export function useFileHistory(deps: FileHistoryDeps): FileHistory {
  const open = ref(false);
  const entries = ref<BackupEntry[]>([]);
  const failed = ref(false);
  const restoreFailed = ref(false);
  const comparing = ref<ComparedVersion | null>(null);
  const { rememberChanges } = resetWhenDone(deps, { open, restoreFailed, comparing, entries, failed });

  const query = (pathRel: string): string => browseQuery(deps.cwd(), pathRel);

  async function toggle(): Promise<void> {
    open.value = !open.value;
    failed.value = false;
    const pathRel = deps.openPath.value;
    if (!open.value || !pathRel) return;
    const listed = await fetchBackups(deps.host?.() ?? null, query(pathRel));
    if (deps.openPath.value !== pathRel) return;
    entries.value = listed ?? [];
    failed.value = listed === null;
  }

  /** A version's text: the compared one from memory, any other from the store — dropped when the
   *  reader has moved to another file meanwhile. */
  async function read(entry: BackupEntry): Promise<string | null> {
    if (comparing.value?.entry.id === entry.id) return comparing.value.text;
    const pathRel = deps.openPath.value;
    if (!pathRel) return null;
    const text = await fetchBackupText(deps.host?.() ?? null, query(pathRel), entry.id);
    if (deps.openPath.value !== pathRel) return null;
    failed.value = text === null;
    return text;
  }

  async function compare(entry: BackupEntry): Promise<void> {
    restoreFailed.value = false;
    const text = await read(entry);
    if (text === null) return;
    deps.head.compareWith(text, entry.at);
    comparing.value = { entry, text };
    rememberChanges();
    deps.showChanges.value = true;
    open.value = false;
    deps.editor.value?.focus();
  }

  // An edit, not a load: it can be undone, it marks the buffer unsaved, and it is saved like typing.
  async function restore(entry: BackupEntry): Promise<void> {
    const pathRel = deps.openPath.value;
    const text = await read(entry);
    // Only this file's failure is this file's to show: the reader may have moved on meanwhile.
    if (!pathRel || deps.openPath.value !== pathRel) return;
    if (text === null) {
      restoreFailed.value = true;
      return;
    }
    const landed = await replaceBuffer(deps, pathRel, query(pathRel), text);
    if (deps.openPath.value === pathRel) restoreFailed.value = !landed;
    if (!landed) return;
    await deps.head.stopComparing();
    open.value = false;
    deps.editor.value?.focus();
  }

  const menu = computed(() => ({ open: open.value, entries: entries.value, failed: failed.value, restoreFailed: restoreFailed.value }));
  return { open, restoreFailed, comparing, entries, failed, toggle, close: () => (open.value = false), compare, restore, menu };
}
