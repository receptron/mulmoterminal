// @vitest-environment node
// One measurement at a time, the last finished one kept (#3333); and the real worker, on a temp home.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStorageMeasurer, startStorageWorker, type StorageWorkerEvents } from "../../../../server/backends/library/storage-measurer.js";
import type { HomeMeasure } from "../../../../server/backends/library/storage-home.js";

const MEASURE: HomeMeasure = { measuredAt: 1, total: { bytes: 1, files: 1, unreadable: 0 }, entries: [], projects: [] };
const TIMEOUT_MS = 1000;

function fakeStarts() {
  const started: StorageWorkerEvents[] = [];
  const stopped: number[] = [];
  const start = (_home: string, events: StorageWorkerEvents) => {
    const at = started.push(events) - 1;
    return () => void stopped.push(at);
  };
  return { started, stopped, start };
}

describe("createStorageMeasurer", () => {
  afterEach(() => vi.useRealTimers());

  it("joins a measurement already running instead of starting another", () => {
    const { started, start } = fakeStarts();
    const measurer = createStorageMeasurer("/h", start, TIMEOUT_MS);
    measurer.measure();
    measurer.measure();
    expect(started).toHaveLength(1);
    started[0].progress({ done: 2, of: 5 });
    expect(measurer.state()).toEqual({ measure: null, measuring: { done: 2, of: 5 }, failed: false });
  });

  it("keeps the finished measurement; a failed one leaves the last in place and says so", () => {
    const { started, start } = fakeStarts();
    const measurer = createStorageMeasurer("/h", start, TIMEOUT_MS);
    measurer.measure();
    started[0].done(MEASURE);
    expect(measurer.state()).toEqual({ measure: MEASURE, measuring: null, failed: false });
    measurer.measure();
    started[1].failed("boom");
    expect(measurer.state()).toEqual({ measure: MEASURE, measuring: null, failed: true });
    measurer.measure();
    started[2].done(null);
    expect(measurer.state()).toEqual({ measure: MEASURE, measuring: null, failed: true });
    measurer.measure();
    started[3].done({ ...MEASURE, measuredAt: 2 });
    expect(measurer.state()).toMatchObject({ measure: { measuredAt: 2 }, failed: false });
  });

  it("stops a measurement that never finishes, so the next ask starts again", () => {
    vi.useFakeTimers();
    const { started, stopped, start } = fakeStarts();
    const measurer = createStorageMeasurer("/h", start, TIMEOUT_MS);
    measurer.measure();
    vi.advanceTimersByTime(TIMEOUT_MS - 1);
    expect(measurer.state().measuring).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(stopped).toEqual([0]);
    expect(measurer.state()).toEqual({ measure: null, measuring: null, failed: true });
    measurer.measure();
    expect(started).toHaveLength(2);
    // The stopped one's late answer belongs to an older measurement and changes nothing.
    started[0].done(MEASURE);
    started[0].progress({ done: 9, of: 9 });
    expect(measurer.state()).toEqual({ measure: null, measuring: { done: 0, of: 0 }, failed: true });
  });

  it("does not time out a measurement that finished", () => {
    vi.useFakeTimers();
    const { started, stopped, start } = fakeStarts();
    const measurer = createStorageMeasurer("/h", start, TIMEOUT_MS);
    measurer.measure();
    started[0].done(MEASURE);
    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(stopped).toEqual([]);
    expect(measurer.state()).toEqual({ measure: MEASURE, measuring: null, failed: false });
  });

  it("ends a measurement whose worker cannot start, rather than measuring forever", () => {
    const measurer = createStorageMeasurer(
      "/h",
      () => {
        throw new Error("no worker");
      },
      TIMEOUT_MS,
    );
    measurer.measure();
    expect(measurer.state()).toEqual({ measure: null, measuring: null, failed: true });
  });
});

describe("startStorageWorker", () => {
  const homes: string[] = [];
  afterEach(async () => Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))));

  it("measures a real home on its own thread", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "mt-storage-worker-"));
    homes.push(home);
    await mkdir(path.join(home, "projects", "-p"), { recursive: true });
    await writeFile(path.join(home, "projects", "-p", "s.jsonl"), "x");
    const measure = await new Promise<HomeMeasure | null>((resolve, reject) =>
      startStorageWorker(home, { progress: () => {}, done: resolve, failed: (error) => reject(new Error(error)) }),
    );
    expect(measure?.projects.map((project) => project.slug)).toEqual(["-p"]);
    expect(measure?.entries.map((entry) => entry.name)).toEqual(["projects"]);
  }, 30_000);
});
