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
const NOT_TEXT = 415;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The server behind the pane: a listing of FILES, and each one's text — or the refusal the server
 *  gives a file it will not serve as text, for the names in `notText`. */
function serve(notText: ReadonlySet<string> = new Set()): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://x");
    if (url.pathname.includes("/list")) return json({ entries: FILES.map((name) => ({ name, dir: false, size: 7 })) });
    if (url.pathname.includes("/text")) {
      const name = url.searchParams.get("path") ?? "";
      return notText.has(name) ? json({ error: "not text" }, NOT_TEXT) : json({ text: "# hello", version: "v1" });
    }
    return json({ ok: true });
  });
}

const mountOn = async (path: string, cwd: string | null = "/proj") => {
  const w = mount(FilesPane, { props: { cwd, initialState: oneFile(path) }, attachTo: document.body });
  await flushPromises();
  return w;
};
type Pane = Awaited<ReturnType<typeof mountOn>>;
const button = (w: Pane) => w.find('[data-testid="files-preview-tab"]');
/** The header names the open file — the proof that a test about an ABSENT button is looking at a
 *  pane with a file open, not at an empty one. */
const headerNames = (w: Pane, name: string) => w.findAll("header span").some((span) => span.text() === name);

describe("the Files pane's button that opens the Preview in a tab of its own (#3238)", () => {
  let open: MockInstance<typeof window.open>;
  beforeEach(() => {
    localStorage.clear();
    serve();
    open = vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
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

  // The routes would fall back to the server's default directory for a URL with no `cwd`; the pane
  // never sends one, because a tab it opens must name the pane's own root and nothing else.
  it("offers no button while the pane has no root, even with the file open", async () => {
    const w = await mountOn("a.md", null);
    expect(headerNames(w, "a.md")).toBe(true);
    expect(button(w).exists()).toBe(false);
  });

  it("offers no button for a file the server will not serve as text", async () => {
    vi.restoreAllMocks();
    serve(new Set(["a.md"]));
    vi.spyOn(window, "open").mockImplementation(() => null);
    const w = await mountOn("a.md");
    expect(headerNames(w, "a.md")).toBe(true);
    expect(button(w).exists()).toBe(false);
  });

  it("follows the file in front when another is opened from the tree", async () => {
    const w = await mountOn("a.md");
    await w
      .findAll('[data-testid="files-row"]')
      .find((row) => row.text().includes("c.csv"))
      ?.trigger("click");
    await flushPromises();
    expect(headerNames(w, "c.csv")).toBe(true);
    await button(w).trigger("click");
    expect(open).toHaveBeenLastCalledWith("/api/files/browse/table?cwd=%2Fproj&path=c.csv", "_blank", "noopener,noreferrer");
  });
});
