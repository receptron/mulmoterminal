// The server's side of the Storage view's measurement (#3333): one measurement at a time, on its own
// worker, and the last one that finished kept for every later answer. Asking again while one runs
// joins it rather than starting another. One that never finishes — a stuck file system, a worker that
// will not start — is stopped after STORAGE_MEASURE_TIMEOUT_MS, so the next ask can start again.
import { Worker } from "node:worker_threads";
import { isRecord } from "../../../common/isRecord.js";
import { isStorageProgress, type StorageProgress } from "../../../common/libraryStorage.js";
import type { HomeMeasure } from "./storage-home.js";
import { workerExecArgv } from "./library-client.js";

export interface StorageWorkerEvents {
  progress(progress: StorageProgress): void;
  /** Null when the worker's answer was not a measurement. */
  done(measure: HomeMeasure | null): void;
  failed(error: string): void;
}

/** Starts a measurement and answers how to stop it. */
export type StartStorageWorker = (home: string, events: StorageWorkerEvents) => () => void;

/** Far beyond a full walk of a large home (about a minute on the maintainer's machine). */
export const STORAGE_MEASURE_TIMEOUT_MS = 10 * 60 * 1000;

export interface StorageState {
  measure: HomeMeasure | null;
  measuring: StorageProgress | null;
  /** The last measurement ended without an answer; `measure` is then an older one, or null. */
  failed: boolean;
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
  worker.on("message", (message: unknown) => onWorkerMessage(message, events));
  worker.on("error", (err: unknown) => events.failed(err instanceof Error ? err.message : "the measurement failed"));
  worker.on("exit", () => events.failed("the measurement stopped"));
  // After the listeners: adding the first `message` listener refs the worker's port again.
  worker.unref(); // a measurement must never be what keeps the server from exiting
  return () => void worker.terminate();
};

type Outcome = { measure: HomeMeasure } | { error: string };

const errorOf = (err: unknown): string => (err instanceof Error ? err.message : "the measurement could not start");

export function createStorageMeasurer(
  home: string,
  start: StartStorageWorker = startStorageWorker,
  timeout_ms: number = STORAGE_MEASURE_TIMEOUT_MS,
): { measure(): void; state(): StorageState } {
  let last: HomeMeasure | null = null;
  let measuring: StorageProgress | null = null;
  let failed = false;
  // Which measurement is current: a stopped worker's late events belong to an older one and are dropped.
  let runs = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const isCurrent = (run: number): boolean => run === runs && measuring !== null;
  const finish = (run: number, outcome: Outcome): void => {
    if (!isCurrent(run)) return;
    clearTimeout(watchdog);
    measuring = null;
    failed = "error" in outcome;
    if ("error" in outcome) console.error(`[library-storage] ${outcome.error}`);
    else last = outcome.measure;
  };
  const events = (run: number): StorageWorkerEvents => ({
    progress: (progress) => {
      if (isCurrent(run)) measuring = progress;
    },
    done: (measure) => finish(run, measure === null ? { error: "the measurement sent no answer" } : { measure }),
    failed: (error) => finish(run, { error }),
  });
  const measure = (): void => {
    if (measuring !== null) return;
    const run = ++runs;
    measuring = { done: 0, of: 0 };
    let stop = (): void => {};
    watchdog = setTimeout(() => {
      stop();
      finish(run, { error: "the measurement took too long and was stopped" });
    }, timeout_ms);
    watchdog.unref();
    try {
      stop = start(home, events(run));
    } catch (err) {
      finish(run, { error: errorOf(err) });
    }
  };
  return { measure, state: () => ({ measure: last, measuring, failed }) };
}
