import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";
import FilesPane from "../../../src/components/FilesPane.vue";
import type { FilesPaneState } from "../../../src/components/filesPaneState";

const fakeEditor = fakeCmEditor("");
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: () => fakeEditor };
});

// A tree with a file two folders down, so "the tree shows the front tab" has folders to open.
const LISTINGS: Record<string, { name: string; dir: boolean }[]> = {
  "": [
    { name: "docs", dir: true },
    { name: "readme.md", dir: false },
  ],
  docs: [
    { name: "deep", dir: true },
    { name: "a.md", dir: false },
  ],
  "docs/deep": [{ name: "x.md", dir: false }],
};

const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.getAttribute("data-path") ?? "");
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://x");
    const path = url.searchParams.get("path") ?? "";
    if (url.pathname.includes("/list")) return { ok: true, json: async () => ({ entries: (LISTINGS[path] ?? []).map((e) => ({ ...e, size: 1 })) }) };
    if (url.pathname.includes("/text")) return { ok: true, json: async () => ({ text: `text of ${path}`, version: "v1" }) };
    return { ok: true, json: async () => ({ ok: true, version: "v1" }) };
  }) as unknown as typeof fetch;
});
afterEach(() => {
  document.body.innerHTML = "";
});

const rows = (w: VueWrapper): string[] => w.findAll('[data-testid="files-row"]').map((r) => r.attributes("data-path") ?? "");
const mountPane = async (initialState: FilesPaneState): Promise<VueWrapper> => {
  const w = mount(FilesPane, { props: { cwd: "/proj", initialState }, attachTo: document.body });
  await flushPromises();
  return w;
};

// #2495. The tree follows the tab in front, as VS Code's explorer follows the active editor.
describe("the Files tree follows the tab in front", () => {
  it("opens a front tab's folders and brings its row into view", async () => {
    const w = await mountPane({ tabs: [{ path: "readme.md" }, { path: "docs/deep/x.md" }], activePath: "readme.md", expanded: [] });
    expect(rows(w)).toEqual(["docs", "readme.md"]);

    await w.find('[data-testid="files-tab"][data-path="docs/deep/x.md"]').trigger("click");
    await flushPromises();

    expect(rows(w)).toEqual(["docs", "docs/deep", "docs/deep/x.md", "docs/a.md", "readme.md"]);
    expect(scrolled).toContain("docs/deep/x.md");
  });

  // The remembered tree — its folders and its scroll — is what a reload puts back (#2156); the
  // front tab does not override it.
  it("leaves the remembered tree alone while the pane is put back", async () => {
    const w = await mountPane({ tabs: [{ path: "docs/deep/x.md" }, { path: "readme.md" }], activePath: "docs/deep/x.md", expanded: [] });
    expect(rows(w)).toEqual(["docs", "readme.md"]);
    expect(scrolled).toEqual([]);
  });

  it("follows a file opened by the host once the pane is up", async () => {
    const w = await mountPane({ tabs: [{ path: "readme.md" }], activePath: "readme.md", expanded: [] });
    await (w.vm as unknown as { openFile: (p: string) => Promise<void> }).openFile("docs/a.md");
    await flushPromises();

    expect(rows(w)).toContain("docs/a.md");
    expect(scrolled).toContain("docs/a.md");
  });

  // #3557. A path clicked in terminal output opens the pane and the file together, so the file comes
  // to the front while the root is still being listed — before following starts.
  const mountWithRootHeld = (): { w: VueWrapper; releaseRoot: () => void } => {
    let releaseRoot = (): void => {};
    const rootHeld = new Promise<void>((resolve) => (releaseRoot = resolve));
    const serve = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://x");
      if (url.pathname.includes("/list") && (url.searchParams.get("path") ?? "") === "") await rootHeld;
      return serve(input);
    }) as unknown as typeof fetch;
    const w = mount(FilesPane, { props: { cwd: "/proj", initialState: { tabs: [], activePath: null, expanded: [] } }, attachTo: document.body });
    return { w, releaseRoot };
  };
  const rowsAfterRoot = async (w: VueWrapper, releaseRoot: () => void): Promise<string[]> => {
    await flushPromises();
    releaseRoot();
    await flushPromises();
    return rows(w);
  };
  const SHOWN = ["docs", "docs/deep", "docs/deep/x.md", "docs/a.md", "readme.md"];

  it("follows a file the host opened while the pane was still starting", async () => {
    const { w, releaseRoot } = mountWithRootHeld();
    void (w.vm as unknown as { openFile: (p: string) => Promise<void> }).openFile("docs/deep/x.md");
    expect(await rowsAfterRoot(w, releaseRoot)).toEqual(SHOWN);
    expect(scrolled).toContain("docs/deep/x.md");
  });

  it("follows a file the route asked for while the pane was still starting", async () => {
    const { w, releaseRoot } = mountWithRootHeld();
    await w.setProps({ requestedPath: "docs/deep/x.md" });
    expect(await rowsAfterRoot(w, releaseRoot)).toEqual(SHOWN);
    expect(scrolled).toContain("docs/deep/x.md");
  });

  it("follows a file an agent showed while the pane was still starting", async () => {
    const { w, releaseRoot } = mountWithRootHeld();
    void (w.vm as unknown as { showFile: (t: { path: string; view: string }) => Promise<void> }).showFile({ path: "docs/deep/x.md", view: "editor" });
    expect(await rowsAfterRoot(w, releaseRoot)).toEqual(SHOWN);
    expect(scrolled).toContain("docs/deep/x.md");
  });
});

// #3058. A directory with many files hid which one was open: the remembered scroll could leave its row
// off screen, and its mark was the hover colour.
describe("the open file in the Files tree", () => {
  it("brings the open row into view once the pane is put back, when the remembered folders show it", async () => {
    await mountPane({ tabs: [{ path: "docs/a.md" }], activePath: "docs/a.md", expanded: ["docs"] });
    expect(scrolled).toContain("docs/a.md");
  });

  it("marks the open row as current, in the tabs' selected colour, and no other row", async () => {
    const w = await mountPane({ tabs: [{ path: "docs/a.md" }], activePath: "docs/a.md", expanded: ["docs"] });
    const current = w.findAll('[data-testid="files-row"][aria-current="true"]');
    expect(current.map((r) => r.attributes("data-path"))).toEqual(["docs/a.md"]);
    expect(current[0].classes()).toContain("bg-selected");
    // `bg-transparent` beside it wins in the stylesheet, which is how the old mark never showed at all.
    expect(current[0].classes()).not.toContain("bg-transparent");
  });
});
