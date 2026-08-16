import { computed, type ComputedRef } from "vue";
import type { RightPane } from "./gridCell";

// What each cell already receives: all four are GRID state (see GridCellProps), which is why every
// cell type forwards exactly the same set.
export interface CellChromeSource {
  expanded: boolean;
  filesOpen?: boolean | undefined;
  rightPane?: RightPane | null | undefined;
  canvasAvailable?: boolean | undefined;
  collectionsAvailable?: boolean | undefined;
}

// The two booleans are resolved rather than passed through as `boolean | undefined`: under
// `exactOptionalPropertyTypes` an explicit `undefined` is not assignable to CellChromeButtons'
// `filesOpen?: boolean`, and it reads every one of them as a truthiness test — so absent and false
// were already the same answer there.
export interface CellChromeProps {
  expanded: boolean;
  filesOpen: boolean;
  rightPane: RightPane | null;
  canvasAvailable: boolean;
  collectionsAvailable: boolean;
}

// EVERY event CellChromeButtons can raise, minus the ones a cell binds itself (`toggle-park`,
// which only a session terminal has). A button whose event is missing HERE is dead: the cell
// binds `v-on="chromeEvents"`, so an emit with no entry is dropped silently — the grid's own
// handler waits for something nothing ever sends it. That is what happened to the collections
// button, which shipped in #1573 and never once opened the pane. `cellChromeEventsAreComplete`
// in the spec pins the two lists together so the next button cannot repeat it.
export type CellChromeEvent =
  "toggle-expand" | "toggle-files" | "toggle-canvas" | "toggle-tools" | "toggle-collections" | "toggle-github" | "toggle-prompts" | "close";

// Every event that is a PLAIN forward, which is all of them but `close` — the one a cell may want
// to intercept. Spelling them once means a new button reaches both bindings together; when each
// spelled its own set, the two could disagree and only the cell type nobody opened would show it.
type CellChromeToggle = Exclude<CellChromeEvent, "close">;

const toggleForwards = (emit: (event: CellChromeToggle) => void): Record<CellChromeToggle, () => void> => ({
  "toggle-expand": () => emit("toggle-expand"),
  "toggle-files": () => emit("toggle-files"),
  "toggle-canvas": () => emit("toggle-canvas"),
  "toggle-tools": () => emit("toggle-tools"),
  "toggle-collections": () => emit("toggle-collections"),
  "toggle-github": () => emit("toggle-github"),
  "toggle-prompts": () => emit("toggle-prompts"),
});

// Bound as two objects rather than spelled out in each template.
//
// The command, launcher and terminal cells wired the same four props and the same five events, and
// TerminalCell did it twice (its cockpit header and its normal header) — four copies that all had
// to agree, so adding a fifth button meant remembering every one of them.
//
// `close` is the one that genuinely differs: TerminalCell's confirms before tearing down a live
// session (#826). So it is a parameter rather than an assumption, and the default is the plain
// forward the other two want.
export function cellChromeBinding(
  source: CellChromeSource,
  emit: (event: CellChromeEvent) => void,
  close: () => void = () => emit("close"),
): { chromeProps: ComputedRef<CellChromeProps>; chromeEvents: Record<CellChromeEvent, () => void> } {
  return {
    chromeProps: computed(() => ({
      expanded: source.expanded,
      filesOpen: source.filesOpen ?? false,
      rightPane: source.rightPane ?? null,
      canvasAvailable: source.canvasAvailable ?? false,
      // Absent means NOT available, so a cell type that forgets to forward it hides the button
      // rather than offering one onto a store its agent cannot reach.
      collectionsAvailable: source.collectionsAvailable ?? false,
    })),
    chromeEvents: {
      ...toggleForwards(emit),
      close,
    },
  };
}

// The other half of the same idea, for CellShell: a non-agent cell forwards every event the shell
// raises straight up to the grid, unchanged. One object so the two callers do not each re-spell
// seven identical handlers — which is exactly what CellShell was extracted to stop.
export type CellShellEvent = CellChromeEvent | "move";

export function cellShellEvents(emit: {
  (event: CellChromeEvent): void;
  (event: "move", dir: -1 | 1): void;
}): Record<CellChromeEvent, () => void> & { move: (dir: -1 | 1) => void } {
  return {
    ...toggleForwards(emit),
    close: () => emit("close"),
    move: (dir: -1 | 1) => emit("move", dir),
  };
}
