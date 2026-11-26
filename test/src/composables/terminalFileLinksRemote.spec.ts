// #3506. A path a remote cell prints names a file on its host: it opens in that cell's Files pane or
// nowhere — never in a tab or the Files view, which read this machine's disk — and it is a link only
// when it is under the cell's directory, the one the gateway serves. A local terminal is the control.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { Terminal, type ILink, type ILinkProvider } from "@xterm/xterm";

const gotoFile = vi.hoisted(() => vi.fn());
vi.mock("../../../src/composables/useFilesView", () => ({ filesGotoFile: gotoFile }));

const { registerFilePathLinks } = await import("../../../src/composables/terminalFileLinks");
const { setFilesPaneOpener } = await import("../../../src/composables/filesPaneOpener");
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

const CWD = "/srv/p";
const PRINTED = "see src/main.ts and /etc/hosts.md and ../up.ts and out/img.png and out/book.xlsx";
let opened: ReturnType<typeof vi.fn>;

beforeEach(() => {
  opened = vi.fn();
  vi.stubGlobal("open", opened);
  gotoFile.mockReset();
  closeLinkMenu();
});
afterEach(() => {
  setFilesPaneOpener(null);
  vi.unstubAllGlobals();
});

async function linksOn(host: string | null): Promise<ILink[]> {
  const term = new Terminal({ cols: 120, rows: 5, allowProposedApi: true });
  term.open(document.createElement("div"));
  const providers: ILinkProvider[] = [];
  vi.spyOn(term, "registerLinkProvider").mockImplementation((provider) => {
    providers.push(provider);
    return { dispose: () => {} };
  });
  registerFilePathLinks(term, { cwd: () => CWD, session: () => "s1", host });
  await new Promise<void>((resolve) => term.write(PRINTED, resolve));
  let found: ILink[] = [];
  providers[0]?.provideLinks(1, (links) => {
    found = links ?? [];
  });
  return found;
}

const click = (link: ILink | undefined): void => link?.activate(new MouseEvent("mouseup", { button: 0 }), link.text);
const named = (links: ILink[], text: string): ILink | undefined => links.find((link) => link.text === text);

describe("a remote cell's printed paths", () => {
  it("are links only under the cell's directory", async () => {
    expect((await linksOn("lx")).map((link) => link.text)).toEqual(["src/main.ts", "out/img.png", "out/book.xlsx"]);
  });

  it("are all links on this machine (control)", async () => {
    expect((await linksOn(null)).map((link) => link.text)).toEqual(["src/main.ts", "/etc/hosts.md", "../up.ts", "out/img.png", "out/book.xlsx"]);
  });

  // The pane is the only place a remote file shows, so even what a tab would show better goes there.
  it("go to the pane with the host, whatever the kind of file", async () => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    const links = await linksOn("lx");
    ["src/main.ts", "out/img.png", "out/book.xlsx"].forEach((text) => click(named(links, text)));
    expect(opener.mock.calls).toEqual([
      [CWD, "src/main.ts", undefined, false, "s1", "lx"],
      [CWD, "out/img.png", undefined, false, "s1", "lx"],
      [CWD, "out/book.xlsx", undefined, false, "s1", "lx"],
    ]);
  });

  it("open nothing on this machine when the pane declines", async () => {
    setFilesPaneOpener(() => false);
    const links = await linksOn("lx");
    links.forEach(click);
    expect(opened).not.toHaveBeenCalled();
    expect(gotoFile).not.toHaveBeenCalled();
  });

  it("fall back to a tab or the Files view on this machine (control)", async () => {
    setFilesPaneOpener(() => false);
    const links = await linksOn(null);
    click(named(links, "src/main.ts"));
    click(named(links, "out/img.png"));
    expect(gotoFile).toHaveBeenCalledWith(CWD, "src/main.ts", undefined);
    expect(opened).toHaveBeenCalledWith(expect.stringContaining("/api/files/raw?"), "_blank", "noopener,noreferrer");
  });

  it("ask for the right-click menu with the host", async () => {
    const term = new Terminal({ cols: 120, rows: 5, allowProposedApi: true });
    term.open(document.createElement("div"));
    let provider: ILinkProvider | undefined;
    vi.spyOn(term, "registerLinkProvider").mockImplementation((given) => {
      provider = given;
      return { dispose: () => {} };
    });
    registerFilePathLinks(term, { cwd: () => CWD, session: () => "s1", host: "lx" });
    await new Promise<void>((resolve) => term.write(PRINTED, resolve));
    provider?.provideLinks(1, (links) => links?.[0]?.hover?.(new MouseEvent("mouseover"), links[0].text));
    term.element?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 3, clientY: 4 }));
    expect(linkMenuRequest.value).toMatchObject({ text: "src/main.ts", host: "lx", session: "s1" });
  });
});
