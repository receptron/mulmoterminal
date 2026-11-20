// The work copies in the reader (#3331): a copy read after the reader moved on (this component is keyed
// by the memory, so it is unmounted) is not added anywhere — Vue drops an emit from an unmounted one.
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

let release = (): void => undefined;
vi.mock("../../../../src/composables/libraryApi", () => ({
  loadLibraryMemoryFile: () => new Promise((resolve) => (release = () => resolve({ text: "---\nname: a\n---\ntheirs", version: "v" }))),
  saveLibraryMemoryFile: () => Promise.resolve({ kind: "saved", version: "v2" }),
}));
vi.mock("../../../../src/components/library/memorySessions", () => ({ sessionRunningIn: () => Promise.resolve(false) }));

const LibraryMemoryWorkCopies = (await import("../../../../src/components/library/LibraryMemoryWorkCopies.vue")).default;
const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false });
const props = { copies: [{ slug: "-w-app3", file: "a.md", name: "app3", cwd: null, same: false }], text: "mine" };

describe("LibraryMemoryWorkCopies", () => {
  it("adds a copy's body read in time, and nothing once the reader moved to another memory", async () => {
    const shown = mount(LibraryMemoryWorkCopies, { props, global: { plugins: [i18n] } });
    await shown.find("[data-testid=memory-copy-add]").trigger("click");
    release();
    await flushPromises();
    expect(shown.emitted("add")).toEqual([["app3", "theirs"]]);
    const left = mount(LibraryMemoryWorkCopies, { props, global: { plugins: [i18n] } });
    await left.find("[data-testid=memory-copy-add]").trigger("click");
    const emitted = left.emitted();
    left.unmount();
    release();
    await flushPromises();
    expect(emitted.add).toBeUndefined();
  });
});
