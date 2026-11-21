// The Storage view's reads (#3333): nothing until it is shown; a stale or missing measurement asked for
// again; read every poll while one runs, and no more once it is hidden.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import type { LibraryStorageAnswer } from "../../../common/libraryStorage";

const reads: string[] = [];
let measures = 0;
let measureAccepted = true;
let answers: Array<LibraryStorageAnswer | null> = [];
let loadOverride: (() => Promise<LibraryStorageAnswer | null>) | null = null;
vi.mock("../../../src/composables/libraryApi", () => ({
  loadLibraryStorage: (query: string) => {
    reads.push(query);
    if (loadOverride !== null) return loadOverride();
    return Promise.resolve(answers.length > 1 ? answers.shift() : answers[0]);
  },
  measureLibraryStorage: () => {
    measures += 1;
    return Promise.resolve(measureAccepted);
  },
}));
const { useLibraryStorage, STORAGE_POLL_MS, STORAGE_STALE_MS } = await import("../../../src/composables/useLibraryStorage");

const answer = (measuredAt: number | null, measuring: LibraryStorageAnswer["measuring"] = null): LibraryStorageAnswer => ({
  root: "/h",
  measuring,
  measureFailed: false,
  cleanup: { state: "default", days: 30 },
  measure:
    measuredAt === null
      ? null
      : { measuredAt, total: { bytes: 0, files: 0, unreadable: 0 }, entries: [], projects: [], otherProjects: { bytes: 0, files: 0, unreadable: 0, count: 0 } },
});

beforeEach(() => {
  vi.useFakeTimers();
  reads.length = 0;
  measures = 0;
  loadOverride = null;
  measureAccepted = true;
});
afterEach(() => vi.useRealTimers());

function start(shownAtFirst: boolean) {
  const shown = ref(shownAtFirst);
  const query = ref("");
  const scope = effectScope();
  const storage = scope.run(() => useLibraryStorage(shown, query));
  if (storage === undefined) throw new Error("no scope");
  return { shown, query, storage, scope };
}

describe("useLibraryStorage", () => {
  it("reads nothing while hidden, and a fresh measurement once shown without measuring again", async () => {
    answers = [answer(Date.now())];
    const { shown, storage } = start(false);
    await flushPromises();
    expect(reads).toEqual([]);
    shown.value = true;
    await flushPromises();
    expect(reads).toEqual([""]);
    expect(measures).toBe(0);
    expect(storage.loaded.value).toBe(true);
  });

  it("asks for a measurement when there is none, or the last is stale", async () => {
    answers = [answer(null), answer(null, { done: 0, of: 0 })];
    start(true);
    await flushPromises();
    expect(measures).toBe(1);
    answers = [answer(Date.now() - STORAGE_STALE_MS - 1)];
    start(true);
    await flushPromises();
    expect(measures).toBe(2);
  });

  it("does not ask for a measurement when hidden while a read was out", async () => {
    // A stale measurement from an earlier showing is still held when the view is shown again.
    answers = [answer(Date.now() - STORAGE_STALE_MS - 1)];
    const { shown } = start(true);
    await flushPromises();
    const before = measures;
    shown.value = false;
    await nextTick();
    let answerRead: (value: LibraryStorageAnswer) => void = () => {};
    loadOverride = () => new Promise((resolve) => (answerRead = resolve));
    shown.value = true;
    await nextTick();
    shown.value = false;
    await nextTick();
    answerRead(answer(Date.now() - STORAGE_STALE_MS - 1));
    await flushPromises();
    expect(measures).toBe(before);
  });

  it("reads again every poll while a measurement runs, and stops when hidden", async () => {
    answers = [answer(Date.now(), { done: 1, of: 3 })];
    const { shown } = start(true);
    await flushPromises();
    const before = reads.length;
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS);
    expect(reads).toHaveLength(before + 1);
    shown.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS * 3);
    expect(reads).toHaveLength(before + 1);
  });

  it("keeps reading while a measurement runs even when one read fails", async () => {
    answers = [answer(Date.now(), { done: 1, of: 3 })];
    start(true);
    await flushPromises();
    const before = reads.length;
    answers = [null];
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS);
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS);
    expect(reads).toHaveLength(before + 2);
  });

  it("says when asking for a measurement was refused, and clears it when one is accepted", async () => {
    answers = [answer(Date.now())];
    const { storage } = start(true);
    await flushPromises();
    measureAccepted = false;
    await storage.remeasure();
    expect(storage.startRefused.value).toBe(true);
    measureAccepted = true;
    await storage.remeasure();
    expect(storage.startRefused.value).toBe(false);
  });

  it("does nothing more for an owner that has gone: no measurement asked for, no timer left", async () => {
    let answerRead: (value: LibraryStorageAnswer) => void = () => {};
    answers = [];
    loadOverride = () => new Promise((resolve) => (answerRead = resolve));
    const { scope } = start(true);
    scope.stop();
    answerRead(answer(null, null));
    await flushPromises();
    expect(measures).toBe(0);
    loadOverride = null;
    answers = [answer(Date.now(), { done: 1, of: 2 })];
    const running = start(true);
    await flushPromises();
    const before = reads.length;
    running.scope.stop();
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS * 3);
    expect(reads).toHaveLength(before);
  });

  it("starts no timer from a read that answers after its owner has gone", async () => {
    let answerRead: (value: LibraryStorageAnswer) => void = () => {};
    answers = [];
    loadOverride = () => new Promise((resolve) => (answerRead = resolve));
    const { scope } = start(true);
    await nextTick();
    scope.stop();
    loadOverride = null;
    answers = [answer(Date.now(), { done: 1, of: 2 })];
    answerRead(answer(Date.now(), { done: 1, of: 2 }));
    await flushPromises();
    const before = reads.length;
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS * 3);
    expect(reads).toHaveLength(before);
  });

  it("asks for no measurement for an owner that went while it re-read a stale answer", async () => {
    answers = [answer(Date.now() - STORAGE_STALE_MS - 1)];
    const { shown, scope } = start(true);
    await flushPromises();
    const before = measures;
    shown.value = false;
    await nextTick();
    let answerRead: (value: LibraryStorageAnswer) => void = () => {};
    loadOverride = () => new Promise((resolve) => (answerRead = resolve));
    shown.value = true;
    await nextTick();
    scope.stop();
    answerRead(answer(Date.now() - STORAGE_STALE_MS - 1));
    await flushPromises();
    expect(measures).toBe(before);
  });

  it("reads again for a new query, once it settles", async () => {
    answers = [answer(Date.now())];
    const { query } = start(true);
    await flushPromises();
    query.value = "a";
    query.value = "ap";
    await vi.advanceTimersByTimeAsync(1000);
    expect(reads).toEqual(["", "ap"]);
  });
});
