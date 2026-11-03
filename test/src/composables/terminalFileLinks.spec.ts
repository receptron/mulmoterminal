// The wiring between a terminal's link provider and the one right-click menu (#3238): the provider
// says which link the pointer is over, and a `contextmenu` on the terminal element asks for the menu
// there — and only there, so off a link the browser keeps its own menu.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { Terminal } from "@xterm/xterm";
import type { HoveredLink } from "../../../src/composables/terminalLinkMenu";

const onHoverOf = vi.fn<(link: HoveredLink | null) => void>();
vi.mock("../../../src/composables/terminalFilePathLinkProvider", () => ({
  createFilePathLinkProvider: (_term: unknown, _cwd: unknown, openers: { onHover?: (link: HoveredLink | null) => void }) => {
    if (openers.onHover) onHoverOf.mockImplementation(openers.onHover);
    return { provideLinks: () => {} };
  },
}));

const { registerFilePathLinks } = await import("../../../src/composables/terminalFileLinks");
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

  it("leaves a right-click off any link to the browser", () => {
    const term = openTerminal();
    onHoverOf({ text: "docs/a.md", cwd: "/proj", location: undefined });
    onHoverOf(null);
    const event = rightClick(term, 10, 10);
    expect(event.defaultPrevented).toBe(false);
    expect(linkMenuRequest.value).toBeNull();
  });
});
