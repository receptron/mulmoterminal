// Turn File objects into paths the agent can read.
//
// The terminal's happy path inserts a dropped file's own path (dropPaths.ts). This is the
// fallback for the two cases where there is no path to insert:
//
//   - Chrome withholds `text/uri-list` on a file drop, so the path route yields nothing.
//   - A pasted screenshot (⌘⌃⇧4) never had a file on disk in the first place.
//
// Both still carry the bytes, so we send them to the server, which writes them somewhere real
// and answers with that path. The terminal inserts it exactly as it would a dropped path — the
// agent sees no difference.

import { toInsertText } from "../components/dropPaths";

// Mirrors MAX_DROP_BYTES on the server. Checked here too so an oversized file fails instantly
// instead of after uploading megabytes only to be refused.
export const MAX_STAGED_BYTES = 25 * 1024 * 1024;
// One drop can carry a folder's worth of files; past a handful the inserted line is unreadable
// anyway, and the user is better served by a picker.
export const MAX_STAGED_FILES = 10;

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read the file"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });

/** Upload one file, resolving to the absolute path the server staged it at, or null on any
 *  failure. Null rather than a throw: one unreadable file in a multi-file drop shouldn't
 *  discard the others, and the caller's fallback (the drop hint) is the same either way. */
export async function stageFile(file: File): Promise<string | null> {
  if (file.size > MAX_STAGED_BYTES) return null;
  try {
    const dataUrl = await readAsDataUrl(file);
    const res = await fetch("/api/files/dropped", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl, name: file.name }),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const staged = (body as { path?: unknown })?.path;
    return typeof staged === "string" && staged ? staged : null;
  } catch {
    return null;
  }
}

/** Stage every file and return the text to insert (`''` when none survived). Sequential, not
 *  parallel: these are multi-megabyte bodies, and a folder drop firing ten at once would
 *  compete with the very sessions the user is watching. */
export async function stagedInsertText(files: readonly File[]): Promise<string> {
  const paths: string[] = [];
  for (const file of files.slice(0, MAX_STAGED_FILES)) {
    const staged = await stageFile(file);
    if (staged) paths.push(staged);
  }
  return toInsertText(paths);
}

/** The files carried by a paste. Only the clipboard's file entries — a text paste must fall
 *  through to xterm untouched, which is the overwhelmingly common case. */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []);
}
