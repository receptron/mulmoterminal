import type { WikiPageEntry } from "@mulmoclaude/core/wiki";

// Aim the filter bar at roughly this many chips; the cutoff floats around it (see below).
export const TARGET_FILTER_CHIPS = 20;

type TagCount = [string, number];

export const tagCounts = (entries: WikiPageEntry[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const entry of entries) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return counts;
};

// A tag on a single page filters nothing, so drop singletons; rank the rest by frequency
// then name so the bar order is stable.
const rankMeaningfulTags = (counts: Map<string, number>): TagCount[] =>
  [...counts.entries()].filter(([, count]) => count > 1).sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB));

// Cut at the count of the target-th tag, keeping equally-popular tags together instead of
// slicing the row at an arbitrary boundary — so the bar can exceed the target on ties.
const adaptiveCutoff = (ranked: TagCount[], target: number): TagCount[] => {
  if (ranked.length <= target) return ranked;
  const cutoffCount = ranked[target - 1][1];
  return ranked.filter(([, count]) => count >= cutoffCount);
};

// Re-append any selected tag the cutoff dropped (e.g. a singleton picked from a card) so
// it stays visible and removable; its count falls back to 1 when absent from the map.
const appendHiddenSelected = (shown: TagCount[], selected: ReadonlySet<string>, counts: Map<string, number>): TagCount[] => {
  const shownTags = new Set(shown.map(([tag]) => tag));
  const hidden = [...selected]
    .filter((tag) => !shownTags.has(tag))
    .sort((a, b) => a.localeCompare(b))
    .map((tag): TagCount => [tag, counts.get(tag) ?? 1]);
  return [...shown, ...hidden];
};

export const filterChips = (entries: WikiPageEntry[], selected: ReadonlySet<string>, target: number = TARGET_FILTER_CHIPS): TagCount[] => {
  const counts = tagCounts(entries);
  const shown = adaptiveCutoff(rankMeaningfulTags(counts), target);
  return appendHiddenSelected(shown, selected, counts);
};

// AND across selected tags: keep entries carrying every selected tag; an empty selection
// matches everything.
export const filterEntriesByTags = (entries: WikiPageEntry[], selected: ReadonlySet<string>): WikiPageEntry[] => {
  if (selected.size === 0) return entries;
  return entries.filter((entry) => {
    const tags = new Set(entry.tags);
    return [...selected].every((tag) => tags.has(tag));
  });
};

// The tags a `?tag=` wiki-index query names, as a set to pre-select. A router query value is
// `string | string[] | null` (repeated `?tag=a&tag=b` → array); non-strings and blanks are
// dropped. Pure so the "open the wiki filtered by #worklog" deep-link is unit-testable.
export const parseTagQuery = (raw: unknown): Set<string> => {
  const values = Array.isArray(raw) ? raw : [raw];
  return new Set(values.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()));
};
