// The Files pane's side of the Markdown Preview's wire: where the reader is, what to open, and which
// code block to show (#2157, #2268, #2615). Preview is an iframe the pane cannot read into, so all of it
// arrives by message from the document's own reporter.
import { useTemplateRef, type ComputedRef, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useMdPreviewScroll, type MdPreviewScroll } from "./useMdPreviewScroll";
import type { FilePreviewKind } from "../components/filePreviewKind";

/** The parts of the open file the wire reads. */
interface PreviewedFile {
  openPath: Ref<string | null>;
  previewKind: ComputedRef<FilePreviewKind | null>;
  previewScrollTop: Ref<number>;
  previewToken: ComputedRef<string | null>;
}

/** Called from setup: the frame is the template's `ref="previewFrame"`. */
export function useFilesPreviewWire(file: PreviewedFile, openLink: (href: string) => void, cwd: () => string | null): MdPreviewScroll {
  const { t } = useI18n();
  const previewFrame = useTemplateRef<HTMLIFrameElement>("previewFrame");
  // The wire hears the frame only while a MARKDOWN document was put in it: that document's one script
  // is the server's nonce'd reporter. An HTML page runs its own scripts and could ask the host to open
  // a browser tab or another file (#2269 review), so while one is up the wire hears no frame at all.
  // Which DOCUMENT is in the frame is settled by the token its reporter stamps (#2515): a Markdown file
  // nobody sanitised can navigate its own frame elsewhere, and that page never had the token.
  return useMdPreviewScroll(
    () => (file.previewKind.value === "markdown" ? previewFrame.value : null),
    file.previewScrollTop,
    openLink,
    () => file.previewToken.value,
    { cwd, openPath: () => file.openPath.value, label: () => t("previewCodeCopy.button"), diagramSourceLabel: () => t("previewCodeCopy.diagramSource") },
  );
}
