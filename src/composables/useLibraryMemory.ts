// The Library's memory list (#3331), read again each time the Library opens: memory changes while the
// agent works. The last open's list stays on screen until the answer replaces it, and through a failed one.
import { ref, watch, type Ref } from "vue";
import type { LibraryMemoryHealth, LibraryMemoryProject } from "../../common/libraryMemory";
import { loadLibraryMemory, loadLibraryMemoryHealth } from "./libraryApi";

export function useLibraryMemory(isOpen: Ref<boolean>) {
  const projects = ref<LibraryMemoryProject[]>([]);
  const loaded = ref(false);
  const failed = ref(false);
  /** What can be tidied, by project. Read beside the list and not waited for: the list shows first. */
  const health = ref(new Map<string, LibraryMemoryHealth>());
  /** The health check could not be read: not the same as nothing to tidy. */
  const healthFailed = ref(false);
  let reads = 0;
  /** A list was read at least once: a failed re-read keeps it rather than replacing it with an error. */
  let listed = false;

  /** The list and its health, read again; the last answer to a newer read wins. */
  async function read(mine: number): Promise<void> {
    void (async () => {
      const judged = await loadLibraryMemoryHealth();
      if (mine !== reads) return;
      healthFailed.value = judged === null;
      health.value = new Map((judged ?? []).map((project) => [project.slug, project]));
    })();
    const found = await loadLibraryMemory();
    if (mine !== reads) return;
    loaded.value = true;
    failed.value = found === null && !listed;
    if (found === null) return;
    listed = true;
    projects.value = found;
  }

  watch(
    isOpen,
    async (open) => {
      if (!open) return;
      await read(++reads);
    },
    { immediate: true },
  );

  /** After a change made here (an edit): read again, keeping what is shown until the answer comes. */
  const refresh = (): Promise<void> => read(++reads);

  return { projects, loaded, failed, health, healthFailed, refresh };
}
