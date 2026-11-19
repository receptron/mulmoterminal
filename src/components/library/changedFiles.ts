// What the reader shows of the files a conversation changed (#3330). Pure.
import { NOW_VERSION, type LibraryTrackedFile } from "../../../common/libraryFiles";

/** One diff to show: from a kept version to a later one, or to the file as it is now. */
export interface DiffStep {
  key: string;
  from: number;
  to: number | typeof NOW_VERSION;
}

/** The whole change first (the first kept version to now), then each turn's change in order, the
 *  last one ending at the file as it is now. One version has only the whole. */
export function diffSteps(file: LibraryTrackedFile): DiffStep[] {
  const versions = file.versions.map((kept) => kept.version);
  const first = versions[0];
  if (first === undefined) return [];
  const whole: DiffStep = { key: "whole", from: first, to: NOW_VERSION };
  if (versions.length === 1) return [whole];
  const ends = [...versions.slice(1), NOW_VERSION] as const;
  return [whole, ...ends.map((to, index): DiffStep => ({ key: `${String(versions[index])}-${String(to)}`, from: versions[index] ?? first, to }))];
}

/** Segments kept of a path outside the conversation's directory: its folder and its name. */
const OUTSIDE_SEGMENTS = 2;

/** The path as a person reads it: inside the conversation's directory relative to it; outside, its
 *  last folder and name after `…/`, since a row cut off from the left would hide the name. */
export function shownPath(file: LibraryTrackedFile, cwd: string | null): string {
  const full = file.path ?? file.trackingPath;
  const inside = cwd === null ? undefined : [`${cwd}/`, `${cwd}\\`].find((prefix) => full.startsWith(prefix));
  if (inside !== undefined) return full.slice(inside.length);
  const segments = full.split(/[\\/]/).filter((segment) => segment !== "");
  return segments.length > OUTSIDE_SEGMENTS ? `…/${segments.slice(-OUTSIDE_SEGMENTS).join("/")}` : full;
}
