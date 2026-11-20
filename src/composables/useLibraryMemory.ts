// The Library's memory list (#3331), read each time the Library opens: memory changes while the
// agent works, and a list kept from the last open would show files that have moved on.
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
  watch(
    isOpen,
    async (open) => {
      if (!open) return;
      const mine = ++reads;
      // Not the last open's list while this one is read: a memory removed meanwhile would still show.
      loaded.value = false;
      failed.value = false;
      projects.value = [];
      health.value = new Map();
      healthFailed.value = false;
      void (async () => {
        const judged = await loadLibraryMemoryHealth();
        if (mine !== reads) return;
        healthFailed.value = judged === null;
        health.value = new Map((judged ?? []).map((project) => [project.slug, project]));
      })();
      const found = await loadLibraryMemory();
      if (mine !== reads) return;
      failed.value = found === null;
      projects.value = found ?? [];
      loaded.value = true;
    },
    { immediate: true },
  );
  return { projects, loaded, failed, health, healthFailed };
}
