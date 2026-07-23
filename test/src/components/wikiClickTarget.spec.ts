import { describe, it, expect } from "vitest";
import type { WikiGraph } from "@mulmoclaude/core/wiki";
import { resolveWikiClickTarget } from "../../../src/components/wikiClickTarget";

// Build deps the way WikiPageView does: fileSlugs / slugByTitle are derived from the same
// nodes, so the fixtures stay internally consistent with a real graph.
const depsFrom = (nodes: { slug: string; title: string }[], graphNull = false) => {
  const graph: WikiGraph | null = graphNull ? null : { nodes, edges: [] };
  return {
    graph,
    fileSlugs: new Set(nodes.map((n) => n.slug)),
    slugByTitle: new Map(nodes.map((n) => [n.title, n.slug] as const)),
  };
};

describe("resolveWikiClickTarget — graph resolution wins first", () => {
  it("returns the graph slug on a direct slug match", () => {
    const deps = depsFrom([{ slug: "alpha", title: "Alpha" }]);
    expect(resolveWikiClickTarget("Alpha", deps)).toBe("alpha");
  });

  // Title match: the graph maps the title to a slug that the plain slugify would NOT produce
  // ("Meeting Notes" → "meeting-notes"). Pins graph-first ordering — trying slugify first
  // would return "meeting-notes" instead of the real "meeting-notes-2026".
  it("returns a title-matched slug that differs from the slugified target", () => {
    const deps = depsFrom([{ slug: "meeting-notes-2026", title: "Meeting Notes" }]);
    expect(resolveWikiClickTarget("Meeting Notes", deps)).toBe("meeting-notes-2026");
  });
});

describe("resolveWikiClickTarget — slugify fallback when the graph misses", () => {
  it("falls back to the slugified target and returns it when safe", () => {
    const deps = depsFrom([{ slug: "other", title: "Other" }]);
    expect(resolveWikiClickTarget("Unknown Page", deps)).toBe("unknown-page");
  });
});

describe("resolveWikiClickTarget — safety gate on the fallback", () => {
  // A non-ASCII target slugifies to "" (empty is unsafe), so neither the graph nor the
  // fallback yields a slug. Returns null instead of a bogus route.
  it("returns null when the graph misses and the fallback is unsafe", () => {
    const deps = depsFrom([{ slug: "other", title: "Other" }]);
    expect(resolveWikiClickTarget("日本語", deps)).toBeNull();
  });
});

describe("resolveWikiClickTarget — graph guard (null graph skips the resolver)", () => {
  it("uses the fallback, not the resolver, when graph is null", () => {
    // fileSlugs / slugByTitle are populated, but graph === null must short-circuit the
    // resolver — so the title match ("meeting-notes-2026") is NOT taken; the safe slugify
    // fallback ("meeting-notes") is returned instead.
    const deps = depsFrom([{ slug: "meeting-notes-2026", title: "Meeting Notes" }], true);
    expect(resolveWikiClickTarget("Meeting Notes", deps)).toBe("meeting-notes");
  });

  it("returns null when graph is null and the fallback is unsafe", () => {
    const deps = depsFrom([], true);
    expect(resolveWikiClickTarget("***", deps)).toBeNull();
  });
});
