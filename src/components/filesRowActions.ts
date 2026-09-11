// The file-tree row menu's rules: what a right-click on a row offers, and how the keyboard moves
// through it once it is open (#1859). Typing a path by hand was the only way to say "look at this
// file" to the agent running next to the tree that already shows it.
//
// Pure, and separate from the pane, because every rule here is about a path resolving somewhere
// OTHER than where it was clicked — which is precisely what a DOM test would not catch.
import { toInsertText } from "./dropPaths";
import { absoluteUnder, canOpenInCanvas, type StoriesRoots } from "../composables/canvasOpenFile";

interface RowActionChrome {
  label: string;
  /** Material Symbols ligature. */
  icon: string;
}

/** Discriminated on `id` because the two carry different payloads and neither is optional: an
 *  insert is only ever a string for the terminal, and the Canvas entry has no such string at all.
 *  Widening `text` to `string | undefined` instead would let a caller send an empty one. */
export type FilesRowAction =
  | (RowActionChrome & {
      id: "insert-relative" | "insert-absolute";
      /** Exactly what goes to the terminal — quoted and space-terminated by `toInsertText`. */
      text: string;
    })
  | (RowActionChrome & {
      id: "reveal";
      /** ABSOLUTE, because the route spawns an OS command and takes nothing else — unlike the
       *  Canvas entry, whose receiver resolves against the pane's cwd. */
      pathAbs: string;
    })
  | (RowActionChrome & {
      id: "open-canvas";
      /** RELATIVE to the tree's root, which is what `open-in-canvas` already carries from the
       *  pane's own button — the receiver resolves it against the pane's cwd, so an absolute one
       *  would be resolved twice. */
      pathRel: string;
    });

export interface FilesRowTarget {
  /** The row's path, relative to the tree's root. */
  pathRel: string;
  /** Whether the row is a directory. Decides both the wording and what the file manager is asked
   *  to do — a folder is opened, a file is selected inside its own. */
  isDir: boolean;
  /** The tree's root. */
  cwd: string | null;
  /** The terminal an insert goes to, or null where there is none — the full-screen Files view. */
  terminal: { cwd: string | null } | null;
  /** Where a Canvas could be opened, or null where there is no cell to put one beside. Separate
   *  from `terminal` because the pane keeps its own two props for these: it can trail a cell after
   *  a declined re-root, so "a terminal to insert into" and "a cell to draw beside" genuinely part
   *  company. `roots` is consulted for stories only (see canOpenInCanvas). */
  canvas: { roots: StoriesRoots } | null;
}

// The same icon for both, and it is the one the header's "Insert a file path" button already
// uses: these are that button's job reached from the tree, and telling them apart is the label's
// work, not an icon's.
const ICON = "attach_file";

// Its own, because this is a different job from the two inserts — not the same job reached from
// the tree. The Canvas panel's own icon.
const CANVAS_ICON = "space_dashboard";

// The OS's own window, not ours — the same glyph the header uses for a cell's working directory.
const REVEAL_ICON = "folder_open";

// Compared without a trailing separator, because `absoluteUnder` JOINS without doubling one: a
// root spelled `/proj/` builds the same absolute path as `/proj`, so it has to answer the same
// here too. The two roots reach this function from different cells, so nothing guarantees one
// spelling. (CodeRabbit, PR #1912 — no entry point that produces the asymmetry was found, so
// this is the two halves of the module agreeing rather than a fix for an observed case.)
const withoutTrailingSeparator = (dir: string): string => (dir.endsWith("/") || dir.endsWith("\\") ? dir.slice(0, -1) : dir);

/**
 * The menu for one row. Empty means no menu at all — the caller leaves the browser's own.
 *
 * A LIST rather than two booleans so a later action (a text file's contents, say) is an entry
 * here and nothing else.
 */
export function filesRowActions({ pathRel, isDir, cwd, terminal, canvas }: FilesRowTarget): FilesRowAction[] {
  // No root means no path worth offering: the tree is on the server's default and its rows cannot
  // be resolved against anything the terminal — or the plugins' file layer — knows.
  if (pathRel === "" || cwd === null) return [];
  const actions: FilesRowAction[] = [];
  // First, because "show me this" is the stronger reason to right-click a row than "type its path"
  // — it is what #1374 exists for — and a keyboard opening focuses the first item.
  //
  // Asked of canOpenInCanvas rather than answered here: a second opinion could only be a weaker
  // one, reporting success for a file that then renders nothing (canvasOpenFile.ts says so at
  // length). Which is also why a mulmoScript inside a PROJECT is absent — the plugin resolves
  // stories against the workspace alone (receptron/mulmoclaude#3014).
  if (canvas && canOpenInCanvas(absoluteUnder(cwd, pathRel), canvas.roots)) {
    actions.push({ id: "open-canvas", label: "Open in the Canvas", icon: CANVAS_ICON, pathRel });
  }
  // Second: this is how a file LEAVES the app. Not for reading it — for dragging it into a mail
  // composer or an upload form, or for dropping a file too big to paste into a folder the agent
  // reads (#2039). Offered on every row, including in the full-screen view that has no terminal,
  // because neither use needs one.
  actions.push({
    id: "reveal",
    label: isDir ? "Open this folder" : "Show in folder",
    icon: REVEAL_ICON,
    pathAbs: absoluteUnder(cwd, pathRel),
  });
  if (terminal === null) return actions;
  // Only when a relative path means the same thing at the other end. The pane keeps the cell it
  // is on when a re-root could not be saved out of, so the tree and the terminal on screen can
  // be two different projects — and `src/index.ts` would then name a file in the wrong one.
  if (terminal.cwd !== null && withoutTrailingSeparator(terminal.cwd) === withoutTrailingSeparator(cwd)) {
    actions.push({ id: "insert-relative", label: "Insert relative path", icon: ICON, text: toInsertText([pathRel]) });
  }
  actions.push({ id: "insert-absolute", label: "Insert absolute path", icon: ICON, text: toInsertText([absoluteUnder(cwd, pathRel)]) });
  return actions;
}

/**
 * Where the arrow keys move focus inside the open menu, or null for a key that is not ours.
 *
 * `at` is the currently focused item's index, or -1 when focus is somewhere else in the menu —
 * which is why Down and Up answer the two ENDS from there rather than an offset from nowhere.
 */
export function menuFocusMove(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  const last = count - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  // Wrapping, because a menu this short is faster to leave by going round than by reversing.
  if (key === "ArrowDown") return at < 0 || at === last ? 0 : at + 1;
  if (key === "ArrowUp") return at <= 0 ? last : at - 1;
  return null;
}
