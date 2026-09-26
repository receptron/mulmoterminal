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

/** What the preview document says. `ready` is a fresh document announcing it can be scrolled;
 *  `scroll` is where the reader now is, in CSS pixels from the top of that document; `navigate`
 *  is a click on an external link, which the HOST opens (#2259) — the sandbox has no
 *  `allow-popups`, and following it inside the frame is what showed "refused to connect". */
export type MdPreviewFrameMessage = { kind: "ready" } | { kind: "scroll"; scrollY: number } | { kind: "navigate"; href: string };

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
}

/** A message from the preview document, or null for anything else in the window's message
 *  traffic. Null rather than a boolean guard: `scrollY` has to be checked as a real number
 *  anyway, and returning the narrowed value keeps that check in one place. */
export const mdPreviewFrameMessage = (data: unknown): MdPreviewFrameMessage | null => {
  if (!isRecord(data) || data.source !== MD_PREVIEW_FROM_FRAME) return null;
  if (data.kind === "ready") return { kind: "ready" };
  if (data.kind === "navigate") {
    const href = externalHref(data.href);
    return href === null ? null : { kind: "navigate", href };
  }
  if (data.kind !== "scroll") return null;
  const scrollY = finiteNumber(data.scrollY);
  // A negative offset is not a place in a document; it would scroll the restore to the top and
  // read as "the position was forgotten".
  return scrollY === null || scrollY < 0 ? null : { kind: "scroll", scrollY };
};
