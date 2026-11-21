// The server's side of the Storage view's measurement (#3333): one measurement at a time, on its own
// worker, and the last one that finished kept for every later answer. Asking again while one runs
// joins it rather than starting another.
import { Worker } from "node:worker_threads";
import { isRecord } from "../../../common/isRecord.js";
import { isStorageProgress, type StorageProgress } from "../../../common/libraryStorage.js";
import type { HomeMeasure } from "./storage-home.js";
import { workerExecArgv } from "./library-client.js";

export interface StorageWorkerEvents {
  progress(progress: StorageProgress): void;
  done(measure: HomeMeasure | null): void;
  failed(error: string): void;
}

export type StartStorageWorker = (home: string, events: StorageWorkerEvents) => void;

export interface StorageState {
  measure: HomeMeasure | null;
  measuring: StorageProgress | null;
}

/** A finished measurement as the worker sends it. Only the shape the server reads is checked: it is
 *  this server's own worker, not an outside source. */
export const isHomeMeasure = (value: unknown): value is HomeMeasure =>
  isRecord(value) && typeof value.measuredAt === "number" && isRecord(value.total) && Array.isArray(value.entries) && Array.isArray(value.projects);

function onWorkerMessage(message: unknown, events: StorageWorkerEvents): void {
  if (!isRecord(message)) return;
  if (message.type === "progress" && isStorageProgress(message.progress)) events.progress(message.progress);
  else if (message.type === "done") events.done(isHomeMeasure(message.measure) ? message.measure : null);
  else if (message.type === "failed") events.failed(typeof message.error === "string" ? message.error : "the measurement failed");
}

export const startStorageWorker: StartStorageWorker = (home, events) => {
  const worker = new Worker(new URL("./storage-worker.ts", import.meta.url), { workerData: { home }, execArgv: workerExecArgv() });
  worker.unref(); // a measurement must never be what keeps the server from exiting
  let settled = false;
  const settle = (finish: () => void): void => {
    if (settled) return;
    settled = true;
    finish();
  };
  worker.on("message", (message: unknown) =>
    onWorkerMessage(message, { ...events, done: (m) => settle(() => events.done(m)), failed: (e) => settle(() => events.failed(e)) }),
  );
  worker.on("error", (err: unknown) => settle(() => events.failed(err instanceof Error ? err.message : "the measurement failed")));
  worker.on("exit", () => settle(() => events.failed("the measurement stopped")));
};

export function createStorageMeasurer(home: string, start: StartStorageWorker = startStorageWorker): { measure(): void; state(): StorageState } {
  let last: HomeMeasure | null = null;
  let measuring: StorageProgress | null = null;
  const measure = (): void => {
    if (measuring !== null) return;
    measuring = { done: 0, of: 0 };
    start(home, {
      progress: (progress) => (measuring = progress),
      done: (measure) => {
        // A home that is not there (yet) measures as nothing rather than keeping an older answer.
        last = measure;
        measuring = null;
      },
      failed: (error) => {
        console.error(`[library-storage] ${error}`);
        measuring = null;
      },
    });
  };
  return { measure, state: () => ({ measure: last, measuring }) };
}
