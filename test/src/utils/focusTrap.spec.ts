import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { trapTabKey } from "../../../src/utils/focusTrap";

// jsdom's element.focus() only sets document.activeElement for elements attached to
// the document, so the container is mounted into document.body per test.
function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

function el(container: HTMLElement, selector: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`test fixture missing: ${selector}`);
  return found;
}

function tab(shift: boolean): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, cancelable: true });
}

describe("trapTabKey", () => {
  let container: HTMLElement;
  afterEach(() => container?.remove());

  describe("with three focusable buttons", () => {
    beforeEach(() => {
      container = mount('<button id="a">a</button><button id="b">b</button><button id="c">c</button>');
    });

    it("Tab from the last element wraps to the first", () => {
      el(container, "#c").focus();
      const e = tab(false);
      trapTabKey(e, container);
      expect(document.activeElement).toBe(el(container, "#a"));
      expect(e.defaultPrevented).toBe(true);
    });

    it("Shift+Tab from the first element wraps to the last", () => {
      el(container, "#a").focus();
      const e = tab(true);
      trapTabKey(e, container);
      expect(document.activeElement).toBe(el(container, "#c"));
      expect(e.defaultPrevented).toBe(true);
    });

    it("does nothing when focus is on a middle element (native Tab proceeds)", () => {
      el(container, "#b").focus();
      const e = tab(false);
      trapTabKey(e, container);
      expect(document.activeElement).toBe(el(container, "#b"));
      expect(e.defaultPrevented).toBe(false);
    });
  });

  it("skips disabled elements when picking first/last", () => {
    container = mount('<button id="a">a</button><button id="b">b</button><button id="c" disabled>c</button>');
    el(container, "#b").focus(); // #b is the last ENABLED element
    const e = tab(false);
    trapTabKey(e, container);
    expect(document.activeElement).toBe(el(container, "#a"));
    expect(e.defaultPrevented).toBe(true);
  });

  it("is a no-op when nothing matches the selector", () => {
    container = mount("<span>no focusables</span>");
    const e = tab(false);
    trapTabKey(e, container);
    expect(e.defaultPrevented).toBe(false);
  });

  it("honors a custom selector (e.g. including inputs)", () => {
    container = mount('<input id="in" /><button id="btn">b</button>');
    el(container, "#in").focus();
    const e = tab(true);
    trapTabKey(e, container, 'button, input, [tabindex]:not([tabindex="-1"])');
    expect(document.activeElement).toBe(el(container, "#btn"));
    expect(e.defaultPrevented).toBe(true);
  });
});
