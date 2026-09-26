// The host end of the Markdown preview's scroll wire (#2157).
//
// The preview document is opaque-origin on purpose — it renders a `.md` this app never sanitised,
// and `allow-same-origin` would put that on the app's own origin for good. So the pane cannot
// reach into it: `contentWindow.scrollY` is unreadable, and the only thing that crosses is what
// the document's own reporter posts.
//
// Who is speaking is decided by `listenToPreviewFrame`, which exists for exactly this reason and
// already had one caller: an opaque document's `event.origin` is the string "null" and identifies
// nobody, so the line is drawn at `event.source` being this pane's own frame. That matters twice
// over here — several panes can be mounted at once (a Files view and a pane beside a zoomed
// cell), each listening on the same window.
//
// What is left in this file is the answer the host owes: the document announces itself when it is
// ready and the HOST tells it where to go. The pane never has to guess when a frame became
// scrollable — which matters because the frame reloads on its own whenever the file changes on
// disk, and a reader who was halfway down stays there.
import { onBeforeUnmount, onMounted, type Ref } from "vue";
import { MD_PREVIEW_FROM_HOST, mdPreviewFrameMessage, type MdPreviewHostMessage } from "../../common/mdPreviewMessage";
import { listenToPreviewFrame } from "../utils/sharedAppPreviewChannel";

const restoreTo = (scrollY: number): MdPreviewHostMessage => ({ source: MD_PREVIEW_FROM_HOST, scrollY });

/** Keep `scrollTop` following the preview frame, and tell a fresh document where to go.
 *
 *  `frame` is a getter rather than the element for the reason that helper gives: the element
 *  outlives each document in it, and `contentWindow` is what changes on a reload — asking late is
 *  what makes a message from the document being replaced fail the check instead of overwriting
 *  the position.
 *
 *  The host answers `ready` and nothing else. Whether the place LANDS is the document's problem,
 *  not this end's: the pane hides the frame with `display:none` when the reader switches to the
 *  editor, and a document with no layout clamps every scroll to the top. Watching for the preview
 *  to be shown again and re-sending looks like the fix here and is not — `display` going back is
 *  not layout having happened, and that version passed one run in three. The document watches its
 *  own height instead (see the reporter in server/files/mdPreviewEmbed.ts). */
export function useMdPreviewScroll(frame: () => HTMLIFrameElement | null, scrollTop: Ref<number>): void {
  let stopListening: (() => void) | null = null;
  const receive = (data: unknown): void => {
    const message = mdPreviewFrameMessage(data);
    if (!message) return;
    // The document cannot open a tab itself (no `allow-popups`); the click's activation reaches
    // this window, so the popup blocker lets this through.
    if (message.kind === "navigate") window.open(message.href, "_blank", "noopener,noreferrer");
    else if (message.kind === "scroll") scrollTop.value = message.scrollY;
    // `"*"` because an opaque origin cannot be named as a target: `postMessage` takes a URL, and
    // "null" is not one. What it carries is a scroll offset, into the frame whose window the
    // listener just identified.
    else frame()?.contentWindow?.postMessage(restoreTo(scrollTop.value), "*");
  };
  onMounted(() => {
    stopListening = listenToPreviewFrame(frame, receive);
  });
  onBeforeUnmount(() => {
    stopListening?.();
    stopListening = null;
  });
}
