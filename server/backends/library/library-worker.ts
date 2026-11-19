// The thread the Library's index lives on (#3328). Building the index and querying it are both
// synchronous SQLite work, and a pass over a long history also churns enough memory for collection
// pauses of seconds — measured on the maintainer's history, against an event loop that carries every
// terminal. Here none of that can stop the server; at worst a request waits for the file in hand.
import { parentPort, workerData } from "node:worker_threads";
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { openLibraryIndex } from "./library-index.js";
import { createLocalLibraryService, type LibraryReply, type LibraryRequest, type LibraryService } from "./library-service.js";
import { dispatchLibraryRequest, isLibraryRequest } from "./library-dispatch.js";

const config = isRecord(workerData) ? workerData : {};
const service: Promise<LibraryService> = openLibraryIndex(readString(config.file), readString(config.owner), {
  projectsRoot: readString(config.projectsRoot),
  historyFile: readString(config.historyFile),
}).then(createLocalLibraryService);
// A failure to open is answered per request, so the client sees it as 503 rather than as a hang.
service.catch(() => {});

async function reply(request: LibraryRequest): Promise<LibraryReply> {
  try {
    return { id: request.id, ok: true, value: await dispatchLibraryRequest(await service, request) };
  } catch (err) {
    return { id: request.id, ok: false, error: err instanceof Error ? err.message : "the library index failed" };
  }
}

parentPort?.on("message", (message: unknown) => {
  if (!isLibraryRequest(message)) return;
  void reply(message).then((answer) => parentPort?.postMessage(answer));
});
