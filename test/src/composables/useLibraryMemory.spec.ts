// The Library's memory list (#3331): read on each open, and never the last open's list meanwhile.
import { describe, it, expect, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import type { LibraryMemoryProject } from "../../../common/libraryMemory";

let answer: LibraryMemoryProject[] | null = [];
let gate: Promise<void> = Promise.resolve();
vi.mock("../../../src/composables/libraryApi", () => ({
  loadLibraryMemory: async () => {
    const reply = answer;
    await gate;
    return reply;
  },
}));

const { useLibraryMemory } = await import("../../../src/composables/useLibraryMemory");

const project = (slug: string): LibraryMemoryProject => ({ slug, cwd: null, index: null, files: [] });

describe("useLibraryMemory", () => {
  it("shows nothing of the last open while the next one is read, and a failure as one", async () => {
    answer = [project("before")];
    const isOpen = ref(true);
    const memory = useLibraryMemory(isOpen);
    await flushPromises();
    expect(memory.projects.value.map((p) => p.slug)).toEqual(["before"]);
    isOpen.value = false;
    await flushPromises();
    let release: () => void = () => {};
    gate = new Promise((resolve) => (release = resolve));
    answer = null;
    isOpen.value = true;
    await flushPromises();
    expect(memory.loaded.value).toBe(false);
    expect(memory.projects.value).toEqual([]);
    release();
    await flushPromises();
    expect([memory.loaded.value, memory.failed.value, memory.projects.value]).toEqual([true, true, []]);
  });
});
