import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";
import { oneFile } from "./filesPaneFixture";
import FilesPane from "../../../src/components/FilesPane.vue";

// #3238, part 3. The pane shows a Markdown file's Preview in a frame built for the pane: no toolbar,
// and a URL that carries the frame's token. The tab a clicked path opens is a different document —
// the one with the Source view and the copy buttons — and the header's button is the way from the
// first to the second. So what the button opens is what matters: the tab's URL, never the frame's.
const fakeEditor = fakeCmEditor("# hello");
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: () => fakeEditor };
});

const FILES = ["a.md", "b.ts", "c.csv", "d.json", "page.html"];

function serve(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://x");
    if (url.pathname.includes("/list")) return { ok: true, json: async () => ({ entries: FILES.map((name) => ({ name, dir: false, size: 7 })) }) };
    if (url.pathname.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
    return { ok: true, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
}

const mountOn = async (path: string) => {
  const w = mount(FilesPane, { props: { cwd: "/proj", initialState: oneFile(path) }, attachTo: document.body });
  await flushPromises();
  return w;
};
const button = (w: Awaited<ReturnType<typeof mountOn>>) => w.find('[data-testid="files-preview-tab"]');

describe("the Files pane's button that opens the Preview in a tab of its own (#3238)", () => {
  let open: MockInstance<typeof window.open>;
  beforeEach(() => {
    localStorage.clear();
    serve();
    open = vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    open.mockRestore();
    document.body.innerHTML = "";
  });

  it("opens the tab's rendered document for a Markdown file, in a tab that cannot reach this one", async () => {
    const w = await mountOn("a.md");
    await button(w).trigger("click");
    expect(open).toHaveBeenCalledWith("/api/files/browse/md?cwd=%2Fproj&path=a.md", "_blank", "noopener,noreferrer");
  });

  // The frame's URL for the same file says `embed`; the tab's must not, or the tab gets the
  // toolbar-less document and the button does nothing a Preview did not.
  it("opens the tab's document and not the frame's", async () => {
    const w = await mountOn("a.md");
    await button(w).trigger("click");
    const opened = new URL(String(open.mock.calls[0]?.[0]), "https://x");
    expect([...opened.searchParams.keys()].sort()).toEqual(["cwd", "path"]);
  });

  it("goes to the table route for a CSV and the JSON route for JSON", async () => {
    await button(await mountOn("c.csv")).trigger("click");
    expect(open).toHaveBeenLastCalledWith("/api/files/browse/table?cwd=%2Fproj&path=c.csv", "_blank", "noopener,noreferrer");
    document.body.innerHTML = "";
    await button(await mountOn("d.json")).trigger("click");
    expect(open).toHaveBeenLastCalledWith("/api/files/browse/json?cwd=%2Fproj&path=d.json", "_blank", "noopener,noreferrer");
  });

  it("offers no button for a file a tab has no rendered document for", async () => {
    expect(button(await mountOn("b.ts")).exists()).toBe(false);
    document.body.innerHTML = "";
    expect(button(await mountOn("page.html")).exists()).toBe(false);
  });
});
