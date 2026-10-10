// The Preview's code-block button (#2615): a press names a block's number, and the block is read
// from the file for the dialog. Only the latest press is shown, and only while that file is open.
import { ref, watch, type Ref } from "vue";
import { previewCodeBlockAt, type CodeBlockLookup } from "../components/previewCodeBlockApi";
/** The Preview's code-block buttons: what a press opens, what the buttons are called, and what the
 *  disclosure that keeps a diagram's block reachable is called (#2991). */
export interface PreviewCodeBlockHost {
  open: (index: number) => void;
  label: () => string;
  diagramSourceLabel: () => string;
}

export interface PreviewCodeBlockDeps {
  cwd: () => string | null;
  openPath: () => string | null;
  label: () => string;
  diagramSourceLabel: () => string;
}

/** What the Files pane holds for the code-block dialog — not a block itself (see common/previewCodeBlocks.ts). */
export interface PreviewCodeBlockDialogState {
  host: PreviewCodeBlockHost;
  shown: Ref<CodeBlockLookup | null>;
  close: () => void;
}

export function usePreviewCodeBlock(deps: PreviewCodeBlockDeps): PreviewCodeBlockDialogState {
  const shown = ref<CodeBlockLookup | null>(null);
  let latest = 0;
  const open = async (index: number): Promise<void> => {
    const path = deps.openPath();
    if (!path) return;
    const request = ++latest;
    const lookup = await previewCodeBlockAt(deps.cwd(), path, index);
    if (request === latest) shown.value = lookup;
  };
  // Another file, or the same name under another root: a block read for the old one is not this one's.
  watch([deps.cwd, deps.openPath], () => {
    latest += 1;
    shown.value = null;
  });
  // Closing retires a read still out, as a change of file does: its answer must not reopen the dialog.
  const close = (): void => {
    latest += 1;
    shown.value = null;
  };
  return { host: { open: (index) => void open(index), label: deps.label, diagramSourceLabel: deps.diagramSourceLabel }, shown, close };
}
