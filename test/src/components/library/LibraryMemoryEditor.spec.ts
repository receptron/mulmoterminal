// Editing a memory in place (#3331): ⌘Enter saves over the text it opened, a change made since is
// refused and said, Esc stops editing without closing the Library, and a running session is warned of.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { MemorySaveResult } from "../../../../src/composables/libraryApi";

let result: MemorySaveResult = { kind: "saved", version: "v2" };
const saves: [string, string, string, string][] = [];
vi.mock("../../../../src/composables/libraryApi", () => ({
  saveLibraryMemoryFile: (slug: string, file: string, text: string, version: string) => (saves.push([slug, file, text, version]), Promise.resolve(result)),
  loadLibraryMemoryLinks: () => Promise.resolve(null),
}));
let running = false;
vi.mock("../../../../src/composables/useDirLists", () => ({
  readResumableList: () => Promise.resolve({ sessions: [{ id: "s", title: "", mtime: 0, runningKey: running ? "s" : null }], cwd: "/w/app" }),
}));

const LibraryMemoryEditor = (await import("../../../../src/components/library/LibraryMemoryEditor.vue")).default;
const { dropMemoryDraft } = await import("../../../../src/components/library/memoryDrafts");
const { resetImeComposition } = await import("../../../../src/composables/imeComposition");

beforeEach(() => {
  dropMemoryDraft("-w-app/a.md"); // drafts outlive an editor, by design: not a test
  result = { kind: "saved", version: "v2" };
  saves.length = 0;
  running = false;
});

const mountEditor = async () => {
  const wrapper = mount(LibraryMemoryEditor, {
    props: { slug: "-w-app", file: "a.md", text: "---\nname: a\nodd: kept\n---\nbody", version: "v1", cwd: "/w/app" },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};
const press = async (wrapper: Awaited<ReturnType<typeof mountEditor>>, key: string, meta = false) => {
  await wrapper.find("[data-testid=memory-editor-field]").trigger("keydown", { key, metaKey: meta });
  await flushPromises();
};

describe("LibraryMemoryEditor", () => {
  it("seeds a merge with both texts joined by a blank line, keeping a hard break's spaces and an indented opening", async () => {
    const wrapper = mount(LibraryMemoryEditor, {
      props: {
        slug: "-w-app",
        file: "a.md",
        text: "kept line  \r\n\r\n",
        version: "v1",
        cwd: null,
        merging: { file: "b.md", version: "v2", title: "b", body: "\n    code\nmore" },
      },
    });
    await flushPromises();
    expect(wrapper.find<HTMLTextAreaElement>("[data-testid=memory-editor-field]").element.value).toBe("kept line  \n\n    code\nmore\n");
  });

  it("keeps every character of a memory holding an emoji when seeding a merge", async () => {
    const wrapper = mount(LibraryMemoryEditor, {
      props: {
        slug: "-w-app",
        file: "a.md",
        text: "note \u{1F642} kept text\n\n",
        version: "v1",
        cwd: null,
        merging: { file: "b.md", version: "v2", title: "b", body: "added" },
      },
    });
    await flushPromises();
    expect(wrapper.find<HTMLTextAreaElement>("[data-testid=memory-editor-field]").element.value).toBe("note \u{1F642} kept text\n\nadded\n");
  });

  it("seeds a merge onto a memory ending in a great many line breaks", async () => {
    const wrapper = mount(LibraryMemoryEditor, {
      props: {
        slug: "-w-app",
        file: "a.md",
        text: `kept${"\n".repeat(30_000)}`,
        version: "v1",
        cwd: null,
        merging: { file: "b.md", version: "v2", title: "b", body: "added" },
      },
    });
    await flushPromises();
    expect(wrapper.find<HTMLTextAreaElement>("[data-testid=memory-editor-field]").element.value).toBe("kept\n\nadded\n");
  });

  it("saves the whole text, unknown frontmatter and all, over the version it opened, on ⌘Enter", async () => {
    const wrapper = await mountEditor();
    await wrapper.find("[data-testid=memory-editor-field]").setValue("---\nname: a\nodd: kept\n---\nnew body");
    await press(wrapper, "Enter", true);
    expect(saves).toEqual([["-w-app", "a.md", "---\nname: a\nodd: kept\n---\nnew body", "v1"]]);
    expect(wrapper.emitted("saved")).toEqual([["---\nname: a\nodd: kept\n---\nnew body", "v2"]]);
  });

  it("does not save on a plain Enter", async () => {
    const wrapper = await mountEditor();
    await press(wrapper, "Enter");
    expect(saves).toEqual([]);
  });

  it("says a change made on disk was not saved over, and offers to read it again", async () => {
    result = { kind: "changed" };
    const wrapper = await mountEditor();
    await wrapper.find("[data-testid=memory-editor-save]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-editor-notice]").text()).toContain("changed on disk");
    expect(wrapper.emitted("saved")).toBeUndefined();
    await wrapper.find("[data-testid=memory-editor-notice] button").trigger("click");
    expect(wrapper.emitted("reload")).toHaveLength(1);
  });

  it("refuses a text past the cap without sending it", async () => {
    const wrapper = await mountEditor();
    await wrapper.find("[data-testid=memory-editor-field]").setValue("x".repeat(256 * 1024 + 1));
    await wrapper.find("[data-testid=memory-editor-save]").trigger("click");
    expect(saves).toEqual([]);
    expect(wrapper.find("[data-testid=memory-editor-notice]").text()).toBe("Too large to save here.");
  });

  it("stops editing on Esc without letting the Library see it", async () => {
    const wrapper = await mountEditor();
    const library = vi.fn();
    window.addEventListener("keydown", library);
    await press(wrapper, "Escape");
    window.removeEventListener("keydown", library);
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(library).not.toHaveBeenCalled();
  });

  it("warns when a session is running in the project, and not otherwise", async () => {
    expect((await mountEditor()).find("[data-testid=memory-editor-running]").exists()).toBe(false);
    running = true;
    expect((await mountEditor()).find("[data-testid=memory-editor-running]").exists()).toBe(true);
  });

  it("saves a file written with CRLF with CRLF again, so saving it unchanged changes nothing", async () => {
    const wrapper = mount(LibraryMemoryEditor, {
      props: { slug: "-w-app", file: "a.md", text: "---\r\nname: a\r\n---\r\nbody\r\n", version: "v1", cwd: null },
    });
    await flushPromises();
    expect((wrapper.vm as unknown as { dirty: boolean }).dirty).toBe(false);
    await wrapper.find("[data-testid=memory-editor-save]").trigger("click");
    await flushPromises();
    expect(saves[0]?.[2]).toBe("---\r\nname: a\r\n---\r\nbody\r\n");
  });

  it("keeps an unsaved draft when the editor goes away, offers it back on the same version only, and drops it on cancel", async () => {
    const first = await mountEditor();
    await first.find("[data-testid=memory-editor-field]").setValue("half-written");
    first.unmount(); // the Library closed, or the kind switched
    const again = await mountEditor();
    expect((again.find("[data-testid=memory-editor-field]").element as HTMLTextAreaElement).value).toBe("half-written");
    expect(again.find("[data-testid=memory-editor-notice]").text()).toContain("unsaved edit was kept");
    again.unmount();
    const changed = mount(LibraryMemoryEditor, { props: { slug: "-w-app", file: "a.md", text: "newer on disk", version: "v9", cwd: null } });
    expect((changed.find("[data-testid=memory-editor-field]").element as HTMLTextAreaElement).value).toBe("newer on disk");
    changed.unmount();
    const last = await mountEditor();
    await last.find("[data-testid=memory-editor-cancel]").trigger("click");
    last.unmount();
    expect(((await mountEditor()).find("[data-testid=memory-editor-field]").element as HTMLTextAreaElement).value).not.toBe("half-written");
  });

  it("leaves Esc and ⌘Enter to an IME composition, Safari's late compositionend included", async () => {
    const wrapper = await mountEditor();
    const field = wrapper.find("[data-testid=memory-editor-field]");
    const library = vi.fn();
    window.addEventListener("keydown", library);
    await field.trigger("keydown", { key: "Escape", isComposing: true });
    window.removeEventListener("keydown", library);
    expect(library).not.toHaveBeenCalled(); // nor does that Esc reach the Library
    // Safari: compositionend first, then the confirming keydown with isComposing already false.
    window.dispatchEvent(new CompositionEvent("compositionstart"));
    window.dispatchEvent(new CompositionEvent("compositionend"));
    await field.trigger("keydown", { key: "Enter", metaKey: true, keyCode: 229 });
    await field.trigger("keydown", { key: "Escape", keyCode: 229 });
    expect(wrapper.emitted("cancel")).toBeUndefined();
    expect(saves).toEqual([]);
    resetImeComposition();
  });

  it("saves an untouched file with mixed line endings exactly as it was", async () => {
    const mixed = "---\r\nname: a\n---\rbody\n"; // CRLF, LF and a lone CR
    const wrapper = mount(LibraryMemoryEditor, { props: { slug: "-w-app", file: "mixed.md", text: mixed, version: "v1", cwd: null } });
    await flushPromises();
    expect((wrapper.vm as unknown as { dirty: boolean }).dirty).toBe(false);
    await wrapper.find("[data-testid=memory-editor-save]").trigger("click");
    await flushPromises();
    expect(saves[0]?.[2]).toBe(mixed);
  });

  it("holds the text still while a save is on its way", async () => {
    let finish: (value: MemorySaveResult) => void = () => {};
    result = { kind: "saved", version: "v2" };
    const wrapper = await mountEditor();
    const api = await import("../../../../src/composables/libraryApi");
    const slow = vi.spyOn(api, "saveLibraryMemoryFile").mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await wrapper.find("[data-testid=memory-editor-save]").trigger("click");
    expect(wrapper.find("[data-testid=memory-editor-field]").attributes("readonly")).toBeDefined();
    finish({ kind: "saved", version: "v2" });
    await flushPromises();
    slow.mockRestore();
  });

  it("ends the edit on Esc from a button too, without letting the Library see it", async () => {
    const wrapper = await mountEditor();
    const library = vi.fn();
    window.addEventListener("keydown", library);
    await wrapper.find("[data-testid=memory-editor-save]").trigger("keydown", { key: "Escape" });
    window.removeEventListener("keydown", library);
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(library).not.toHaveBeenCalled();
  });

  it("cannot be cancelled while a save is on its way", async () => {
    let finish: (value: MemorySaveResult) => void = () => {};
    const wrapper = await mountEditor();
    const api = await import("../../../../src/composables/libraryApi");
    const slow = vi.spyOn(api, "saveLibraryMemoryFile").mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await wrapper.find("[data-testid=memory-editor-save]").trigger("click");
    expect(wrapper.find("[data-testid=memory-editor-cancel]").attributes("disabled")).toBeDefined();
    await wrapper.find("[data-testid=memory-editor-field]").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("cancel")).toBeUndefined();
    finish({ kind: "saved", version: "v2" });
    await flushPromises();
    expect(wrapper.emitted("saved")).toHaveLength(1);
    slow.mockRestore();
  });

  it("gives the draft up when told to read the file again after a conflict", async () => {
    result = { kind: "changed" };
    const wrapper = await mountEditor();
    await wrapper.find("[data-testid=memory-editor-field]").setValue("a draft given up");
    await wrapper.find("[data-testid=memory-editor-save]").trigger("click");
    await flushPromises();
    await wrapper.find("[data-testid=memory-editor-notice] button").trigger("click");
    wrapper.unmount();
    expect(((await mountEditor()).find("[data-testid=memory-editor-field]").element as HTMLTextAreaElement).value).not.toBe("a draft given up");
  });

  it("offers a draft begun on an older version rather than applying or losing it", async () => {
    const first = await mountEditor();
    await first.find("[data-testid=memory-editor-field]").setValue("written against v1");
    first.unmount();
    const changed = mount(LibraryMemoryEditor, { props: { slug: "-w-app", file: "a.md", text: "the agent's newer text", version: "v9", cwd: null } });
    await flushPromises();
    const field = () => changed.find("[data-testid=memory-editor-field]").element as HTMLTextAreaElement;
    expect(field().value).toBe("the agent's newer text");
    expect(changed.find("[data-testid=memory-editor-stale]").exists()).toBe(true);
    await changed.find("[data-testid=memory-editor-cancel]").trigger("click"); // not taken up: still kept
    changed.unmount();
    const again = mount(LibraryMemoryEditor, { props: { slug: "-w-app", file: "a.md", text: "the agent's newer text", version: "v9", cwd: null } });
    await flushPromises();
    await again.find("[data-testid=memory-editor-use-stale]").trigger("click");
    expect((again.find("[data-testid=memory-editor-field]").element as HTMLTextAreaElement).value).toBe("written against v1");
  });
});
