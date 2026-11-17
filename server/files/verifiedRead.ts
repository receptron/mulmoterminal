// The read side of verifiedWrite.ts (#3306): open first, then ask the containment check again, and
// read only through the descriptor of a file the check still names. A folder swapped for a link out
// between the check and the open is then caught before any of the outside file's bytes are read.
// Two of the limits in verifiedWrite.ts's header hold here too: three swaps timed to the instant, and a
// hard link being the same file.
import fs from "node:fs";
import { hasErrnoCode } from "../errors.js";
import { isOpenedFileAt, isSameFile, NO_FOLLOW, openUnlessLink, type Recheck } from "./verifiedWrite.js";

// Nonblocking where the platform has it: a FIFO swapped in after the check would otherwise hold this
// synchronous open, and the whole server with it, until a writer came — before the check could refuse.
const READ_FLAGS = fs.constants.O_RDONLY | NO_FOLLOW | (fs.constants.O_NONBLOCK ?? 0);

/** A descriptor open on `abs`, or null when what opened is not the file the check names now. Throws
 *  what the open throws (ENOENT, EISDIR, ...). The caller owns the descriptor and closes it. */
export function openVerifiedForRead(abs: string, recheck: Recheck): number | null {
  const fd = openUnlessLink(abs, READ_FLAGS);
  if (fd === null) return null;
  const verified = { same: false };
  try {
    verified.same = isSameFile(fd, recheck());
  } finally {
    if (!verified.same) fs.closeSync(fd);
  }
  return verified.same ? fd : null;
}

/** The whole of `abs`, or null when it escaped. Throws what `readFileSync` would. */
export function readVerified(abs: string, recheck: Recheck): Buffer | null {
  const fd = openVerifiedForRead(abs, recheck);
  if (fd === null) return null;
  try {
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** `readVerified` without blocking the event loop on the read, for a file that may be large. */
export async function readVerifiedAsync(abs: string, recheck: Recheck): Promise<Buffer | null> {
  const handle = await openHandleUnlessLink(abs);
  if (handle === null) return null;
  try {
    return isOpenedFileAt(await handle.stat({ bigint: true }), recheck()) ? await handle.readFile() : null;
  } finally {
    await handle.close();
  }
}

async function openHandleUnlessLink(abs: string): Promise<fs.promises.FileHandle | null> {
  try {
    return await fs.promises.open(abs, READ_FLAGS);
  } catch (error) {
    if (hasErrnoCode(error) && error.code === "ELOOP") return null;
    throw error;
  }
}
