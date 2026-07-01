import { worktreeLabel } from "./cwdDisplay";

// A directory preset offered as a one-click chip in the cell launch form.
// The list is auto-populated from the dirs the user launches in (see
// useAppConfig.recordPreset) and pruned with the chip's ✕.
export interface CwdPreset {
  label: string;
  path: string;
}

// Chip label for an auto-recorded dir: a managed worktree shows
// "repo (task)"; any other path shows its trailing segment (basename).
export function presetLabel(path: string): string {
  const wt = worktreeLabel(path);
  if (wt) return `${wt.repo} (${wt.task})`;
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
