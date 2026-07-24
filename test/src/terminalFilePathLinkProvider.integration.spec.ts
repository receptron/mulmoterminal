// Integration check against the REAL xterm Terminal (not the unit mock): confirms that
// our cell reading + column mapping + link ranges agree with how xterm actually stores
// wide (CJK) glyphs and numbers its columns. This is the part the pure unit tests can't
// vouch for.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { Terminal } from "@xterm/xterm";
import { createFilePathLinkProvider } from "../../src/composables/terminalFilePathLinkProvider";
import type { ILink } from "@xterm/xterm";

// xterm's Terminal.open() reaches for browser APIs jsdom omits; stub the few it needs.
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
  if (!("ResizeObserver" in window)) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

async function writeLine(term: Terminal, text: string): Promise<void> {
  await new Promise<void>((resolve) => term.write(text, resolve));
}

function provideLinks(term: Terminal, cwd: string | null, open: (url: string) => void): ILink[] | undefined {
  const provider = createFilePathLinkProvider(term, () => cwd, open);
  let result: ILink[] | undefined;
  provider.provideLinks(1, (links) => {
    result = links;
  });
  return result;
}

describe("createFilePathLinkProvider against real xterm", () => {
  it("linkifies the path after CJK text and opens the cwd-scoped raw URL", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "添付（dir/a.gif）");

    const open = vi.fn();
    const links = provideLinks(term, "/Users/me/proj", open);
    if (!links) throw new Error("expected the provider to return links");
    expect(links).toHaveLength(1);

    const [link] = links;
    expect(link.text).toBe("dir/a.gif");
    // 添(1-2) 付(3-4) （(5-6) d(7)…f(15) — real xterm columns, 1-based inclusive.
    expect(link.range).toEqual({ start: { x: 7, y: 1 }, end: { x: 15, y: 1 } });

    link.activate(new MouseEvent("click"), link.text);
    expect(open).toHaveBeenCalledWith("/api/files/raw?cwd=%2FUsers%2Fme%2Fproj&path=dir%2Fa.gif");

    term.dispose();
  });

  it("provides no links when the session cwd is unknown", async () => {
    const term = new Terminal({ cols: 80, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "dir/a.gif");
    expect(provideLinks(term, null, vi.fn())).toBeUndefined();
    term.dispose();
  });
});
