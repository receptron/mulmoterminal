// What the Files pane hands its host to put back later, and what the host hands back. Its own
// module because three parties decide from it and none of them owns it: the pane fills it, the grid
// files it per cell, and `filesPaneStore` puts it in localStorage per directory — a shape that
// outlives the component it used to live in (#2158).
import type { CaretAt } from "./cmEditor";

/** What a host hands back so a revisited directory looks the way it was left. */
export interface FilesPaneState {
  openPath: string | null;
  expanded: string[];
  /** Whether the open file was being READ in the Markdown preview rather than edited (#2137).
   *  Optional because nothing written before this existed carries one, and a pane that has never
   *  been anywhere near a preview should not have to say so — absent is the editor. */
  showPreview?: boolean;
  /** Where the reader was in `openPath`, so coming back does not mean finding the line again
   *  (#2149). A place in the file, not a pixel: the pane is often a different width next time. */
  caret?: CaretAt | undefined;
  /** The line that was at the TOP of the editor. Kept beside the caret because scrolling moves
   *  neither the selection nor the caret — a reader who never clicks has a caret on line 1 while
   *  reading line 130, and the caret alone would put them back at the top of the file. */
  topLine?: number | undefined;
  /** How far down the tree was scrolled. The expanded directories are remembered already, so the
   *  same rows come back — this is which of them were on screen. */
  treeScrollTop?: number;
}
