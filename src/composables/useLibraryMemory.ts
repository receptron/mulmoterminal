// The Library's memory list (#3331), read each time the Library opens: memory changes while the
// agent works, and a list kept from the last open would show files that have moved on.
import { ref, watch, type Ref } from "vue";
import type { LibraryMemoryProject } from "../../common/libraryMemory";
import { loadLibraryMemory } from "./libraryApi";

export function useLibraryMemory(isOpen: Ref<boolean>) {
  const projects = ref<LibraryMemoryProject[]>([]);
  const loaded = ref(false);
  const failed = ref(false);
  let reads = 0;
  watch(
    isOpen,
    async (open) => {
      if (!open) return;
      const mine = ++reads;
      const found = await loadLibraryMemory();
      if (mine !== reads) return;
      failed.value = found === null;
      projects.value = found ?? [];
      loaded.value = true;
    },
    { immediate: true },
  );
  return { projects, loaded, failed };
}
