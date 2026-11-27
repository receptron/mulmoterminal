// The Library's pins and names under a kept screen: read again on each opening, and kept through a
// re-read that fails; the failure is said only when nothing was ever read.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import type { LibraryMarks } from "../../../common/library";

const api = vi.hoisted(() => ({ answer: null as LibraryMarks | null }));
vi.mock("../../../src/composables/libraryApi", () => ({
  loadLibraryMarks: async () => api.answer,
  loadLibraryConversation: async () => null,
  saveLibraryMark: async () => null,
}));

const { useLibraryMarks } = await import("../../../src/composables/useLibraryMarks");

beforeEach(() => {
  api.answer = null;
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
});
