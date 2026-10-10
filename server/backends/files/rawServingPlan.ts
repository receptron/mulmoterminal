// How /api/files/raw should serve a workspace file: its content type, whether the response
// must be sandboxed, and whether it is over the size cap.
//
// Three decisions that were inline in the route and reached, between them, by one .png test.
// The one that matters is the sandbox: an .svg can carry inline <script>, so the response
// gets `Content-Security-Policy: sandbox` to keep it out of the app origin. Two exceptions, each
// because a browser cannot show the file under the sandbox at all:
//   - a PDF: WebKit will not render a sandbox-opaque PDF.
//   - audio / video: Chrome's media page re-requests the file from the sandbox's `null` origin in
//     CORS mode, the request fails, and the player opens with nothing to play.
// Neither can run script in the document that shows it — a media file is decoded, not parsed as
// markup, and `nosniff` keeps a mislabelled file from being sniffed into HTML. Every other type
// keeps the sandbox, and that is exactly the kind of list that widens by accident. Serving an SVG
// WITHOUT the sandbox is stored XSS against /api/* and the session cookie.
import { rawContentType } from "../../../common/rawContentType.js";

// Only for what a tab renders whole — an image, a text file. A PDF, audio and video are uncapped:
// the route streams them (Range for media), so size costs no server memory, and a screen recording
// routinely passes any fixed cap.
const MAX_RAW_BYTES = 25 * 1024 * 1024;

// The table and the text/binary decision moved to common/rawContentType.ts (#2038): the terminal's
// file links ask the same question to decide where a click goes, and two copies would disagree —
// a click sent to a tab that the server then made a download.

function isMedia(mime: string): boolean {
  return mime.startsWith("audio/") || mime.startsWith("video/");
}

function isUncapped(mime: string): boolean {
  return mime === "application/pdf" || isMedia(mime);
}

export interface RawServingPlan {
  contentType: string;
  // False only for application/pdf, audio/* and video/*; everything else is sandboxed.
  sandbox: boolean;
  // True when a capped kind is over the cap — the route answers 413.
  tooLarge: boolean;
}

export function rawServingPlan(absPath: string, size: number): RawServingPlan {
  const contentType = rawContentType(absPath);
  const tooLarge = !isUncapped(contentType) && size > MAX_RAW_BYTES;
  return { contentType, sandbox: contentType !== "application/pdf" && !isMedia(contentType), tooLarge };
}
