// The one keyboard driver the menus share (#3257): what each key does to the focus, which keys are
// consumed, and which are left to whoever else listens.
import { describe, it, expect, vi, afterEach } from "vitest";
import { menuKeydown } from "../../../src/components/menuKeyboard";

const mountItems = (count: number): HTMLButtonElement[] => {
  const items = Array.from({ length: count }, (_, i) => {
    const button = document.createElement("button");
    button.textContent = `item ${i}`;
    document.body.append(button);
    return button;
  });
  items[0]?.focus();
  return items;
};
const press = (items: HTMLElement[], key: string, leave = vi.fn()): { event: KeyboardEvent; leave: ReturnType<typeof vi.fn> } => {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  menuKeydown(event, items, leave);
  return { event, leave };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("menuKeydown", () => {
  it("walks the items with the arrows, wrapping, and jumps with Home and End", () => {
    const items = mountItems(3);
    expect(press(items, "ArrowDown").event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    press(items, "End");
    expect(document.activeElement).toBe(items[2]);
    press(items, "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    press(items, "ArrowUp");
    expect(document.activeElement).toBe(items[2]);
    press(items, "Home");
    expect(document.activeElement).toBe(items[0]);
  });

  it.each(["Escape", "Tab"])("leaves on %s, consuming the key", (key) => {
    const items = mountItems(2);
    const { event, leave } = press(items, key);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  it("leaves any other key alone", () => {
    const items = mountItems(2);
    const { event, leave } = press(items, "a");
    expect(leave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(items[0]);
  });

  it("does nothing for the arrows when there are no items", () => {
    const { event, leave } = press([], "ArrowDown");
    expect(leave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
