// The wire between the Markdown preview iframe and the Files pane that hosts it (#2157).
//
// In `common/` because BOTH ends decide from it and neither owns it: the server builds the
// reporter script out of these names and the pane recognises what that script posts. The script
// is a STRING the server writes, so a name changed on one side and not the other fails silently —
// the pane simply never hears a message, which looks exactly like a preview that does not scroll.
//
// The preview document is opaque-origin (`sandbox allow-scripts`, never `allow-same-origin`), so
// `event.origin` on what it posts is the string "null" and identifies nothing. The pane checks
// `event.source` against its own iframe's `contentWindow` instead; these names are how a message
// that reached the wrong window is recognised, not a security boundary.
import { finiteNumber } from "./finiteNumber.js";
import { isRecord } from "./isRecord.js";

/** Tags a message the preview document sent to its host. */
export const MD_PREVIEW_FROM_FRAME = "mulmoterminal-md-preview";
/** Tags a message the host sent back into the preview document. */
export const MD_PREVIEW_FROM_HOST = "mulmoterminal-md-preview-host";

/** The query parameter that asks `/api/files/browse/md` for the embeddable document — the same
 *  rendering plus the reporter, under the CSP that allows only it. Absent means the plain
 *  document the new-tab view has always been served. */
export const MD_PREVIEW_EMBED_PARAM = "embed";
export const MD_PREVIEW_EMBED_ON = "1";

/** The query parameter carrying the host's token for one document (#2515). The frame is the only
 *  window the host listens to, but a document can navigate its OWN frame — a Markdown file nobody
 *  sanitised can hold a `<meta http-equiv="refresh">` — and the page it lands on would then speak
 *  from that frame. So the reporter stamps every message with a token it was given in its URL, and
 *  the host takes only messages that carry the token of the document it asked for. A page the frame
 *  navigated to was never given it. */
export const MD_PREVIEW_TOKEN_PARAM = "wire";

/** A token the host minted: letters, digits, `-` and `_`, long enough not to guess. Anything else is
 *  refused before it reaches the document, which embeds it in a script. */
export const isPreviewToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);

/** What the preview document says. `ready` is a fresh document announcing it can be scrolled;
 *  `scroll` is where the reader now is, in CSS pixels from the top of that document; `navigate`
 *  is a click on an external link, which the HOST opens (#2259) — the sandbox has no
 *  `allow-popups`, and following it inside the frame is what showed "refused to connect". `open`
 *  is a click on a link to another file, as written in the document (#2268): the frame's own URL
 *  is this server's route, so following it there is a 404, and only the host knows which file the
 *  document is. `code-block` asks the host to show the `index`-th code block (#2615). */
type MdPreviewFrameBody =
  | { kind: "ready" }
  | { kind: "scroll"; scrollY: number }
  | { kind: "navigate"; href: string }
  | { kind: "open"; href: string }
  | { kind: "code-block"; index: number };

/** What the document said, with the token it was served with (null when it carried none). */
export type MdPreviewFrameMessage = MdPreviewFrameBody & { token: string | null };

/** An href the document hands over as an external page. Built into the reporter script, so the
 *  document and the specs read the same pattern. */
export const EXTERNAL_HREF = /^https?:\/\//i;
/** An href that names another scheme (`mailto:`, `javascript:`) or another host (`//cdn…`). Left
 *  to the browser's default, as before #2268 — only an href with neither is a file. */
export const OTHER_SCHEME_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** `value` as an absolute http(s) URL, or null. The only kind of link the host opens on the
 *  document's behalf: the document is a file this app never sanitised, so a `javascript:` or
 *  `file:` href it posts must not reach `window.open`. */
export const externalHref = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

/** What the host says back: put the reader here. Sent in answer to `ready`, so the host never has
 *  to guess when the document became scrollable. */
export interface MdPreviewHostMessage {
  source: typeof MD_PREVIEW_FROM_HOST;
  scrollY: number;
  /** The accessible name for the code blocks' copy buttons, in the app's language (#2615). */
  codeCopyLabel?: string;
  /** What the disclosure under a rendered diagram is called (#2991). */
  diagramSourceLabel?: string;
}

/** New names for the code blocks' copy buttons and the diagrams' source disclosures: the app's
 *  language changed while this document was open (the first names come with the answer to `ready`). */
export interface MdPreviewLabelMessage {
  source: typeof MD_PREVIEW_FROM_HOST;
  codeCopyLabel: string;
  diagramSourceLabel: string;
}

/** Take the reader to a heading (#2576): the `heading`-th one in the document (0-based) when it reads
 *  `headingText`; otherwise the `headingOccurrence`-th heading with that text, then the first with it
 *  at or after the position. The host counts headings in the source and the document counts what it
 *  drew; the text and its occurrence settle a disagreement between the two. */
export interface MdPreviewHeadingMessage {
  source: typeof MD_PREVIEW_FROM_HOST;
  heading: number;
  headingText: string;
  /** Which of the headings with this text it is (0-based), for when the position misses. */
  headingOccurrence: number;
}

/** A message from the preview document, or null for anything else in the window's message
 *  traffic. Null rather than a boolean guard: `scrollY` has to be checked as a real number
 *  anyway, and returning the narrowed value keeps that check in one place. */
export const mdPreviewFrameMessage = (data: unknown): MdPreviewFrameMessage | null => {
  if (!isRecord(data) || data.source !== MD_PREVIEW_FROM_FRAME) return null;
  const body = frameMessageBody(data);
  return body && { ...body, token: isPreviewToken(data.token) ? data.token : null };
};

const frameMessageBody = (data: Record<string, unknown>): MdPreviewFrameBody | null => {
  if (data.kind === "ready") return { kind: "ready" };
  if (data.kind === "navigate") {
    const href = externalHref(data.href);
    return href === null ? null : { kind: "navigate", href };
  }
  // Passed on as written: which file it names depends on where the document is, which only the
  // host knows (src/components/previewLinkTarget.ts).
  if (data.kind === "open") return typeof data.href === "string" && data.href !== "" ? { kind: "open", href: data.href } : null;
  // `code-block` is a button on a block the server numbered (#2615) — or one the document forged, which
  // can only name another block: the pane shows the block from the file before anything is copied.
  if (data.kind === "code-block") return Number.isSafeInteger(data.index) && Number(data.index) >= 0 ? { kind: "code-block", index: Number(data.index) } : null;
  if (data.kind !== "scroll") return null;
  const scrollY = finiteNumber(data.scrollY);
  // A negative offset is not a place in a document; it would scroll the restore to the top and
  // read as "the position was forgotten".
  return scrollY === null || scrollY < 0 ? null : { kind: "scroll", scrollY };
};
