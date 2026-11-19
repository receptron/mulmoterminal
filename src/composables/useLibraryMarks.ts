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
  const saveFailed = ref(false);
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
    const read = await loadLibraryMarks();
    if (mine !== request || read === null) return;
    marks.value = read;
    await readPinned(read.pinned);
  }

  /** Saves one change; on failure nothing on screen changes and `saveFailed` says so. Only the newest
   *  request's answer is applied: the server applies changes in order, so its last answer already
   *  holds the earlier ones, while an earlier answer arriving late would undo the later change. */
  async function change(id: string, update: LibraryMarkChange): Promise<boolean> {
    saveFailed.value = false;
    const mine = ++saveRequest;
    const saved = await saveLibraryMark(id, update);
    if (mine !== saveRequest) return saved !== null;
    if (saved === null) {
      saveFailed.value = true;
      return false;
    }
    marks.value = saved;
    if (update.pinned !== undefined) await readPinned(saved.pinned);
    return true;
  }

  watch(
    isOpen,
    (open) => {
      request++;
      saveRequest++; // an answer for the screen as it was must not land on the next opening
      saveFailed.value = false;
      if (open) void load();
    },
    { immediate: true },
  );

  return { marks, pinned, saveFailed, change };
}
