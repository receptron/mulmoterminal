import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesPane from "../../../src/components/FilesPane.vue";

// The finder where it actually lives (#2099): inside the pane, on top of the tree. What it RANKS
// is filePathMatch's job and what the panel DOES is FileFinder.spec.ts — this file is about the
// join: that the button opens it, and that picking a file both opens it AND shows the reader where
// in the tree it came from, which is what the request asked for ("ツリー側でもそのファイルの位置が
// 分かると、周辺のファイルへ移りやすくなります").

const fakeEditor = { setDoc: vi.fn(), getDoc: vi.fn(() => ""), destroy: vi.fn() };
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: () => fakeEditor };
});

// A two-deep project, so "did the ancestors get expanded" is a real question rather than a
// one-level one that a bare `loadFile` would also satisfy.
const LISTING: Record<string, { name: string; dir: boolean; size: number }[]> = {
  "": [
    { name: "src", dir: true, size: 0 },
    { name: "README.md", dir: false, size: 3 },
  ],
  src: [{ name: "deep", dir: true, size: 0 }],
  "src/deep": [{ name: "buried.ts", dir: false, size: 9 }],
};

const textRequests: string[] = [];
// Lets one test hold the `src/deep` listing open, so a second pick can overtake the first.
let heldDeepListing: Promise<void> | null = null;
// Lets one test hold a /text response open across a reload.
let heldText: Promise<void> | null = null;
// Lets one test hold the ROOT listing open, so a pick can arrive before the tree exists.
let heldRootListing: Promise<void> | null = null;

function mockFs(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/index")) {
      return { ok: true, status: 200, json: async () => ({ paths: ["README.md", "src/deep/buried.ts"], truncated: false, source: "git" }) };
    }
    if (url.pathname.endsWith("/list")) {
      const at = url.searchParams.get("path") ?? "";
      if (at === "src/deep" && heldDeepListing) await heldDeepListing;
      if (at === "" && heldRootListing) await heldRootListing;
      return { ok: true, status: 200, json: async () => ({ entries: LISTING[at] ?? [] }) };
    }
    if (url.pathname.endsWith("/text")) {
      const at = url.searchParams.get("path") ?? "";
      textRequests.push(at);
      if (heldText) await heldText;
      return { ok: true, status: 200, json: async () => ({ text: `content of ${at}`, version: "v1" }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, version: "v2" }) };
  }) as unknown as typeof fetch;
}

type Scrollable = { scrollIntoView?: (arg?: unknown) => void };
const scrolled = vi.fn();

const realFetch = globalThis.fetch;
beforeEach(() => {
  textRequests.length = 0;
  heldDeepListing = null;
  heldText = null;
  heldRootListing = null;
  scrolled.mockClear();
  mockFs();
  (Element.prototype as Scrollable).scrollIntoView = scrolled;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (Element.prototype as Scrollable).scrollIntoView;
  document.body.innerHTML = "";
});

const mountPane = async () => {
  const w = mount(FilesPane, { props: { cwd: "/proj" }, attachTo: document.body });
  await flushPromises();
  return w;
};

const treeRows = (w: Awaited<ReturnType<typeof mountPane>>) => w.findAll('[data-testid="files-row"]').map((r) => r.attributes("data-path"));

describe("the Files pane's finder", () => {
  // Nothing is bound by default in `keymap`, so without this button the feature is invisible to
  // anyone who has not written one.
  it("opens from the pane's own button, with no shortcut configured", async () => {
    const w = await mountPane();
    expect(w.find('[data-testid="file-finder"]').exists()).toBe(false);
    await w.find('[data-testid="files-find-btn"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="file-finder"]').exists()).toBe(true);
  });

  it("opens from the host, which is how the shortcut reaches it", async () => {
    const w = await mountPane();
    (w.vm as unknown as { openFinder: () => void }).openFinder();
    await flushPromises();
    expect(w.find('[data-testid="file-finder"]').exists()).toBe(true);
  });

  it("opens the picked file and expands the tree down to it", async () => {
    const w = await mountPane();
    expect(treeRows(w)).toEqual(["src", "README.md"]); // nothing below the root is open yet

    await w.find('[data-testid="files-find-btn"]').trigger("click");
    await flushPromises();
    await w.find('[data-testid="file-finder-input"]').setValue("buried");
    await flushPromises();
    await w.find('[data-testid="file-finder-row"]').trigger("click");
    await flushPromises();

    expect(textRequests).toEqual(["src/deep/buried.ts"]);
    expect(treeRows(w)).toEqual(["src", "src/deep", "src/deep/buried.ts", "README.md"]);
    expect(w.find('[data-testid="file-finder"]').exists()).toBe(false);
  });

  it("scrolls the tree to the row it revealed", async () => {
    const w = await mountPane();
    (w.vm as unknown as { openFinder: () => void }).openFinder();
    await flushPromises();
    await w.find('[data-testid="file-finder-input"]').setValue("buried");
    await flushPromises();
    await w.find('[data-testid="file-finder-row"]').trigger("click");
    await flushPromises();
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
  });

  // The window-level "clicked somewhere else" listener would otherwise see the very button that
  // opened the panel, close it, and let the click reopen it — a flicker on every press.
  it("stays open when its own button is pressed again", async () => {
    const w = await mountPane();
    const button = w.find('[data-testid="files-find-btn"]');
    await button.trigger("click");
    await flushPromises();
    button.element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    await button.trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="file-finder"]').exists()).toBe(true);
  });

  // Anywhere else IS "not this after all".
  it("closes when something outside it is pressed", async () => {
    const w = await mountPane();
    await w.find('[data-testid="files-find-btn"]').trigger("click");
    await flushPromises();
    document.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    await flushPromises();
    expect(w.find('[data-testid="file-finder"]').exists()).toBe(false);
  });

  it("closes without opening anything on Escape", async () => {
    const w = await mountPane();
    await w.find('[data-testid="files-find-btn"]').trigger("click");
    await flushPromises();
    await w.find('[data-testid="file-finder"]').trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(w.find('[data-testid="file-finder"]').exists()).toBe(false);
    expect(textRequests).toEqual([]);
  });

  /** Open the finder, narrow to one row, and click it. */
  const pickThrough = async (w: Awaited<ReturnType<typeof mountPane>>, query: string) => {
    await w.find('[data-testid="files-find-btn"]').trigger("click");
    await flushPromises();
    await w.find('[data-testid="file-finder-input"]').setValue(query);
    await flushPromises();
    await w.find('[data-testid="file-finder-row"]').trigger("click");
  };

  // A reveal spends most of its time FETCHING — one request per ancestor directory — so a second
  // pick can overtake the first. `loadFile` takes the newest request id as it goes, so a stale
  // reveal landing second would replace the file the user actually chose with the one they
  // abandoned (CodeRabbit on #2102).
  it("lets the later pick win when an earlier reveal is still expanding directories", async () => {
    const w = await mountPane();
    let release = (): void => {};
    heldDeepListing = new Promise<void>((resolve) => (release = resolve));

    await pickThrough(w, "buried"); // deep: blocks on the src/deep listing
    await flushPromises();
    expect(textRequests).toEqual([]); // it has not reached the file yet

    await pickThrough(w, "readme"); // shallow: no ancestors, so it finishes first
    await flushPromises();
    expect(textRequests).toEqual(["README.md"]);

    release();
    await flushPromises();
    await flushPromises();
    // The abandoned reveal must not open its file over the one the user chose.
    expect(textRequests).toEqual(["README.md"]);
  });

  // The `files-find` shortcut mounts the pane and opens the finder over it in the same breath, so a
  // pick can land while `roots` is still empty. Revealing into an empty tree finds no ancestor to
  // expand — the file opens and the tree stays collapsed, which is exactly the half of #2099 the
  // issue asked for (Codex on #2102).
  it("waits for the tree before expanding, when the pick beats the root listing", async () => {
    let releaseRoot = (): void => {};
    heldRootListing = new Promise<void>((resolve) => (releaseRoot = resolve));

    const w = mount(FilesPane, { props: { cwd: "/proj" }, attachTo: document.body });
    await flushPromises();
    expect(w.findAll('[data-testid="files-row"]')).toHaveLength(0); // no tree yet

    (w.vm as unknown as { openFinder: () => void }).openFinder();
    await flushPromises();
    await w.find('[data-testid="file-finder-input"]').setValue("buried");
    await flushPromises();
    await w.find('[data-testid="file-finder-row"]').trigger("click");
    await flushPromises();

    releaseRoot();
    await flushPromises();
    await flushPromises();

    expect(textRequests).toEqual(["src/deep/buried.ts"]);
    expect(treeRows(w)).toEqual(["src", "src/deep", "src/deep/buried.ts", "README.md"]);
  });

  // teardown() has to invalidate the request GENERATIONS, not only the reveal's: a `loadFile`
  // already in flight would otherwise land after the re-root and adopt the old project's content,
  // because its own `id === fileReqId` check still passes (Codex on #2102).
  it("drops a file read that was in flight when the pane re-rooted", async () => {
    const w = await mountPane();
    let release = (): void => {};
    heldText = new Promise<void>((resolve) => (release = resolve));

    await pickThrough(w, "readme");
    await flushPromises();
    expect(textRequests).toEqual(["README.md"]); // asked for, not yet answered

    await (w.vm as unknown as { reload: () => Promise<void> }).reload();
    await flushPromises();
    release();
    await flushPromises();
    await flushPromises();

    // The pane is back on a fresh tree with nothing open — not showing the file it was reading
    // for the project it has left.
    expect(w.find('[data-testid="files-row"]').exists()).toBe(true);
    expect(w.text()).toContain("Select a file to view or edit.");
  });

  // A pane that re-roots teardown()s and starts again. A finder left open over it would be
  // showing the previous project's files.
  it("is closed by a reload onto another project", async () => {
    const w = await mountPane();
    await w.find('[data-testid="files-find-btn"]').trigger("click");
    await flushPromises();
    await (w.vm as unknown as { reload: () => Promise<void> }).reload();
    await flushPromises();
    expect(w.find('[data-testid="file-finder"]').exists()).toBe(false);
  });
});
