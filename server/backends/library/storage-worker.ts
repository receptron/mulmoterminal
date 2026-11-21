// The thread that measures Claude Code's home for the Storage view (#3333). A walk of a large home
// visits hundreds of thousands of entries; here it cannot hold up the server, nor the index's worker,
// which retires any call that runs long. It measures once, reports as it goes, and exits.
import path from "node:path";
import { promises as fs } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { measureHome } from "./storage-home.js";
import type { WalkFs } from "./storage-walk.js";

const realFs: WalkFs = { lstat: (at) => fs.lstat(at), readdir: (at) => fs.readdir(at), join: path.join };
const home = isRecord(workerData) ? readString(workerData.home) : "";

void measureHome(home, realFs, Date.now, (progress) => parentPort?.postMessage({ type: "progress", progress })).then(
  (measure) => parentPort?.postMessage({ type: "done", measure }),
  (err: unknown) => parentPort?.postMessage({ type: "failed", error: err instanceof Error ? err.message : "the measurement failed" }),
);
