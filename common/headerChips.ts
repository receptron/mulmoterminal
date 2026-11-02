import { isRecord } from "./isRecord.js";

// The header's info chips as Settings edits them (#2622): one entry at a time, against the list on
// disk, the way the custom agents and accounts are changed.
//
// An UNCONFIGURED list (`null`) is not an empty one — the cell shows its default set. So the first
// change to it starts from that set: removing `ctx` from a header nobody configured must leave the
// other defaults, not a header with nothing on it.

export const MAX_HEADER_CHIPS = 16;

/** The built-in chips a terminal cell draws, in the order an unconfigured header shows them. */
export const CELL_CHIP_IDS = ["git", "work", "diff", "ctx", "usage", "env", "peer"] as const;
export type CellChipId = (typeof CELL_CHIP_IDS)[number];
export const isCellChipId = (value: unknown): value is CellChipId => CELL_CHIP_IDS.some((id) => id === value);

export interface CustomChip {
  label: string;
  text: string;
  when?: string | undefined;
}
/** A built-in chip's id, or a chip of the user's own. */
export type ChipEntry = string | CustomChip;

export const isChipEntry = (value: unknown): value is ChipEntry => {
  if (typeof value === "string") return true;
  if (!isRecord(value) || typeof value.label !== "string" || typeof value.text !== "string") return false;
  return value.when === undefined || typeof value.when === "string";
};

export const CHIP_PROBLEMS = ["builtin", "duplicate", "label", "text", "full", "stale"] as const;
export type ChipProblem = (typeof CHIP_PROBLEMS)[number];
export const isChipProblem = (value: unknown): value is ChipProblem => CHIP_PROBLEMS.some((problem) => problem === value);

type Changed = { chips: ChipEntry[] } | { problem: ChipProblem };

export interface ChipDraft {
  builtin: string;
  label: string;
  text: string;
  when: string;
}

/** The list a change starts from: the configured one, or the default set when there is none. */
export const effectiveChips = (current: readonly ChipEntry[] | null): ChipEntry[] => [...(current ?? CELL_CHIP_IDS)];

export const sameChip = (a: ChipEntry, b: ChipEntry): boolean => {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.label === b.label && a.text === b.text && (a.when ?? "") === (b.when ?? "");
};

function chipFromDraft(draft: ChipDraft): { entry: ChipEntry } | { problem: ChipProblem } {
  const builtin = draft.builtin.trim();
  if (builtin) return isCellChipId(builtin) ? { entry: builtin } : { problem: "builtin" };
  const label = draft.label.trim();
  const text = draft.text.trim();
  if (!label) return { problem: "label" };
  if (!text) return { problem: "text" };
  const when = draft.when.trim();
  return { entry: when ? { label, text, when } : { label, text } };
}

export function chipsWithAdded(current: readonly ChipEntry[] | null, draft: ChipDraft): Changed {
  const built = chipFromDraft(draft);
  if ("problem" in built) return built;
  const chips = effectiveChips(current);
  if (chips.length >= MAX_HEADER_CHIPS) return { problem: "full" };
  if (typeof built.entry === "string" && chips.includes(built.entry)) return { problem: "duplicate" };
  return { chips: [...chips, built.entry] };
}

// `expected` is the chip the caller saw at `index`. Anything else there means the list changed since
// it loaded — another tab, another MulmoTerminal, a hand-edit — and acting on the index would hit a
// different chip than the one that was pressed.
function isAt(chips: readonly ChipEntry[], index: number, expected: ChipEntry): boolean {
  const found = Number.isInteger(index) && index >= 0 ? chips[index] : undefined;
  return found !== undefined && sameChip(found, expected);
}

export function chipsWithout(current: readonly ChipEntry[] | null, index: number, expected: ChipEntry): Changed {
  const chips = effectiveChips(current);
  if (!isAt(chips, index, expected)) return { problem: "stale" };
  return { chips: chips.filter((_, i) => i !== index) };
}

interface Swap {
  index: number;
  target: number;
  moving: ChipEntry;
  neighbour: ChipEntry;
}
function swapped(chip: ChipEntry, i: number, swap: Swap): ChipEntry {
  if (i === swap.index) return swap.neighbour;
  return i === swap.target ? swap.moving : chip;
}

export function chipsMoved(current: readonly ChipEntry[] | null, index: number, delta: -1 | 1, expected: ChipEntry): Changed {
  const chips = effectiveChips(current);
  const target = index + delta;
  const neighbour = chips[target];
  if (!isAt(chips, index, expected) || target < 0 || neighbour === undefined) return { problem: "stale" };
  return { chips: chips.map((chip, i) => swapped(chip, i, { index, target, moving: expected, neighbour })) };
}
