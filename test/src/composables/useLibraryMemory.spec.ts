// The Library's memory list (#3331): read on each open, and never the last open's list meanwhile.
import { describe, it, expect, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import type { LibraryMemoryHealth, LibraryMemoryProject } from "../../../common/libraryMemory";

let answer: LibraryMemoryProject[] | null = [];
let gate: Promise<void> = Promise.resolve();
let healthAnswer: LibraryMemoryHealth[] | null = [];
let healthGate: Promise<void> = Promise.resolve();
vi.mock("../../../src/composables/libraryApi", () => ({
  loadLibraryMemoryHealth: async () => {
    const reply = healthAnswer;
    await healthGate;
    return reply;
  },
  loadLibraryMemory: async () => {
    const reply = answer;
    await gate;
    return reply;
  },
}));

const { useLibraryMemory } = await import("../../../src/composables/useLibraryMemory");

const project = (slug: string): LibraryMemoryProject => ({ slug, cwd: null, index: null, files: [] });

describe("useLibraryMemory", () => {
  // The screen is kept while closed: the last list stays until the next read replaces it.
  it("keeps the last open's list while the next one is read, and shows a failure once it answers", async () => {
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
    expect([memory.loaded.value, memory.failed.value, memory.projects.value.map((p) => p.slug)]).toEqual([true, false, ["before"]]);
    release();
    await flushPromises();
    expect([memory.loaded.value, memory.failed.value, memory.projects.value]).toEqual([true, true, []]);
  });

  it("drops a health answer that arrives after the Library was opened again", async () => {
    answer = [project("p")];
    gate = Promise.resolve();
    let releaseOld: () => void = () => {};
    healthGate = new Promise((resolve) => (releaseOld = resolve));
    healthAnswer = [{ slug: "p", issues: [{ kind: "no-index" }], files: {} }];
    const isOpen = ref(true);
    const memory = useLibraryMemory(isOpen);
    await flushPromises();
    isOpen.value = false;
    await flushPromises();
    healthGate = Promise.resolve();
    healthAnswer = [];
    isOpen.value = true;
    await flushPromises();
    releaseOld(); // the first open's answer, late
    await flushPromises();
    expect(memory.health.value.size).toBe(0);
  });

  it("tells a failed health check apart from nothing to tidy", async () => {
    answer = [project("p")];
    healthGate = Promise.resolve();
    healthAnswer = null;
    const memory = useLibraryMemory(ref(true));
    await flushPromises();
    expect([memory.healthFailed.value, memory.health.value.size]).toEqual([true, 0]);
  });
});
