// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  buildNavigateTarget,
  buildPluginData,
  isLegacyNotifierPluginData,
  priorityToSeverity,
  readEntry,
} from "../../../server/backends/collectionNotifierAdapter.js";

// These helpers must stay byte-identical to MulmoClaude's so a bell either app
// published round-trips through the other app's readEntry with the same legacyId.
// The tests below pin the marker recognition, the priority round-trip, and the
// deep-link builder — the three places a divergence would silently double a bell or
// misroute a click.

describe("buildPluginData -> readEntry round-trip", () => {
  it("preserves a high priority", () => {
    const data = buildPluginData({ legacyId: "todo:a/b", slug: "a", itemId: "b", priority: "high" });
    expect(readEntry(data)).toEqual({ legacyId: "todo:a/b", priority: "high" });
  });

  it("preserves a normal priority", () => {
    const data = buildPluginData({ legacyId: "todo:a/b", slug: "a", itemId: "b", priority: "normal" });
    expect(readEntry(data)).toEqual({ legacyId: "todo:a/b", priority: "normal" });
  });

  it("stores high verbatim and anything else as normal", () => {
    expect(buildPluginData({ legacyId: "x", slug: "s", itemId: "i", priority: "high" }).priority).toBe("high");
    expect(buildPluginData({ legacyId: "x", slug: "s", itemId: "i", priority: "normal" }).priority).toBe("normal");
  });
});

describe("readEntry rejects non-marker entries", () => {
  it("returns null for null / non-object", () => {
    expect(readEntry(null)).toBeNull();
    expect(readEntry(undefined)).toBeNull();
    expect(readEntry("todo")).toBeNull();
    expect(readEntry(42)).toBeNull();
  });

  it("returns null when the legacy marker is missing", () => {
    expect(readEntry({ legacyId: "x", kind: "todo" })).toBeNull();
    expect(readEntry({ legacy: false, legacyId: "x", kind: "todo" })).toBeNull();
  });

  it("returns null when legacyId is not a string", () => {
    expect(readEntry({ legacy: true, legacyId: 7, kind: "todo" })).toBeNull();
    expect(readEntry({ legacy: true, kind: "todo" })).toBeNull();
  });

  it("returns null when kind is not a string", () => {
    expect(readEntry({ legacy: true, legacyId: "x", kind: 1 })).toBeNull();
    expect(readEntry({ legacy: true, legacyId: "x" })).toBeNull();
  });
});

describe("isLegacyNotifierPluginData", () => {
  it("is true only for legacy:true + string legacyId + string kind", () => {
    expect(isLegacyNotifierPluginData({ legacy: true, legacyId: "x", kind: "todo" })).toBe(true);
  });

  it("is false when any part of the marker is absent or wrong-typed", () => {
    expect(isLegacyNotifierPluginData(null)).toBe(false);
    expect(isLegacyNotifierPluginData("nope")).toBe(false);
    expect(isLegacyNotifierPluginData({ legacy: false, legacyId: "x", kind: "todo" })).toBe(false);
    expect(isLegacyNotifierPluginData({ legacy: true, legacyId: 1, kind: "todo" })).toBe(false);
    expect(isLegacyNotifierPluginData({ legacy: true, legacyId: "x", kind: 2 })).toBe(false);
    expect(isLegacyNotifierPluginData({ legacyId: "x", kind: "todo" })).toBe(false);
  });
});

describe("buildNavigateTarget", () => {
  it("links to /collections/<slug>?selected=<itemId> for a normal record", () => {
    expect(buildNavigateTarget("tasks", "abc")).toBe("/collections/tasks?selected=abc");
  });

  it("omits the selected query when itemId is empty", () => {
    expect(buildNavigateTarget("tasks", "")).toBe("/collections/tasks");
  });

  it("falls back to the index for dot-segment slugs", () => {
    expect(buildNavigateTarget(".", "abc")).toBe("/collections");
    expect(buildNavigateTarget("..", "abc")).toBe("/collections");
  });

  it("percent-encodes reserved characters in slug and itemId", () => {
    expect(buildNavigateTarget("a b/c", "x?y&z")).toBe("/collections/a%20b%2Fc?selected=x%3Fy%26z");
  });
});

describe("priorityToSeverity", () => {
  it("maps high to urgent", () => {
    expect(priorityToSeverity("high")).toBe("urgent");
  });

  it("maps normal to nudge", () => {
    expect(priorityToSeverity("normal")).toBe("nudge");
  });
});
