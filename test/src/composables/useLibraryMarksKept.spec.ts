// The Library's pins and names under a kept screen: read again on each opening, and kept through a
// re-read that fails; the failure is said only when nothing was ever read.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import type { LibraryMarks } from "../../../common/library";

const api = vi.hoisted(() => ({ answer: null as LibraryMarks | null, conversationReads: 0, saving: Promise.resolve<LibraryMarks | null>(null) }));
vi.mock("../../../src/composables/libraryApi", () => ({
  loadLibraryMarks: async () => api.answer,
  loadLibraryConversation: async () => (api.conversationReads++, null),
  saveLibraryMark: () => api.saving,
}));

const { useLibraryMarks } = await import("../../../src/composables/useLibraryMarks");

beforeEach(() => {
  api.answer = null;
  api.conversationReads = 0;
});

const reopen = async (isOpen: { value: boolean }) => {
  isOpen.value = false;
  await flushPromises();
  isOpen.value = true;
  await flushPromises();
};

describe("useLibraryMarks on a kept screen", () => {
  it("keeps the names when the next opening's read fails", async () => {
    api.answer = { pinned: [], names: { a: "Named here" } };
    const isOpen = ref(true);
    const kept = useLibraryMarks(isOpen);
    await flushPromises();
    api.answer = null;
    await reopen(isOpen);
    expect([kept.loadFailed.value, kept.marks.value.names]).toEqual([false, { a: "Named here" }]);
  });

  it("says it failed when nothing was ever read", async () => {
    const isOpen = ref(true);
    const kept = useLibraryMarks(isOpen);
    await flushPromises();
    expect([kept.loadFailed.value, kept.marks.value.names]).toEqual([true, {}]);
  });

  it("keeps what a save answered when the next opening's read fails, though the first read failed", async () => {
    const isOpen = ref(true);
    const kept = useLibraryMarks(isOpen);
    await flushPromises(); // the first read fails
    api.saving = Promise.resolve({ pinned: [], names: { a: "Named here" } });
    await kept.change("a", { name: "Named here" });
    expect(kept.loadFailed.value).toBe(false);
    await reopen(isOpen); // and the read on opening fails too
    expect([kept.loadFailed.value, kept.marks.value.names]).toEqual([false, { a: "Named here" }]);
  });

  // Closing outdates a save still out (the open/close watcher), so its follow-up never runs hidden.
  it("reads no pinned conversation for a pin that answers after the Library closed", async () => {
    api.answer = { pinned: [], names: {} };
    const isOpen = ref(true);
    const kept = useLibraryMarks(isOpen);
    await flushPromises();
    let answerSave: (value: LibraryMarks | null) => void = () => {};
    api.saving = new Promise((resolve) => (answerSave = resolve));
    const saving = kept.change("a", { pinned: true });
    isOpen.value = false;
    await flushPromises();
    api.conversationReads = 0;
    answerSave({ pinned: ["a"], names: {} });
    await saving;
    expect(api.conversationReads).toBe(0);
  });
});
