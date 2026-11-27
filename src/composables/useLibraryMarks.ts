// The user's pins and names in the Library (#3329): read when the screen opens, changed one at a time,
// and the pinned conversations themselves — which need not be among the newest the list has read.
import { ref, shallowRef, watch, type Ref } from "vue";
import { emptyLibraryMarks, type LibraryConversation, type LibraryMarkChange, type LibraryMarks } from "../../common/library";
import { loadLibraryConversation, loadLibraryMarks, saveLibraryMark } from "./libraryApi";

/** The pinned list with one conversation pinned to the front, or taken out. Pure. */
export function pinnedAfter(pinned: readonly LibraryConversation[], conversation: LibraryConversation, pin: boolean): LibraryConversation[] {
  const others = pinned.filter((known) => known.id !== conversation.id);
  return pin ? [conversation, ...others] : others;
}

export function useLibraryMarks(isOpen: Ref<boolean>) {
  const marks = shallowRef<LibraryMarks>(emptyLibraryMarks());
  const pinned = shallowRef<LibraryConversation[]>([]);
  /** The conversation whose last change could not be saved, or null. Per conversation: a failure that
   *  answers after the reader moved on belongs to the one it was about, not the one now shown. */
  const saveFailedFor = ref<string | null>(null);
  /** The marks could not be read (the file is there but unreadable): nothing pinned is shown, and the
   *  screen says why rather than looking like nothing was ever pinned. */
  const loadFailed = ref(false);
  /** `reads` and `saves` number requests so a stale answer can tell it is stale; `applied` counts save
   *  answers shown, since a read begun before one of them is older than the screen. */
  const seq = { reads: 0, saves: 0, applied: 0, marksRead: false };

  async function readPinned(ids: readonly string[]): Promise<void> {
    const mine = ++seq.reads;
    const found = await Promise.all(ids.map((id) => loadLibraryConversation(id)));
    if (mine !== seq.reads) return;
    pinned.value = found.filter((conversation): conversation is LibraryConversation => conversation !== null);
  }

  async function load(): Promise<void> {
    const mine = ++seq.reads;
    const savesBefore = seq.saves;
    const appliedBefore = seq.applied;
    const read = await loadLibraryMarks();
    // A save sent or applied since this read began holds newer marks than the read does.
    if (mine !== seq.reads || seq.saves !== savesBefore || seq.applied !== appliedBefore) return;
    // A failed re-read keeps the pins and names shown; with none read yet there are none, and it says so.
    loadFailed.value = read === null && !seq.marksRead;
    if (read === null) return;
    seq.marksRead = true;
    marks.value = read;
    await readPinned(read.pinned);
  }

  /** Saves one change; on failure nothing on screen changes and `saveFailed` says so. Only the newest
   *  request's answer is applied: the server applies changes in order, so its last answer already
   *  holds the earlier ones, while an earlier answer arriving late would undo the later change. */
  async function change(id: string, update: LibraryMarkChange, conversation?: LibraryConversation): Promise<boolean> {
    if (saveFailedFor.value === id) saveFailedFor.value = null; // another conversation's failure stands
    const mine = ++seq.saves;
    const saved = await saveLibraryMark(id, update);
    if (mine !== seq.saves) {
      // Too old to apply, but it did change the file — after a reopen, a read begun before it landed
      // may now be older still. Reading again makes the newest state win whatever the order.
      if (saved !== null && isOpen.value) void load();
      // A failure is still its conversation's, even when a newer save answered first.
      if (saved === null) saveFailedFor.value = id;
      return saved !== null;
    }
    if (saved === null) {
      saveFailedFor.value = id;
      return false;
    }
    const pinsChanged = saved.pinned.join("\n") !== marks.value.pinned.join("\n");
    // The pinned group follows the answer at once for the conversation in hand — reading the others
    // back takes a round trip, and until then the list (and the selection on it) must not jump.
    if (conversation !== undefined && update.pinned !== undefined) pinned.value = pinnedAfter(pinned.value, conversation, update.pinned);
    marks.value = saved;
    seq.applied++;
    loadFailed.value = false; // the answer is the file as it now is, so it can be read again
    // By what the answer says, not by what this change asked: a pin whose own answer was superseded
    // reaches the screen through the next answer, which holds it.
    if (pinsChanged) await readPinned(saved.pinned);
    return true;
  }

  watch(
    isOpen,
    (open) => {
      seq.reads++;
      seq.saves++; // an answer for the screen as it was must not land on the next opening
      saveFailedFor.value = null;
      if (open) void load();
    },
    { immediate: true },
  );

  return { marks, pinned, saveFailedFor, loadFailed, change };
}
