// The Library's Storage view (#3333): entries largest first, a project list under `projects/`, the
// one sentence on cleanupPeriodDays in each of its states, and the arrow keys walking the entries.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import type { CleanupPeriod, LibraryStorageAnswer } from "../../../../common/libraryStorage";
import { isLibraryStorageAnswer } from "../../../../common/libraryStorage";

const LibraryStorage = (await import("../../../../src/components/library/LibraryStorage.vue")).default;

const NOW = Date.now();
const size = (bytes: number, files = 1) => ({ bytes, files, unreadable: 0 });
const answerWith = (over: Partial<LibraryStorageAnswer> = {}, cleanup: CleanupPeriod = { state: "default", days: 30 }): LibraryStorageAnswer => ({
  root: "/home/me/.claude",
  measuring: null,
  measureFailed: false,
  cleanup,
  measure: {
    measuredAt: NOW,
    total: size(3 * 1024 ** 3, 12),
    entries: [
      { name: "projects", directory: true, ...size(2 * 1024 ** 3, 10) },
      { name: "debug", directory: true, ...size(1024 ** 3, 1) },
      { name: "history.jsonl", directory: false, ...size(1024, 1) },
    ],
    projects: [
      { slug: "-tmp-probe", cwd: null, temporary: true, ...size(1024 ** 3) },
      { slug: "-work-app", cwd: "/work/app", temporary: false, ...size(1024 ** 2) },
    ],
    otherProjects: { ...size(2048, 2), count: 2 },
  },
  ...over,
});

const mountWith = (answer: LibraryStorageAnswer | null, extra: { loaded?: boolean; failed?: boolean } = {}) =>
  mount(LibraryStorage, { props: { answer, loaded: extra.loaded ?? true, failed: extra.failed ?? false, now: NOW } });

describe("LibraryStorage", () => {
  it("lists the entries with the total, and opens on the first", () => {
    const wrapper = mountWith(answerWith());
    expect(wrapper.findAll('[data-testid="storage-row"]').map((row) => row.text())).toEqual(["projects/2.0 GB", "debug/1.0 GB", "history.jsonl1.0 KB"]);
    expect(wrapper.get('[data-testid="storage-total"]').text()).toContain("3.0 GB");
    expect(wrapper.get('[data-testid="storage-reader"] h2').text()).toBe("projects/");
  });

  it("lists the projects under projects/, marking the temp ones and summing the rest", () => {
    const wrapper = mountWith(answerWith());
    const rows = wrapper.findAll('[data-testid="storage-project"]');
    expect(rows.map((row) => row.text())).toEqual([expect.stringContaining("-tmp-probe"), expect.stringContaining("/work/app")]);
    expect(rows[0].find('[data-testid="storage-project-temporary"]').exists()).toBe(true);
    expect(rows[1].find('[data-testid="storage-project-temporary"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="storage-other-projects"]').text()).toContain("2");
  });

  it("shows no project list for another entry", async () => {
    const wrapper = mountWith(answerWith());
    await wrapper.findAll('[data-testid="storage-row"]')[1].trigger("click");
    expect(wrapper.get('[data-testid="storage-reader"] h2').text()).toBe("debug/");
    expect(wrapper.find('[data-testid="storage-projects"]').exists()).toBe(false);
  });

  it("says what cleanupPeriodDays is in each of its states", () => {
    expect(
      mountWith(answerWith({}, { state: "set", days: 9 }))
        .get('[data-testid="storage-cleanup"]')
        .text(),
    ).toContain("9");
    expect(
      mountWith(answerWith({}, { state: "default", days: 30 }))
        .get('[data-testid="storage-cleanup"]')
        .text(),
    ).toContain("30");
    const unreadable = mountWith(answerWith({}, { state: "unreadable" }))
      .get('[data-testid="storage-cleanup"]')
      .text();
    expect(unreadable).toContain("cleanupPeriodDays");
    expect(unreadable).not.toMatch(/\d/);
  });

  it("walks the entries with the arrow keys, stopping at both ends", async () => {
    const wrapper = mountWith(answerWith());
    const view = wrapper.vm as unknown as { move(by: number): void };
    const heading = async (): Promise<string> => (await wrapper.vm.$nextTick(), wrapper.get('[data-testid="storage-reader"] h2').text());
    view.move(-1);
    expect(await heading()).toBe("projects/");
    view.move(1);
    expect(await heading()).toBe("debug/");
    view.move(5);
    expect(await heading()).toBe("history.jsonl");
  });

  it("counts one file as one", () => {
    const one = answerWith();
    if (one.measure === null) throw new Error("expected a measure");
    one.measure.entries = [{ name: "history.jsonl", directory: false, ...size(1024, 1) }];
    expect(mountWith(one).get('[data-testid="storage-reader"] p').text()).toContain("1 file");
    expect(mountWith(one).get('[data-testid="storage-reader"] p').text()).not.toContain("1 files");
  });

  it("waits with the progress before the first measurement, and offers to measure again after", async () => {
    const waiting = mountWith(answerWith({ measure: null, measuring: { done: 4, of: 10 } }));
    expect(waiting.get('[data-testid="storage-unmeasured"]').text()).toContain("10");
    expect(waiting.find('[data-testid="storage-remeasure"]').exists()).toBe(false);
    const done = mountWith(answerWith());
    await done.get('[data-testid="storage-remeasure"]').trigger("click");
    expect(done.emitted("remeasure")).toHaveLength(1);
    expect(
      mountWith(answerWith({ measuring: { done: 1, of: 2 } }))
        .find('[data-testid="storage-remeasure"]')
        .exists(),
    ).toBe(false);
  });

  it("never leaves a finished-but-empty state looking like a measurement in progress", async () => {
    const notYet = mountWith(answerWith({ measure: null }));
    expect(notYet.get('[data-testid="storage-unmeasured"]').text()).toContain("Not measured");
    const failed = mountWith(answerWith({ measure: null, measureFailed: true }));
    expect(failed.get('[data-testid="storage-unmeasured"]').text()).toContain("Could not measure");
    await failed.get('[data-testid="storage-remeasure"]').trigger("click");
    expect(failed.emitted("remeasure")).toHaveLength(1);
    const unreadable = answerWith();
    if (unreadable.measure === null) throw new Error("expected a measure");
    unreadable.measure = { ...unreadable.measure, entries: [], projects: [], total: { bytes: 0, files: 0, unreadable: 1 } };
    expect(mountWith(unreadable).get('[data-testid="storage-unmeasured"]').text()).toContain("Could not read /home/me/.claude");
    unreadable.measure.total.unreadable = 0;
    expect(mountWith(unreadable).get('[data-testid="storage-unmeasured"]').text()).toContain("nothing in /home/me/.claude");
  });

  it("says an older measurement is shown when the last one failed", () => {
    expect(
      mountWith(answerWith({ measureFailed: true }))
        .get('[data-testid="storage-reader"]')
        .text(),
    ).toContain("older one");
    expect(mountWith(answerWith()).get('[data-testid="storage-reader"]').text()).not.toContain("older one");
  });

  it("says so when nothing could be read", () => {
    expect(mountWith(null, { failed: true }).find('[data-testid="storage-failed"]').exists()).toBe(true);
  });
});

describe("isLibraryStorageAnswer", () => {
  it("takes a whole answer and one before the first measurement", () => {
    expect(isLibraryStorageAnswer(answerWith())).toBe(true);
    expect(isLibraryStorageAnswer(answerWith({ measure: null, measuring: { done: 0, of: 0 } }))).toBe(true);
    expect(isLibraryStorageAnswer(answerWith({ measureFailed: true }))).toBe(true);
  });

  it("refuses a malformed one", () => {
    const good = answerWith();
    const measure = good.measure;
    if (measure === null) throw new Error("expected a measure");
    [
      null,
      {},
      { ...good, root: 3 },
      { ...good, measureFailed: undefined },
      { ...good, cleanup: { state: "set" } },
      { ...good, cleanup: { state: "other", days: 1 } },
      { ...good, measuring: { done: 1 } },
      { ...good, measure: { ...measure, entries: [{ name: "x" }] } },
      { ...good, measure: { ...measure, projects: [{ ...measure.projects[0], cwd: 3 }] } },
      { ...good, measure: { ...measure, otherProjects: { bytes: 1, files: 1, unreadable: 0 } } },
    ].forEach((value) => expect(isLibraryStorageAnswer(value)).toBe(false));
  });
});
