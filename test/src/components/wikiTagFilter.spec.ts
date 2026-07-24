import { describe, it, expect } from "vitest";
import type { WikiPageEntry } from "@mulmoclaude/core/wiki";
import { tagCounts, filterChips, filterEntriesByTags, parseTagQuery, TARGET_FILTER_CHIPS } from "../../../src/components/wikiTagFilter";

const entry = (slug: string, tags: string[]): WikiPageEntry => ({ title: slug, slug, description: "", tags });

// One page per repetition, each carrying a single tag, so every tag lands at exactly its
// configured count with no overlap — handy for exercising the ranking/cutoff rules.
const entriesFromCounts = (counts: Record<string, number>): WikiPageEntry[] =>
  Object.entries(counts).flatMap(([tag, n]) => Array.from({ length: n }, (_, i) => entry(`${tag}-p${i}`, [tag])));

const names = (chips: [string, number][]): string[] => chips.map(([tag]) => tag);

describe("tagCounts", () => {
  it("aggregates per-tag page counts across entries", () => {
    const counts = tagCounts([entry("a", ["x", "y"]), entry("b", ["x"]), entry("c", ["y"]), entry("d", ["x", "y", "z"])]);
    expect(counts.get("x")).toBe(3);
    expect(counts.get("y")).toBe(3);
    expect(counts.get("z")).toBe(1);
    expect(counts.size).toBe(3);
  });

  it("returns an empty map for no entries", () => {
    expect(tagCounts([]).size).toBe(0);
  });

  it("does not mutate the entries' tag arrays", () => {
    const entries = [entry("a", ["x", "y"])];
    tagCounts(entries);
    expect(entries[0].tags).toEqual(["x", "y"]);
  });
});

describe("filterChips", () => {
  it("drops singleton tags (a tag on one page) from the bar", () => {
    const chips = filterChips([entry("a", ["shared", "solo"]), entry("b", ["shared"])], new Set());
    expect(names(chips)).toEqual(["shared"]);
  });

  it("sorts by count desc, then name asc on ties", () => {
    const chips = filterChips(entriesFromCounts({ zed: 3, beta: 2, alpha: 2 }), new Set());
    expect(names(chips)).toEqual(["zed", "alpha", "beta"]);
  });

  it("keeps tags tied at the cutoff position together (adaptive, not a fixed slice)", () => {
    // Ranks 1-19 get distinct descending counts; ranks 20, 21, 22 all tie at 5. A plain
    // slice(0, 20) would keep only the first of the tied group; the adaptive cutoff keeps
    // all three because the cutoff is the *count* at the target position.
    const counts: Record<string, number> = {};
    Array.from({ length: 19 }, (_, i) => (counts[`t${String(i).padStart(2, "0")}`] = 30 - i));
    counts["t19"] = 5;
    counts["t20"] = 5;
    counts["t21"] = 5;
    const chips = filterChips(entriesFromCounts(counts), new Set());
    expect(chips).toHaveLength(22);
    expect(names(chips)).toContain("t20");
    expect(names(chips)).toContain("t21");
    expect(TARGET_FILTER_CHIPS).toBe(20);
  });

  it("keeps the tied boundary group with an explicit small target too", () => {
    const chips = filterChips(entriesFromCounts({ a: 5, b: 3, c: 3, d: 2 }), new Set(), 2);
    // target 2 → cutoff is b's count (3); both b and c survive, d (count 2) does not.
    expect(names(chips)).toEqual(["a", "b", "c"]);
  });

  it("restores a cutoff-hidden selected tag at the tail with count fallback 1", () => {
    const entries = [entry("a", ["shared", "solo"]), entry("b", ["shared"])];
    const chips = filterChips(entries, new Set(["solo"]));
    expect(chips).toEqual([
      ["shared", 2],
      ["solo", 1],
    ]);
  });

  it("appends selected tags absent from any page with count 1, sorted by name", () => {
    const entries = [entry("a", ["shared"]), entry("b", ["shared"])];
    const chips = filterChips(entries, new Set(["zeta", "alpha"]));
    expect(chips).toEqual([
      ["shared", 2],
      ["alpha", 1],
      ["zeta", 1],
    ]);
  });
});

describe("filterEntriesByTags", () => {
  const entries = [entry("a", ["x", "y"]), entry("b", ["x"]), entry("c", ["y"]), entry("d", ["x", "y", "z"])];

  it("returns all entries when nothing is selected", () => {
    expect(filterEntriesByTags(entries, new Set())).toBe(entries);
  });

  it("keeps only entries carrying every selected tag (AND)", () => {
    const kept = filterEntriesByTags(entries, new Set(["x", "y"]));
    expect(kept.map((e) => e.slug)).toEqual(["a", "d"]);
  });

  it("keeps every entry with a single selected tag", () => {
    const kept = filterEntriesByTags(entries, new Set(["x"]));
    expect(kept.map((e) => e.slug)).toEqual(["a", "b", "d"]);
  });

  it("returns nothing when no entry carries all selected tags", () => {
    expect(filterEntriesByTags(entries, new Set(["x", "y", "z", "missing"]))).toEqual([]);
  });
});

describe("parseTagQuery", () => {
  it("reads a single tag from a string query", () => {
    expect([...parseTagQuery("worklog")]).toEqual(["worklog"]);
  });

  it("reads repeated tags from an array query", () => {
    expect([...parseTagQuery(["worklog", "notes"])]).toEqual(["worklog", "notes"]);
  });

  it("trims whitespace and drops blank / non-string values", () => {
    expect([...parseTagQuery(["  worklog  ", "", "   ", 5, null])]).toEqual(["worklog"]);
  });

  it("is empty for null / undefined / a blank string (no filter)", () => {
    expect(parseTagQuery(null).size).toBe(0);
    expect(parseTagQuery(undefined).size).toBe(0);
    expect(parseTagQuery("").size).toBe(0);
  });

  it("de-duplicates repeated tags", () => {
    expect([...parseTagQuery(["worklog", "worklog"])]).toEqual(["worklog"]);
  });
});
