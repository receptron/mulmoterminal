import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";
import { oneFile } from "./filesPaneFixture";
import FilesPane from "../../../src/components/FilesPane.vue";
import type { FilesPaneState } from "../../../src/components/filesPaneState";
import type { FileLocation } from "../../../src/composables/filePathLocation";
import { isRecord } from "../../../common/isRecord";

// #3238, part 5. A text file outside the pane's root, opened on its own: read, previewed and saved
// against its OWN directory while the tree stays on the root and offers it nothing of the root's.
// What the server is asked — which base, which version — is the whole of the containment here, so
// every request is read back from the fetch log rather than inferred from the screen.
let onChange: () => void = () => {};
const fakeEditor = fakeCmEditor("# report, edited");
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: (_host: HTMLElement, cb: () => void) => ((onChange = cb), fakeEditor) };
});

const OUTSIDE = "/elsewhere/report.md";
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const CONFLICT = 409;

let diskMoved = false;
let fetchSpy: MockInstance<typeof fetch>;
function serve(): void {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://x");
    if (url.pathname.includes("/list"))
      return json({
        entries: [
          { name: "b.ts", dir: false, size: 1 },
          { name: "docs", dir: true },
        ],
      });
    if (url.pathname.includes("/text")) return json({ text: "# report", version: "v1" });
    if (url.pathname.includes("/version")) return json({ version: diskMoved ? "v9" : "v1" });
    if (url.pathname.includes("/write"))
      return diskMoved ? json({ error: "file changed on disk", version: "v9" }, CONFLICT) : json({ ok: true, version: "v2" });
    if (url.pathname.includes("/backup")) return json({ stored: true });
    return json({ ok: true });
  });
}
const requests = (): URL[] => fetchSpy.mock.calls.map((call) => new URL(String(call[0]), "https://x"));
const query = (url: URL): string => `${url.searchParams.get("cwd")} ${url.searchParams.get("path")}`;
const requestsTo = (route: string): string[] =>
  requests()
    .filter((url) => url.pathname.endsWith(route))
    .map(query);
const lastWriteBase = (): unknown => {
  const init: unknown = fetchSpy.mock.calls.filter((call) => String(call[0]).includes("/write")).at(-1)?.[1];
  const body = isRecord(init) && typeof init.body === "string" ? init.body : "{}";
  const parsed: unknown = JSON.parse(body);
  return isRecord(parsed) ? parsed.baseVersion : undefined;
};

type HostOpen = { openFile: (pathRel: string, location: FileLocation | undefined, newTab: boolean) => Promise<void>; snapshot: () => FilesPaneState };
const hosts = (vm: unknown): vm is HostOpen => isRecord(vm) && typeof vm.openFile === "function" && typeof vm.snapshot === "function";

const mountPane = async (initialState: FilesPaneState | null = null) => {
  const w = mount(FilesPane, { props: { cwd: "/proj", initialState }, attachTo: document.body });
  await flushPromises();
  return w;
};
type Pane = Awaited<ReturnType<typeof mountPane>>;
const openOutside = async (w: Pane) => {
  if (!hosts(w.vm)) throw new Error("the pane exposes openFile and snapshot");
  await w.vm.openFile(OUTSIDE, undefined, false);
  await flushPromises();
};
const headerNames = (w: Pane, name: string) => w.findAll("header span").some((span) => span.text() === name);
const modeButton = (w: Pane) => w.findAll("button").find((b) => b.text() === "Preview" || b.text() === "Edit");

describe("a file outside the root, open on its own (#3238)", () => {
  beforeEach(() => {
    localStorage.clear();
    diskMoved = false;
    serve();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("is read against its own directory, named with the outside mark, while the tree stays on the root", async () => {
    const w = await mountPane();
    await openOutside(w);
    expect(requestsTo("/text")).toContain("/elsewhere report.md");
    expect(headerNames(w, "report.md")).toBe(true);
    expect(w.find('[data-testid="files-outside-mark"]').attributes("data-tip")).toContain(OUTSIDE);
    // Every listing is the root's: the file's segments are never walked as folders under it.
    expect(requestsTo("/list").every((q) => q.startsWith("/proj "))).toBe(true);
    expect(w.findAll('[data-testid="files-row"]').map((row) => row.text())).not.toContain("report.md");
  });

  it("previews from its own directory, in the frame and in a tab of its own", async () => {
    const w = await mountPane();
    await openOutside(w);
    await modeButton(w)?.trigger("click");
    await flushPromises();
    const src = new URL(w.find("iframe").attributes("src") ?? "", "https://x");
    expect(src.pathname).toBe("/api/files/browse/md");
    expect(query(src)).toBe("/elsewhere report.md");
    await w.get('[data-testid="files-preview-tab"]').trigger("click");
    expect(window.open).toHaveBeenCalledWith("/api/files/browse/md?cwd=%2Felsewhere&path=report.md", "_blank", "noopener,noreferrer");
  });

  it("saves against its own directory with the version it read", async () => {
    const w = await mountPane();
    await openOutside(w);
    onChange();
    await flushPromises();
    await w.findComponent({ name: "FilesSaveButton" }).trigger("click");
    await flushPromises();
    expect(requestsTo("/write")).toEqual(["/elsewhere report.md"]);
    expect(lastWriteBase()).toBe("v1");
    expect(w.find('[data-testid="files-conflict"]').exists()).toBe(false);
  });

  // The conditional write is the same one every file gets: a disk that moved under the buffer is
  // not written over, and the pane says so.
  it("shows the conflict when the file changed on disk, and writes nothing over it", async () => {
    const w = await mountPane();
    await openOutside(w);
    onChange();
    await flushPromises();
    diskMoved = true;
    await w.findComponent({ name: "FilesSaveButton" }).trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="files-conflict"]').exists()).toBe(true);
  });

  it("offers neither History nor Changes, and is not among the folder's recent files", async () => {
    const w = await mountPane();
    await openOutside(w);
    expect(w.find('[data-testid="files-history-btn"]').exists()).toBe(false);
    expect(w.find('[data-testid="files-changes-btn"]').exists()).toBe(false);
    expect(requestsTo("/head")).toEqual([]);
    const stored = Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? "");
    expect(stored.some((value) => value.includes(OUTSIDE))).toBe(false);
  });

  it("stays in the snapshot and comes back from it, against its own directory again", async () => {
    const w = await mountPane();
    await openOutside(w);
    if (!hosts(w.vm)) throw new Error("the pane exposes snapshot");
    const snapshot = w.vm.snapshot();
    expect(snapshot.tabs.map((tab) => tab.path)).toContain(OUTSIDE);
    document.body.innerHTML = "";
    fetchSpy.mockClear();
    const again = await mountPane(oneFile(OUTSIDE));
    expect(requestsTo("/text")).toContain("/elsewhere report.md");
    expect(headerNames(again, "report.md")).toBe(true);
  });

  // A URL can spell a root file absolute (the full-screen view's `?path=`); it must not become an
  // outside tab, which would hide History and Changes for a file that has them.
  it("opens a requested root file spelled absolute as a root file", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj", requestedPath: "/proj/b.ts" }, attachTo: document.body });
    await flushPromises();
    expect(requestsTo("/text")).toContain("/proj b.ts");
    expect(headerNames(w, "b.ts")).toBe(true);
    expect(w.find('[data-testid="files-outside-mark"]').exists()).toBe(false);
  });

  // The root's own files are untouched by the rule: a relative path is still read under the root.
  it("still reads a file under the root relative to it", async () => {
    const w = await mountPane();
    await openOutside(w);
    await w
      .findAll('[data-testid="files-row"]')
      .find((row) => row.text().includes("b.ts"))
      ?.trigger("click");
    await flushPromises();
    expect(requestsTo("/text")).toContain("/proj b.ts");
  });
});
