// Editing a memory in place (#3331): ⌘Enter saves over the text it opened, a change made since is
// refused and said, Esc stops editing without closing the Library, and a running session is warned of.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { MemorySaveResult } from "../../../../src/composables/libraryApi";

let result: MemorySaveResult = { kind: "saved", version: "v2" };
const saves: [string, string, string, string][] = [];
vi.mock("../../../../src/composables/libraryApi", () => ({
  saveLibraryMemoryFile: (slug: string, file: string, text: string, version: string) => (saves.push([slug, file, text, version]), Promise.resolve(result)),
}));
let running = false;
vi.mock("../../../../src/composables/useDirLists", () => ({
  readResumableList: () => Promise.resolve({ sessions: [{ id: "s", title: "", mtime: 0, runningKey: running ? "s" : null }], cwd: "/w/app" }),
}));

const LibraryMemoryEditor = (await import("../../../../src/components/library/LibraryMemoryEditor.vue")).default;

beforeEach(() => {
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
});
