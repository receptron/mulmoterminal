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
  /** Told about every worker started, for tests. */
  onStart?: (worker: Worker) => void;
}

/** One worker and the calls waiting on IT. Kept together so that a worker's last events — an `exit`
 *  that arrives after a replacement has started — can only fail its own calls. */
interface Running {
  worker: Worker;
  pending: Map<string, Pending>;
}

export function createLibraryClient(options: LibraryClientOptions = {}): { call: LibraryCaller; close(): Promise<void> } {
  let current: Running | null = null;
  const failAll = (running: Running, reason: string) => {
    running.pending.forEach((call) => (clearTimeout(call.timer), call.reject(new Error(reason))));
    running.pending.clear();
    if (current === running) current = null;
  };
  const start = (): Running => {
    const owner = `${String(process.pid)}-${randomUUID()}`;
    const worker = new Worker(new URL("./library-worker.ts", import.meta.url), {
      workerData: { file: options.file ?? LIBRARY_INDEX_FILE, owner, ...(options.sources ?? defaultLibrarySources()) },
      execArgv: workerExecArgv(),
    });
    const running: Running = { worker, pending: new Map() };
    worker.unref(); // the index must never be what keeps the server from exiting
    worker.on("message", (message: unknown) => settle(running.pending, message));
    worker.on("error", (err: unknown) => failAll(running, `the library worker failed: ${err instanceof Error ? err.message : "unknown error"}`));
    worker.on("exit", () => failAll(running, "the library worker exited"));
    options.onStart?.(worker);
    return running;
  };
  // A call that never answers means a worker stuck in synchronous work, and every later call would
  // queue behind it. So the worker is retired — its other calls fail now, and the next call starts a
  // fresh one. An interrupted write is rolled back by SQLite; the lease it held simply expires.
  const retire = (running: Running, reason: string): void => {
    failAll(running, reason);
    void running.worker.terminate();
  };
  const call = (method: LibraryMethod, args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const running = (current ??= start());
      const id = randomUUID();
      const timer = setTimeout(() => retire(running, `library ${method} timed out`), options.timeout_ms ?? LIBRARY_REQUEST_TIMEOUT_MS);
      running.pending.set(id, { resolve, reject, timer });
      running.worker.postMessage({ id, method, args });
    });
  return {
    call,
    close: async () => {
      const closing = current;
      current = null;
      await closing?.worker.terminate();
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
