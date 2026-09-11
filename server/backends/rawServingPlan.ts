// How /api/files/raw should serve a workspace file: its content type, whether the response
// must be sandboxed, and whether it is over the size cap.
//
// Three decisions that were inline in the route and reached, between them, by one .png test.
// The one that matters is the sandbox: an .svg can carry inline <script>, so the response
// gets `Content-Security-Policy: sandbox` to keep it out of the app origin. PDFs are the sole
// exception — WebKit will not render a sandbox-opaque PDF — and that exception is exactly the
// kind of thing that widens by accident. Serving an SVG WITHOUT the sandbox is stored XSS
// against /api/* and the session cookie.
import { rawContentType } from "../../common/rawContentType.js";

const MAX_RAW_BYTES = 25 * 1024 * 1024; // images / text / generic
const MAX_MEDIA_BYTES = 500 * 1024 * 1024; // audio / video (streamed via Range)

// The table and the text/binary decision moved to common/rawContentType.ts (#2038): the terminal's
// file links ask the same question to decide where a click goes, and two copies would disagree —
// a click sent to a tab that the server then made a download.

// Audio and video are the large, Range-streamed kinds that get the bigger cap.
function isMedia(mime: string): boolean {
  return mime.startsWith("audio/") || mime.startsWith("video/");
}

export interface RawServingPlan {
  contentType: string;
  // False only for application/pdf; everything else is sandboxed.
  sandbox: boolean;
  // True when the file is over the cap for its kind — the route answers 413.
  tooLarge: boolean;
}

export function rawServingPlan(absPath: string, size: number): RawServingPlan {
  const contentType = rawContentType(absPath);
  const cap = isMedia(contentType) ? MAX_MEDIA_BYTES : MAX_RAW_BYTES;
  return { contentType, sandbox: contentType !== "application/pdf", tooLarge: size > cap };
}
