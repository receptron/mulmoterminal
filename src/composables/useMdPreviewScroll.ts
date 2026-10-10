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
import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import {
  MD_PREVIEW_FROM_HOST,
  mdPreviewFrameMessage,
  type MdPreviewHeadingMessage,
  type MdPreviewHostMessage,
  type MdPreviewLabelMessage,
} from "../../common/mdPreviewMessage";
import { listenToPreviewFrame } from "../utils/sharedAppPreviewChannel";
import { usePreviewCodeBlock, type PreviewCodeBlockDialogState, type PreviewCodeBlockDeps, type PreviewCodeBlockHost } from "./usePreviewCodeBlock";

/** The names the document takes from the host, in the app's language. */
type PreviewLabels = Pick<MdPreviewLabelMessage, "codeCopyLabel" | "diagramSourceLabel">;

const labelsOf = (host: PreviewCodeBlockHost): PreviewLabels => ({ codeCopyLabel: host.label(), diagramSourceLabel: host.diagramSourceLabel() });

const restoreTo = (scrollY: number, labels?: PreviewLabels): MdPreviewHostMessage => ({
  source: MD_PREVIEW_FROM_HOST,
  scrollY,
  ...(labels ?? {}),
});

/** Keep `scrollTop` following the preview frame, and tell a fresh document where to go.
 *
 *  `frame` is a getter rather than the element for the reason that helper gives: the element
 *  outlives each document in it, and `contentWindow` is what changes on a reload — asking late is
 *  what keeps a frame the pane has replaced from vouching for the new one. A navigation of the SAME
 *  frame keeps its `contentWindow`, so the pane gives a Markdown document a frame of its own rather
 *  than trusting this check to tell two documents apart (FilesPane.vue, #2269). The frame check alone
 *  trusts a FRAME, not a document — a document can navigate its own frame — so every message must
 *  also carry the token the pane gave the document it asked for (#2515).
 *
 *  The host answers `ready` and nothing else. Whether the place LANDS is the document's problem,
 *  not this end's: the pane hides the frame with `display:none` when the reader switches to the
 *  editor, and a document with no layout clamps every scroll to the top. Watching for the preview
 *  to be shown again and re-sending looks like the fix here and is not — `display` going back is
 *  not layout having happened, and that version passed one run in three. The document watches its
 *  own height instead (see the reporter in server/files/mdPreviewReporter.ts). */
export interface MdPreviewScroll {
  goToHeading: (index: number, text: string, occurrence: number) => void;
  /** Take the reader to the top of the document. */
  goToTop: () => void;
  /** Called each time a document announces itself, after the host has answered it with the place. */
  onReady: (listener: () => void) => void;
  /** The code-block dialog's state (#2615) — what the Preview's buttons call (`host`), which block is
   *  shown, and how to close it; null without `codeBlockDeps`. */
  codeBlock: PreviewCodeBlockDialogState | null;
}

export function useMdPreviewScroll(
  frame: () => HTMLIFrameElement | null,
  scrollTop: Ref<number>,
  openLink: (href: string) => void,
  token: () => string | null,
  codeBlockDeps?: PreviewCodeBlockDeps,
): MdPreviewScroll {
  const codeBlock = codeBlockDeps ? usePreviewCodeBlock(codeBlockDeps) : null;
  const codeBlocks = codeBlock?.host;
  // A language switch renames the buttons of the document already open; a new one gets it with `ready`.
  if (codeBlocks) {
    watch(
      () => labelsOf(codeBlocks),
      (labels) => {
        const renamed: MdPreviewLabelMessage = { source: MD_PREVIEW_FROM_HOST, ...labels };
        frame()?.contentWindow?.postMessage(renamed, "*");
      },
    );
  }
  let stopListening: (() => void) | null = null;
  const readyListeners: (() => void)[] = [];
  const receive = (data: unknown): void => {
    const message = mdPreviewFrameMessage(data);
    // The frame is not enough: a document can navigate its own frame, and the page it lands on
    // speaks from there. Only the document given this token is heard (#2515).
    const expected = token();
    if (!message || expected === null || message.token !== expected) return;
    // The document cannot open a tab itself (no `allow-popups`); the click's activation reaches
    // this window, so the popup blocker lets this through.
    if (message.kind === "navigate") window.open(message.href, "_blank", "noopener,noreferrer");
    // A link to another file: only the pane knows which document this is, so it resolves it.
    else if (message.kind === "open") openLink(message.href);
    else if (message.kind === "scroll") scrollTop.value = message.scrollY;
    else if (message.kind === "code-block") codeBlocks?.open(message.index);
    // `"*"` because an opaque origin cannot be named as a target: `postMessage` takes a URL, and
    // "null" is not one. What it carries is a scroll offset, into the frame whose window the
    // listener just identified.
    else {
      frame()?.contentWindow?.postMessage(restoreTo(scrollTop.value, codeBlocks ? labelsOf(codeBlocks) : undefined), "*");
      readyListeners.forEach((listener) => listener());
    }
  };
  onMounted(() => {
    stopListening = listenToPreviewFrame(frame, receive);
  });
  onBeforeUnmount(() => {
    stopListening?.();
    stopListening = null;
  });
  // The outline's pick in the Preview (#2576). The document answers with where the heading is, as a
  // scroll report, so the pane remembers that place like any other.
  const goToHeading = (index: number, text: string, occurrence: number): void => {
    const message: MdPreviewHeadingMessage = { source: MD_PREVIEW_FROM_HOST, heading: index, headingText: text, headingOccurrence: occurrence };
    frame()?.contentWindow?.postMessage(message, "*");
  };
  const onReady = (listener: () => void): void => {
    readyListeners.push(listener);
  };
  // The host's remembered place moves too: the document does not report a place it was sent to, so
  // otherwise the next reload (a save) would put back where it was before.
  const goToTop = (): void => {
    scrollTop.value = 0;
    frame()?.contentWindow?.postMessage(restoreTo(0), "*");
  };
  return { goToHeading, goToTop, onReady, codeBlock };
}
