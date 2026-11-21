// The Library's Storage view (#3333): the server's last measurement of Claude Code's home, read when
// the view is shown. A measurement older than STORAGE_STALE_MS (or none yet) is asked for again, and
// read every STORAGE_POLL_MS until it finishes, the older answer staying on screen meanwhile.
import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { LibraryStorageAnswer } from "../../common/libraryStorage";
import { loadLibraryStorage, measureLibraryStorage } from "./libraryApi";

export const STORAGE_STALE_MS = 60 * 60 * 1000;
export const STORAGE_POLL_MS = 1000;
const QUERY_DEBOUNCE_MS = 250;

export function useLibraryStorage(shown: Ref<boolean>, query: Ref<string>) {
  const answer = ref<LibraryStorageAnswer | null>(null);
  const loaded = ref(false);
  const failed = ref(false);
  /** The last ask for a measurement was refused; what is shown is the older answer. */
  const startRefused = ref(false);
  // Which showing of the view owns the work in flight. Hiding it, showing it again and its owner going
  // away each start a new one, and anything that resumes after an await acts only for the showing it
  // began in — one rule, rather than a check per way the view can stop wanting the answer.
  let showing = 0;
  const owns = (mine: number): boolean => mine === showing && shown.value;
  let reads = 0;
  let poll: ReturnType<typeof setTimeout> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const stopPolling = (): void => {
    if (poll !== null) clearTimeout(poll);
    poll = null;
  };

  async function read(): Promise<void> {
    const mine = showing;
    const thisRead = ++reads;
    const found = await loadLibraryStorage(query.value);
    if (!owns(mine) || thisRead !== reads) return;
    failed.value = found === null;
    if (found !== null) answer.value = found;
    loaded.value = true;
    stopPolling();
    // A failed read while one runs is tried again: the view would otherwise show progress forever.
    if (answer.value?.measuring) poll = setTimeout(() => void read(), STORAGE_POLL_MS);
  }

  const isStale = (found: LibraryStorageAnswer): boolean => found.measure === null || Date.now() - found.measure.measuredAt > STORAGE_STALE_MS;

  /** Measure again now, whatever the age of the last one. */
  async function remeasure(): Promise<void> {
    const mine = showing;
    const started = await measureLibraryStorage();
    if (!owns(mine)) return;
    startRefused.value = !started;
    await read();
  }

  watch(
    shown,
    async (isShown) => {
      const mine = ++showing;
      stopPolling();
      if (!isShown) return;
      await read();
      if (owns(mine) && answer.value !== null && answer.value.measuring === null && isStale(answer.value)) await remeasure();
    },
    { immediate: true },
  );

  watch(query, () => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (shown.value) void read();
    }, QUERY_DEBOUNCE_MS);
  });

  onScopeDispose(() => {
    showing += 1;
    stopPolling();
    if (debounce !== null) clearTimeout(debounce);
  });

  return { answer, loaded, failed, startRefused, remeasure };
}
