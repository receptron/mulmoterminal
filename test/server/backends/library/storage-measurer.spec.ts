// @vitest-environment node
// One measurement at a time, the last finished one kept (#3333); and the real worker, on a temp home.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStorageMeasurer, startStorageWorker, type StorageWorkerEvents } from "../../../../server/backends/library/storage-measurer.js";
import type { HomeMeasure } from "../../../../server/backends/library/storage-home.js";

const MEASURE: HomeMeasure = { measuredAt: 1, total: { bytes: 1, files: 1, unreadable: 0 }, entries: [], projects: [] };

function fakeStarts() {
  const started: StorageWorkerEvents[] = [];
  return { started, start: (_home: string, events: StorageWorkerEvents) => void started.push(events) };
}

describe("createStorageMeasurer", () => {
  it("joins a measurement already running instead of starting another", () => {
    const { started, start } = fakeStarts();
    const measurer = createStorageMeasurer("/h", start);
    measurer.measure();
    measurer.measure();
    expect(started).toHaveLength(1);
    started[0].progress({ done: 2, of: 5 });
    expect(measurer.state()).toEqual({ measure: null, measuring: { done: 2, of: 5 } });
  });

  it("keeps the finished measurement, and a failed one leaves the last in place", () => {
    const { started, start } = fakeStarts();
    const measurer = createStorageMeasurer("/h", start);
    measurer.measure();
    started[0].done(MEASURE);
    expect(measurer.state()).toEqual({ measure: MEASURE, measuring: null });
    measurer.measure();
    started[1].failed("boom");
    expect(measurer.state()).toEqual({ measure: MEASURE, measuring: null });
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
