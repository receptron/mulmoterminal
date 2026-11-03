// One keyboard for every role="menu" here: Escape and Tab leave, the arrows walk the items and wrap,
// Home and End jump (menuFocusMove). A menu hands over its own enabled items and its own way out, so
// the three menus cannot drift apart one key at a time.
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
