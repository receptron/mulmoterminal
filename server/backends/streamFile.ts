// Serving a file by streaming it to an HTTP response, with the one thing every raw-file
// route here kept forgetting: an `error` handler on the read stream. Without it, a file
// that vanishes or turns unreadable between stat and open (EACCES / ENOENT) emits an
// unhandled 'error' → uncaughtException, and the request hangs with no response.
import { createReadStream } from "node:fs";
import type { Response } from "express";

// What to do when the read stream errors, decided purely on whether the response has
// already begun. Once headers/body bytes are on the wire we can't change the status, so
// the only correct move is to abort the connection; before that, a clean 500 is possible.
export type StreamErrorAction = "500" | "destroy";

export function streamErrorAction(headersSent: boolean): StreamErrorAction {
  return headersSent ? "destroy" : "500";
}

// Pipe a file to the response with the error handling above. `range` streams a byte slice
// (the caller has already set 206 + Content-Range); omit it for the whole file.
export function streamFileToResponse(abs: string, res: Response, range?: { start: number; end: number }): void {
  const stream = range ? createReadStream(abs, range) : createReadStream(abs);
  stream.on("error", () => {
    if (streamErrorAction(res.headersSent) === "500") res.status(500).json({ error: "failed to read file" });
    else res.destroy();
  });
  stream.pipe(res);
}
