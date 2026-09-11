// What a browser is handed for a file, decided from its name alone.
//
// BOTH sides read this. The server sets it as the raw route's `Content-Type`
// (server/backends/rawServingPlan.ts); the terminal's file links ask the same question to decide
// where a click goes, because a type the browser cannot display is a type that turns a new tab
// into a silent download (#2038). Two copies of this table would send a click to a tab the server
// then made a download — which is the bug, arrived at from the other side.

import { SOURCE_CODE_EXTENSIONS } from "./sourceExtensions.js";

/** What a name with no extension is keyed by — the whole basename, lower-cased. A dotfile like
 *  `.gitignore` has no extension at all to `path.extname`, and keying it by "" would download it. */
const contentTypeKey = (name: string): { ext: string; textKey: string } => {
  const base = name.replace(/^.*[/\\]/, "").toLowerCase();
  const dot = base.lastIndexOf(".");
  const ext = dot <= 0 ? "" : base.slice(dot);
  return { ext, textKey: ext || base };
};

// Source / docs / config files: serve as text so they VIEW in the browser instead of
// downloading (the file-path links in terminal output point at these — a code workspace's
// `.md`/`.ts`/… should open, not save). text/plain is never executed, so it stays safe under
// the sandbox CSP; a genuinely unknown extension still falls through to octet-stream (download).
const TEXT_PLAIN = "text/plain; charset=utf-8";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

// On top of the shared source set: prose and markup the browser would otherwise render or
// download, the languages the client's in-app viewer doesn't claim, and the extensionless
// dotfiles (matched by basename — see `textKey` below). `.txt`/`.json`/`.csv` are absent
// because MIME_BY_EXT already types them.
const TEXT_ONLY_EXTS = [
  ".md",
  ".markdown",
  ".rst",
  ".adoc",
  ".mdx",
  ".pl",
  ".r",
  ".dart",
  ".ex",
  ".exs",
  ".env",
  ".properties",
  ".html",
  ".htm",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".lock",
];

const TEXT_EXTS = new Set<string>([...SOURCE_CODE_EXTENSIONS, ...TEXT_ONLY_EXTS]);

/** The type the raw route serves `name` as. `application/octet-stream` is the "nothing here can
 *  render it" answer, and in a browser tab that means a download rather than a view. */
export function rawContentType(name: string): string {
  const { ext, textKey } = contentTypeKey(name);
  return MIME_BY_EXT[ext] ?? (TEXT_EXTS.has(textKey) ? TEXT_PLAIN : "application/octet-stream");
}

/** Whether a browser tab would DISPLAY this rather than download it. The question a file link has
 *  to answer before sending a click to a new tab (#2038). */
export const browserDisplays = (name: string): boolean => rawContentType(name) !== "application/octet-stream";
