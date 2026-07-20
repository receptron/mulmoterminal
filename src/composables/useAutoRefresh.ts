import { onMounted, onBeforeUnmount, watch, type WatchSource } from "vue";

// Also refreshes on mount and whenever the window regains focus (focus listener cleaned up on unmount).
export function useAutoRefresh(refresh: () => void | Promise<void>, sources: WatchSource<unknown>[]): void {
  const onFocus = () => void refresh();
  onMounted(() => {
    void refresh();
    window.addEventListener("focus", onFocus);
  });
  onBeforeUnmount(() => window.removeEventListener("focus", onFocus));
  watch(sources, () => void refresh());
}
