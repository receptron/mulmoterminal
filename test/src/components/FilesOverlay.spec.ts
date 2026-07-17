import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesOverlay from "../../src/components/FilesOverlay.vue.js";

// The view is route-driven; stub useFilesView so the overlay is "open" without a router.
// A shared cwd ref lets a test drive a route-root change; filesGotoIndex mutates it too
// (the component uses it to revert a declined root switch).
const hoisted = vi.hoisted(() => ({
  setCwd: (() => {}) as (v: string | null) => void,
  setOpen: (() => {}) as (v: boolean) => void,
}));
vi.mock("../composables/useFilesView", async () => {
  const { ref: r } = await import("vue");
  const cwd = r<string | null>("/proj");
  const isOpen = r(true);
  hoisted.setCwd = (v) => (cwd.value = v);
  hoisted.setOpen = (v) => (isOpen.value = v);
  return {
    useFilesView: () => ({ isOpen, cwd, close: () => (isOpen.value = false) }),
    // Revert re-opens /files at the restored root (isOpen back to true).
    filesGotoIndex: (v: string | null) => ((cwd.value = v), (isOpen.value = true)),
  };
});

// Don't instantiate real CodeMirror (needs a full DOM); capture the change callback so
// we can simulate a user edit, and record setDoc/getDoc.
let onChange: () => void = () => {};
const fakeEditor = { setDoc: vi.fn(), getDoc: vi.fn(() => "edited text"), destroy: vi.fn() };
vi.mock("./cmEditor", async (orig) => {
  const actual = await orig<typeof import("./cmEditor")>();
  return { ...actual, createEditor: (_host: HTMLElement, cb: () => void) => ((onChange = cb), fakeEditor) };
});

function mockFs() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/list")) {
      const p = new URL(url, "https://x").searchParams.get("path");
      const entries =
        p === ""
          ? [
              { name: "src", dir: true, size: 0 },
              { name: "README.md", dir: false, size: 10 },
              { name: "notes.txt", dir: false, size: 4 },
            ]
          : [{ name: "app.ts", dir: false, size: 5 }];
      return { ok: true, json: async () => ({ entries }) };
    }
    if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello" }) };
    if (url.includes("/write")) return { ok: true, json: async () => ({ ok: true }), _init: init };
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

function must<T>(v: T | undefined, msg: string): T {
  if (v === undefined) throw new Error(msg);
  return v;
}

// The mocked cwd ref and fakeEditor are module singletons, so an un-unmounted overlay
// from a prior test would also react to a later test's cwd change. Track and unmount.
const wrappers: ReturnType<typeof mount>[] = [];
const mountOverlay = () => {
  const w = mount(FilesOverlay);
  wrappers.push(w);
  return w;
};

describe("FilesOverlay", () => {
  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    hoisted.setCwd("/proj");
    hoisted.setOpen(true);
    mockFs();
  });
  afterEach(() => wrappers.splice(0).forEach((w) => w.unmount()));

  it("loads the root tree, opens a file, edits, and saves", async () => {
    const w = mountOverlay();
    await flushPromises();
    // Root entries rendered (directories first).
    expect(w.text()).toContain("src");
    expect(w.text()).toContain("README.md");

    // Open the markdown file → text fetched and pushed into the editor.
    const readmeRow = must(
      w.findAll("button.files-row").find((b) => b.text().includes("README.md")),
      "README row",
    );
    await readmeRow.trigger("click");
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "README.md");
    expect(w.text()).toContain("Preview"); // md preview toggle offered

    // No unsaved edits yet → Save disabled. Simulate an edit → Save enables.
    const saveBtn = () =>
      must(
        w.findAll("button").find((b) => b.text().startsWith("Save")),
        "save btn",
      );
    expect(saveBtn().attributes("disabled")).toBeDefined();
    onChange();
    await flushPromises();
    expect(saveBtn().attributes("disabled")).toBeUndefined();

    await saveBtn().trigger("click");
    await flushPromises();
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const putCall = must(
      calls.find((c) => String(c[0]).includes("/write")),
      "write call",
    );
    expect(putCall[1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(putCall[1].body)).toEqual({ text: "edited text" });
  });

  it("guards against discarding unsaved edits when switching files", async () => {
    const w = mountOverlay();
    await flushPromises();
    const open = (name: string) =>
      must(
        w.findAll("button.files-row").find((b) => b.text().includes(name)),
        name,
      ).trigger("click");
    await open("README.md");
    await flushPromises();
    onChange(); // mark dirty
    await flushPromises();

    // Declining the confirm aborts the switch — the new file is not loaded.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fakeEditor.setDoc.mockClear();
    await open("notes.txt");
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalled();
    expect(fakeEditor.setDoc).not.toHaveBeenCalled(); // buffer kept

    // Accepting the confirm proceeds with the switch.
    confirmSpy.mockReturnValue(true);
    await open("notes.txt");
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "notes.txt");
    confirmSpy.mockRestore();
  });

  it("guards a route root (cwd) change with a dirty buffer", async () => {
    const w = mountOverlay();
    await flushPromises();
    await must(
      w.findAll("button.files-row").find((b) => b.text().includes("README.md")),
      "readme",
    ).trigger("click");
    await flushPromises();
    onChange(); // mark dirty
    await flushPromises();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fakeEditor.destroy.mockClear();
    hoisted.setCwd("/other-project"); // simulate the Files route changing roots
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalled();
    expect(fakeEditor.destroy).not.toHaveBeenCalled(); // declined → no teardown, buffer kept
    expect(w.text()).toContain("README.md"); // still showing the old root's tree
    confirmSpy.mockRestore();
  });

  it("guards an external close (isOpen=false) with a dirty buffer", async () => {
    const w = mountOverlay();
    await flushPromises();
    await must(
      w.findAll("button.files-row").find((b) => b.text().includes("README.md")),
      "readme",
    ).trigger("click");
    await flushPromises();
    onChange(); // mark dirty
    await flushPromises();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fakeEditor.destroy.mockClear();
    hoisted.setOpen(false); // external navigation (Back / another view) closes the overlay
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalled();
    expect(fakeEditor.destroy).not.toHaveBeenCalled(); // declined → reverted, buffer kept
    expect(w.text()).toContain("README.md"); // overlay still open
    confirmSpy.mockRestore();
  });

  it("lazy-loads a directory's children on expand", async () => {
    const w = mountOverlay();
    await flushPromises();
    const srcRow = must(
      w.findAll("button.files-row").find((b) => b.text().includes("src")),
      "src row",
    );
    await srcRow.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("app.ts"); // child loaded
  });

  it("surfaces a tree load error", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const w = mountOverlay();
    await flushPromises();
    expect(w.text()).toContain("HTTP 500");
  });
});
