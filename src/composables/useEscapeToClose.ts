import { onBeforeUnmount, onMounted, type Ref } from "vue";

// Close a full-screen overlay on Escape. The listener sits on window (not the overlay
// element) so it fires without the overlay holding focus.
export function useEscapeToClose(isOpen: Ref<boolean>, close: () => void): void {
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && isOpen.value) close();
  };
  onMounted(() => window.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
}
