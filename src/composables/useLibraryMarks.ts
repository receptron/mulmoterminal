// The user's pins and names in the Library (#3329): read when the screen opens, changed one at a time,
// and the pinned conversations themselves — which need not be among the newest the list has read.
import { ref, shallowRef, watch, type Ref } from "vue";
import { emptyLibraryMarks, type LibraryConversation, type LibraryMarkChange, type LibraryMarks } from "../../common/library";
import { loadLibraryConversation, loadLibraryMarks, saveLibraryMark } from "./libraryApi";

/** Pins shown at the top of the list; past this they stay pinned but are not read up front. */
export const PINNED_SHOWN = 20;

export function useLibraryMarks(isOpen: Ref<boolean>) {
  const marks = shallowRef<LibraryMarks>(emptyLibraryMarks());
  const pinned = shallowRef<LibraryConversation[]>([]);
  /** The conversation whose last change could not be saved, or null. Per conversation: a failure that
   *  answers after the reader moved on belongs to the one it was about, not the one now shown. */
  const saveFailedFor = ref<string | null>(null);
  /** The marks could not be read (the file is there but unreadable): nothing pinned is shown, and the
   *  screen says why rather than looking like nothing was ever pinned. */
  const loadFailed = ref(false);
  let request = 0;
  let saveRequest = 0;

  async function readPinned(ids: readonly string[]): Promise<void> {
    const mine = ++request;
    const found = await Promise.all(ids.slice(0, PINNED_SHOWN).map((id) => loadLibraryConversation(id)));
    if (mine !== request) return;
    pinned.value = found.filter((conversation): conversation is LibraryConversation => conversation !== null);
  }

  async function load(): Promise<void> {
    const mine = ++request;
    const savesBefore = saveRequest;
    const read = await loadLibraryMarks();
    // A save answered since this read began holds newer marks than the read does.
    if (mine !== request || saveRequest !== savesBefore) return;
    loadFailed.value = read === null;
    if (read === null) {
      marks.value = emptyLibraryMarks();
      pinned.value = [];
      return;
    }
    marks.value = read;
    await readPinned(read.pinned);
  }

  /** Saves one change; on failure nothing on screen changes and `saveFailed` says so. Only the newest
   *  request's answer is applied: the server applies changes in order, so its last answer already
   *  holds the earlier ones, while an earlier answer arriving late would undo the later change. */
  async function change(id: string, update: LibraryMarkChange): Promise<boolean> {
    saveFailedFor.value = null;
    const mine = ++saveRequest;
    const saved = await saveLibraryMark(id, update);
    if (mine !== saveRequest) {
      // Too old to apply, but it did change the file — after a reopen, a read begun before it landed
      // may now be older still. Reading again makes the newest state win whatever the order.
      if (saved !== null && isOpen.value) void load();
      return saved !== null;
    }
    if (saved === null) {
      saveFailedFor.value = id;
      return false;
    }
    const pinsChanged = saved.pinned.join("\n") !== marks.value.pinned.join("\n");
    marks.value = saved;
    // By what the answer says, not by what this change asked: a pin whose own answer was superseded
    // reaches the screen through the next answer, which holds it.
    if (pinsChanged) await readPinned(saved.pinned);
    return true;
  }

  watch(
    isOpen,
    (open) => {
      request++;
      saveRequest++; // an answer for the screen as it was must not land on the next opening
      saveFailedFor.value = null;
      if (open) void load();
    },
    { immediate: true },
  );

  return { marks, pinned, saveFailedFor, loadFailed, change };
}
