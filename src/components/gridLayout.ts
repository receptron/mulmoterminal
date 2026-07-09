// Grid layout definitions shared by App (the picker) and TerminalGrid.

// Ordered smallest→largest: the grid grows through these as terminals are added.
export const LAYOUTS = ["1", "2", "2x2", "3x2", "4x2", "3x3"] as const;
export type Layout = (typeof LAYOUTS)[number];

// cols × rows per layout. Max cells is 9 (3x3), which bounds the persisted arrays.
const DIMS: Record<Layout, { cols: number; rows: number }> = {
  "1": { cols: 1, rows: 1 },
  "2": { cols: 2, rows: 1 },
  "2x2": { cols: 2, rows: 2 },
  "3x2": { cols: 3, rows: 2 },
  "4x2": { cols: 4, rows: 2 },
  "3x3": { cols: 3, rows: 3 },
};

export const MAX_CELLS = 9;

export function isLayout(v: unknown): v is Layout {
  return typeof v === "string" && (LAYOUTS as readonly string[]).includes(v);
}

export function dims(layout: Layout) {
  const { cols, rows } = DIMS[layout];
  return { cols, rows, cellCount: cols * rows };
}

// The smallest layout whose cells fit `count` terminals (clamped to 1..MAX_CELLS).
// Drives the auto-growing grid: 1→"1", 2→"2", 3-4→"2x2", 5-6→"3x2", 7-8→"4x2", 9→"3x3".
export function layoutForCount(count: number): Layout {
  const n = Math.max(1, Math.min(MAX_CELLS, Math.floor(count)));
  return LAYOUTS.find((l) => dims(l).cellCount >= n) ?? "3x3";
}

// CSS grid track template for the layout: equal tracks, one per cell.
export function trackStyle(layout: Layout) {
  const { cols, rows } = dims(layout);
  const tracks = (count: number) => Array.from({ length: count }, () => "1fr").join(" ");
  return { gridTemplateColumns: tracks(cols), gridTemplateRows: tracks(rows), gap: "6px" };
}
