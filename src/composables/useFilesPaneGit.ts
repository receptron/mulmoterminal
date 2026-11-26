// The Files pane's view of git: what git sees under the root (#2496), the open file's changes against
// HEAD beside its lines (#2497), and its earlier versions (#2574).
import { computed, ref, watch } from "vue";
import { gitDecorations } from "../components/filesGitDecorations";
import { useFilesGitStatus } from "./useFilesGitStatus";
import { useFileHeadText } from "./useFileHeadText";
import { useFileHistory } from "./useFileHistory";
import type { OpenFile } from "./useOpenFile";

export type PaneGitFile = Pick<OpenFile, "openPath" | "unpreviewable" | "dirty" | "saving" | "showPreview" | "baseVersion" | "editor">;

export function useFilesPaneGit(cwd: () => string | null, file: PaneGitFile, host: () => string | null = () => null) {
  const { openPath, unpreviewable, dirty, saving, showPreview } = file;
  // Read again whenever the open file's version moves — a save or an outside change landing — as
  // well as on its own period.
  const gitStatus = useFilesGitStatus(cwd, host);
  const git = computed(() => gitDecorations(gitStatus.files.value));
  watch(file.baseVersion, () => void gitStatus.refresh());

  // Read again whenever the open file is read, and whenever what git sees moves — an agent's commit
  // changes HEAD without touching the file.
  const head = useFileHeadText({ cwd, host, openPath, unpreviewable, editor: file.editor });
  // The path as well as the version: two files with the same content share a version, and switching
  // between them moves only the path.
  watch([openPath, file.baseVersion], () => void head.refresh());
  watch(gitStatus.files, () => void head.refresh());
  // Removed lines shown in place, as a unified diff, rather than marks alone — the reader's choice
  // for the whole pane, kept as they move between files.
  const showChanges = ref(false);
  watch(showChanges, (on) => file.editor.value?.setShowChanges(on));
  // Compared through the same marks and restored as an edit.
  const history = useFileHistory({ cwd, host, openPath, editor: file.editor, head, showChanges, dirty, saving });
  // Preview hides the menu's button; the menu must not come back by itself on returning to Edit.
  watch(showPreview, () => history.close());
  return { gitStatus, git, head, showChanges, history };
}
