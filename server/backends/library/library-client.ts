// The Library service as the server's main thread sees it (#3328): every call is a message to the
// worker that owns the index, answered by id. The answer stays `unknown` here: it crossed a thread as
// plain data, and the routes only hand it on as JSON. The worker starts on the first call — never at boot —
// and starts again on the next call if it dies.
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { defaultLibrarySources, LIBRARY_INDEX_FILE, type LibrarySources } from "./library-index.js";
import type { LibraryCaller, LibraryMethod, LibraryReply } from "./library-service.js";

/** Long enough for the worker to finish the largest single file of a first pass. */
export const LIBRARY_REQUEST_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// The server runs through tsx, so the worker inherits the loader; a process started without it (a
// spec runner) passes it explicitly.
const workerExecArgv = (): string[] => (process.execArgv.includes("tsx") ? process.execArgv : [...process.execArgv, "--import", "tsx"]);

const isReply = (value: unknown): value is LibraryReply => isRecord(value) && typeof value.id === "string" && typeof value.ok === "boolean";

export interface LibraryClientOptions {
  file?: string;
  sources?: LibrarySources;
  timeout_ms?: number;
}

export function createLibraryClient(options: LibraryClientOptions = {}): { call: LibraryCaller; close(): Promise<void> } {
  let worker: Worker | null = null;
  const pending = new Map<string, Pending>();
  const failAll = (reason: string) => {
    pending.forEach((call) => (clearTimeout(call.timer), call.reject(new Error(reason))));
    pending.clear();
    worker = null;
  };
  const start = (): Worker => {
    const owner = `${String(process.pid)}-${randomUUID()}`;
    const started = new Worker(new URL("./library-worker.ts", import.meta.url), {
      workerData: { file: options.file ?? LIBRARY_INDEX_FILE, owner, ...(options.sources ?? defaultLibrarySources()) },
      execArgv: workerExecArgv(),
    });
    started.unref(); // the index must never be what keeps the server from exiting
    started.on("message", (message: unknown) => settle(pending, message));
    started.on("error", (err: unknown) => failAll(`the library worker failed: ${err instanceof Error ? err.message : "unknown error"}`));
    started.on("exit", () => failAll("the library worker exited"));
    return started;
  };
  const call = (method: LibraryMethod, args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      worker ??= start();
      const id = randomUUID();
      const timer = setTimeout(() => (pending.delete(id), reject(new Error(`library ${method} timed out`))), options.timeout_ms ?? LIBRARY_REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, method, args });
    });
  return {
    call,
    close: async () => {
      await worker?.terminate();
      worker = null;
    },
  };
}

function settle(pending: Map<string, Pending>, message: unknown): void {
  if (!isReply(message)) return;
  const call = pending.get(message.id);
  if (call === undefined) return;
  pending.delete(message.id);
  clearTimeout(call.timer);
  if (message.ok) call.resolve(message.value);
  else call.reject(new Error(readString(message.error) || "the library index failed"));
}
