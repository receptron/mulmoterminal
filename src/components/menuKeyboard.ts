// One keyboard for the menus that take the focus when they open — the anchored menus, the terminal
// link menu, the cockpit row menu: Escape and Tab leave, the arrows walk the items and wrap, Home and
// End jump (menuFocusMove). A menu hands over its own enabled items and its own way out, so the three
// cannot drift apart one key at a time. The Files row menu is a role="menu" too and stays on its own
// handler on purpose: its Escape and Tab hand the focus back to the row, not to a trigger.
import { menuFocusMove } from "./filesRowActions";

export function menuKeydown(event: KeyboardEvent, items: HTMLElement[], leave: () => void): void {
  if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    leave();
    return;
  }
  const next = menuFocusMove(
    event.key,
    items.findIndex((el) => el === document.activeElement),
    items.length,
  );
  if (next === null) return;
  event.preventDefault();
  items[next]?.focus({ preventScroll: true });
}
