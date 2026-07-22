// What a failure of the HTTP server itself becomes: the line the operator reads, and the
// code the process leaves with.
//
// The code is a CONTRACT with bin/mulmoterminal.js. 75 tells the launcher the port was taken
// at bind time, so it retries on a fresh one; anything else tells it to stop. Get that wrong
// and the retry either never fires (the app just fails to start on a busy port) or fires for
// errors retrying cannot fix.
//
// Out of the listener because a policy reachable only by failing to bind a port is a policy
// nothing can check — the listener now only prints and exits (#548).
import { hasErrnoCode, messageOf } from "../errors.js";

// Keep in sync with bin/mulmoterminal.js — a test asserts the two agree.
export const PORT_IN_USE_EXIT_CODE = 75;
export const SERVER_ERROR_EXIT_CODE = 1;

export interface ServerExit {
  message: string;
  code: number;
}

export function serverErrorExit(err: unknown, port: string | number): ServerExit {
  if (hasErrnoCode(err) && err.code === "EADDRINUSE") {
    return {
      message: `[mulmoterminal] Port ${port} is already in use — set PORT=<n> or pass --port <n>.`,
      code: PORT_IN_USE_EXIT_CODE,
    };
  }
  return { message: `[mulmoterminal] server error: ${messageOf(err)}`, code: SERVER_ERROR_EXIT_CODE };
}
