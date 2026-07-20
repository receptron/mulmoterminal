// Open/close state for a header dropdown, dismissed by a pointerdown outside the
// menu's root element or by Escape. The window listeners are attached only while
// open and are dropped on unmount, so a menu whose trigger disappears (e.g. its list
// emptied by a cwd change) cannot leave them attached.
import { ref, onUnmounted, type ShallowRef } from "vue";

export function useDropdownMenu(rootRef: Readonly<ShallowRef<HTMLElement | null>>, onOpen?: () => void) {
  const open = ref(false);

  function onOutside(event: PointerEvent) {
    const root = rootRef.value;
    const target = event.target instanceof Node ? event.target : null;
    if (root && !root.contains(target)) close();
  }
  function onEscape(event: KeyboardEvent) {
    if (event.key === "Escape") close();
  }

  function openMenu() {
    open.value = true;
    window.addEventListener("pointerdown", onOutside);
    window.addEventListener("keydown", onEscape);
    onOpen?.();
  }
  function close() {
    open.value = false;
    window.removeEventListener("pointerdown", onOutside);
    window.removeEventListener("keydown", onEscape);
  }
  function toggle() {
    if (open.value) close();
    else openMenu();
  }

  onUnmounted(close);

  return { open, close, toggle };
}
