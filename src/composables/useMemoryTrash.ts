// A memory moved to the Trash from the Library, and the short notice that offers to undo it (#3331).
import { onBeforeUnmount, ref } from "vue";
import { trashAvailable } from "../components/treeFileOpsApi";
import { sessionRunningIn } from "../components/library/memorySessions";
import { trashLibraryMemoryFile, undoLibraryMemoryTrash, type MemoryTrashResult } from "./libraryApi";

/** How long the notice, and so its Undo, stays. */
export const MEMORY_TRASH_NOTICE_MS = 10_000;

export type MemoryTrashNotice =
  { kind: "trashed"; title: string; key: string; undo: string; running: boolean; undoFailed?: boolean } | { kind: "changed" | "failed" | "taken" | "gone" };

export interface MemoryTrashTarget {
  slug: string;
  file: string;
  version: string;
  title: string;
  key: string;
  cwd: string | null;
}

/** `changed` runs after a memory went or came back, to read the list again. */
export function useMemoryTrash(changed: () => void) {
  const available = ref(false);
  const notice = ref<MemoryTrashNotice | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  void (async () => {
    available.value = await trashAvailable();
  })();

  function show(next: MemoryTrashNotice | null): void {
    clearTimeout(timer);
    notice.value = next;
    if (next !== null) timer = setTimeout(() => (notice.value = null), MEMORY_TRASH_NOTICE_MS);
  }

  async function trash(target: MemoryTrashTarget): Promise<MemoryTrashResult["kind"]> {
    const [result, running] = await Promise.all([trashLibraryMemoryFile(target.slug, target.file, target.version), sessionRunningIn(target.cwd)]);
    if (result.kind === "trashed") {
      show({ kind: "trashed", title: target.title, key: target.key, undo: result.undo, running });
      changed();
    } else show({ kind: result.kind });
    return result.kind;
  }

  /** The key of the memory put back, or null when it was not. */
  async function undo(): Promise<string | null> {
    const shown = notice.value;
    if (shown?.kind !== "trashed") return null;
    const result = await undoLibraryMemoryTrash(shown.undo);
    // The server keeps the undo when it could not finish one, so the notice keeps its Undo to try again.
    if (result === "failed") show({ ...shown, undoFailed: true });
    if (result === "taken" || result === "gone") show({ kind: result });
    if (result !== "restored") return null;
    show(null);
    changed();
    return shown.key;
  }

  onBeforeUnmount(() => clearTimeout(timer));
  return { available, notice, trash, undo, dismiss: () => show(null) };
}
