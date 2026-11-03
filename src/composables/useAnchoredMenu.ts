// A toolbar menu teleported to <body> and fixed under its trigger. It is teleported because the
// toolbar's nav scrolls horizontally and would clip it; being fixed, it would drift from the trigger
// on any scroll, so a scroll closes it. Keyboard: focus moves in on open, the arrows / Home / End
// move it, Escape and Tab close and hand focus back to the trigger.
import { nextTick, onBeforeUnmount, ref, watch, type Ref, type ShallowRef } from "vue";
import { fitMenu, type MenuPoint } from "../components/rowMenu";
import { menuKeydown } from "../components/menuKeyboard";
import { useDropdownMenu } from "./useDropdownMenu";

export interface AnchoredMenuOptions {
  /** Selects the focusable items inside the menu, in order. */
  itemSelector: string;
  /** Which item takes focus when the menu opens. */
  initialItem: (items: HTMLElement[]) => HTMLElement | undefined;
}

export interface AnchoredMenu {
  open: Ref<boolean>;
  pos: Ref<MenuPoint>;
  toggle: () => void;
  /** Close without moving focus, for a menu invalidated by something other than the user. */
  close: () => void;
  /** Close and return focus to the trigger's button. */
  leave: () => void;
  onMenuKeydown: (event: KeyboardEvent) => void;
}

type ElementRef = Readonly<ShallowRef<HTMLElement | null>>;

export function useAnchoredMenu(trigger: ElementRef, menu: ElementRef, options: AnchoredMenuOptions): AnchoredMenu {
  const pos = ref<MenuPoint>({ top: 0, left: 0 });
  const { open, close, toggle } = useDropdownMenu(trigger, () => void enter());
  const items = (): HTMLElement[] => [...(menu.value?.querySelectorAll<HTMLElement>(options.itemSelector) ?? [])];

  // Placed once it has rendered, since only then is its size known: under the trigger, then pulled
  // back inside the viewport.
  async function place(): Promise<void> {
    const rect = trigger.value?.getBoundingClientRect();
    if (!rect) return;
    pos.value = { top: rect.bottom + 4, left: rect.left };
    await nextTick();
    const box = menu.value?.getBoundingClientRect();
    if (box) pos.value = fitMenu(pos.value, box, { width: window.innerWidth, height: window.innerHeight });
  }

  async function enter(): Promise<void> {
    await place();
    options.initialItem(items())?.focus({ preventScroll: true });
  }

  function leave(): void {
    close();
    trigger.value?.querySelector("button")?.focus({ preventScroll: true });
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    menuKeydown(event, items(), leave);
  }

  // A menu long enough to scroll its own list must survive that scroll: only the page moving under
  // it detaches it from the trigger.
  function closeOnOuterScroll(event: Event): void {
    const target = event.target instanceof Node ? event.target : null;
    if (!menu.value?.contains(target)) close();
  }
  const stopClosingOnScroll = (): void => window.removeEventListener("scroll", closeOnOuterScroll, true);
  watch(open, (isOpen) => {
    if (isOpen) window.addEventListener("scroll", closeOnOuterScroll, true);
    else stopClosingOnScroll();
  });
  onBeforeUnmount(stopClosingOnScroll);

  return { open, pos, toggle, close, leave, onMenuKeydown };
}
