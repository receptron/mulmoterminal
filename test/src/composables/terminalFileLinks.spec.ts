// The wiring between a terminal's link provider and the one right-click menu (#3238): the provider
// says which link the pointer is over, and a `contextmenu` on the terminal element asks for the menu
// there — and only there, so off a link the browser keeps its own menu.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { Terminal } from "@xterm/xterm";
import type { HoveredLink } from "../../../src/composables/terminalLinkMenu";

type OnHover = (link: HoveredLink | null) => void;
// One per registered terminal, in registration order; `onHoverOf` is the latest terminal's.
const hoverHandlers: OnHover[] = [];
const onHoverOf: OnHover = (link) => hoverHandlers[hoverHandlers.length - 1]?.(link);
vi.mock("../../../src/composables/terminalFilePathLinkProvider", () => ({
  createFilePathLinkProvider: (_term: unknown, _cwd: unknown, openers: { onHover?: OnHover }) => {
    if (openers.onHover) hoverHandlers.push(openers.onHover);
    return { provideLinks: () => {} };
  },
}));

const { registerFilePathLinks, forgetFilePathLinks } = await import("../../../src/composables/terminalFileLinks");
const { linkMenuRequest, closeLinkMenu } = await import("../../../src/composables/terminalLinkMenu");

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const openTerminal = (): Terminal => {
  const term = new Terminal({ cols: 80, rows: 5, allowProposedApi: true });
  term.open(document.createElement("div"));
  registerFilePathLinks(term, () => "/proj");
  return term;
};
const rightClick = (term: Terminal, clientX: number, clientY: number): MouseEvent => {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY });
  term.element?.dispatchEvent(event);
  return event;
};

beforeEach(() => closeLinkMenu());

describe("registerFilePathLinks and the right-click menu", () => {
  it("asks for the menu at the pointer, for the link under it, and keeps the browser's menu away", () => {
    const term = openTerminal();
    onHoverOf({ text: "docs/a.md", cwd: "/proj", location: { line: 3, col: null } });
    const event = rightClick(term, 120, 80);
    expect(event.defaultPrevented).toBe(true);
    expect(linkMenuRequest.value).toEqual({ text: "docs/a.md", cwd: "/proj", location: { line: 3, col: null }, point: { top: 80, left: 120 } });
  });

  // A terminal is disposed with the pointer still over a link, or with its menu open: the hover
  // and the menu go with it — but only the menu IT asked for, never one another terminal opened.
  it("forgets a disposed terminal's hover and the menu it asked for, and no other terminal's", () => {
    const first = openTerminal();
    const hoverFirst = hoverHandlers[hoverHandlers.length - 1];
    const second = openTerminal();
    hoverFirst?.({ text: "docs/a.md", cwd: "/proj", location: undefined });
    rightClick(first, 5, 5);
    const asked = linkMenuRequest.value;
    expect(asked?.text).toBe("docs/a.md");
    forgetFilePathLinks(second);
    expect(linkMenuRequest.value).toBe(asked);
    forgetFilePathLinks(first);
    expect(linkMenuRequest.value).toBeNull();
    expect(rightClick(first, 5, 5).defaultPrevented).toBe(false);
  });

  it("leaves a menu another terminal has since asked for", () => {
    const first = openTerminal();
    const hoverFirst = hoverHandlers[hoverHandlers.length - 1];
    const second = openTerminal();
    const hoverSecond = hoverHandlers[hoverHandlers.length - 1];
    hoverFirst?.({ text: "docs/a.md", cwd: "/proj", location: undefined });
    rightClick(first, 5, 5);
    hoverSecond?.({ text: "src/b.ts", cwd: "/proj", location: undefined });
    rightClick(second, 9, 9);
    forgetFilePathLinks(first);
    expect(linkMenuRequest.value?.text).toBe("src/b.ts");
  });

  it("leaves a right-click off any link to the browser", () => {
    const term = openTerminal();
    onHoverOf({ text: "docs/a.md", cwd: "/proj", location: undefined });
    onHoverOf(null);
    const event = rightClick(term, 10, 10);
    expect(event.defaultPrevented).toBe(false);
    expect(linkMenuRequest.value).toBeNull();
  });
});
