// Sending a dropped file's bytes to the host, for the case dropPaths.ts cannot serve: the
// browser withheld the real path (Chrome always, and every browser when MulmoTerminal is open
// from another machine, where a local path would name nothing on the host anyway).
//
// The path that comes back is absolute and inside the directory this session was granted at
// spawn time, so it inserts and reads exactly like a path the drag had carried itself.
import { DROP_FILENAME_HEADER, MAX_DROP_BYTES, type DropUploadResponse } from "../../common/dropUpload";
import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { sessionWritePath } from "./remoteCell";

// Generous: this is a real upload of up to MAX_DROP_BYTES, possibly over a phone's connection.
// Matched to the server's own ceiling for network mutations rather than a UI-scale timeout.
const UPLOAD_TIMEOUT_MS = 300_000;

const FALLBACK_MIME = "application/octet-stream";

export type DropUploadResult = { ok: true; path: string } | { ok: false; status: number | null };

/** Where a file is sent: this server, or the gateway for a session on a remote host (#3506). */
export const dropUploadUrl = (sessionId: string, host: string | null = null): string => sessionWritePath(host, sessionId, "drop");

/** The sentence to show when an upload did not happen. Keyed on status because the four cases
 *  need different actions from the user, and "it failed" tells them none of them. English —
 *  the caller runs it through the UI translator like the other terminal hints.
 *
 *  None of them names the GESTURE: a pasted screenshot travels this same upload (#938), and
 *  telling someone their "dropped file" failed when they pasted describes something they did
 *  not do. */
export function dropUploadErrorMessage(status: number | null): string {
  if (status === 413) return "That file is too large to send to the terminal.";
  if (status === 404) return "This terminal is no longer running, so the file could not be sent.";
  if (status === 403) return "The server refused the upload because the page's origin is not allowed.";
  return "Could not send the file to the terminal.";
}

/** True when the file is over the cap. Checked here rather than left to the server's 413 so a
 *  large file fails at once instead of after uploading all of it. */
export const isTooLargeToDrop = (size: number): boolean => size > MAX_DROP_BYTES;

// The server is the only writer of this shape, but an old build or a proxy returning something
// else would otherwise put `undefined` into the terminal as if it were a path.
const isDropUploadResponse = (value: unknown): value is DropUploadResponse => isRecord(value) && typeof value.path === "string" && value.path !== "";

export type DropBatchOutcome =
  | { kind: "inserted"; paths: string[] }
  | { kind: "failed"; status: number | null }
  // The terminal moved to a different session while the bytes were in flight.
  | { kind: "stale" };

/** Upload one drop's files and say what should happen with the result.
 *
 *  Split from the component and given its dependencies so the policy — order, and what a
 *  session change mid-upload means — can be tested without mounting a terminal.
 *
 *  `currentSession` is re-read rather than captured because a saved path belongs to ONE
 *  session: `--add-dir` grants the directory at spawn, so handing these paths to whatever
 *  session arrived in the meantime gives it a path it was never granted and cannot read. A
 *  110 MiB upload is long enough for a reconnect that cannot resume to mint a new id under it. */
export async function uploadDropBatch(
  session: string,
  files: readonly File[],
  currentSession: () => string | null,
  upload: (session: string, file: File) => Promise<DropUploadResult> = uploadDroppedFile,
): Promise<DropBatchOutcome> {
  const paths: string[] = [];
  for (const file of files) {
    if (currentSession() !== session) return { kind: "stale" };
    const result = await upload(session, file);
    if (!result.ok) return { kind: "failed", status: result.status };
    paths.push(result.path);
  }
  // Checked again after the last upload: the switch can land while the final file is in flight,
  // which the loop's own check would never see.
  return currentSession() === session ? { kind: "inserted", paths } : { kind: "stale" };
}

export async function uploadDroppedFile(sessionId: string, file: File, host: string | null = null): Promise<DropUploadResult> {
  if (isTooLargeToDrop(file.size)) return { ok: false, status: 413 };
  try {
    const res = await fetchWithTimeout(
      dropUploadUrl(sessionId, host),
      {
        method: "POST",
        headers: { "content-type": file.type || FALLBACK_MIME, [DROP_FILENAME_HEADER]: encodeURIComponent(file.name) },
        body: file,
      },
      UPLOAD_TIMEOUT_MS,
    );
    if (!res.ok) return { ok: false, status: res.status };
    const data: unknown = await res.json();
    return isDropUploadResponse(data) ? { ok: true, path: data.path } : { ok: false, status: null };
  } catch {
    return { ok: false, status: null }; // aborted, offline, or the host went away mid-upload
  }
}
