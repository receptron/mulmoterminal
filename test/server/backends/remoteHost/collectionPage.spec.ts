// @vitest-environment node
import { describe, it, expect } from "vitest";

import { pageResult, deriveItems } from "../../../../server/backends/remoteHost/collectionPage.js";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("pageResult", () => {
  it("slices the first page and echoes offset/limit", () => {
    const result = pageResult({ slug: "c" }, rows(10), 0, 5);
    expect(result.items).toEqual(rows(5));
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(5);
    expect(result.collection).toEqual({ slug: "c" });
  });

  it("slices a middle page by offset", () => {
    const result = pageResult(null, rows(10), 5, 5);
    expect(result.items).toEqual([{ id: 5 }, { id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }]);
  });

  // `total` is the FULL record count, never the page's length. The mobile client renders
  // "showing N of TOTAL" from it, so a regression to the sliced length silently breaks paging —
  // the last short page would claim it is the whole collection.
  it("reports the full total even when the page is short", () => {
    const result = pageResult(null, rows(10), 8, 5);
    expect(result.items).toEqual([{ id: 8 }, { id: 9 }]); // only 2 remain
    expect(result.total).toBe(10); // ...but total stays 10
  });

  it("returns an empty page past the end while keeping total and the echoed offset", () => {
    const result = pageResult(null, rows(10), 20, 5);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(10);
    expect(result.offset).toBe(20);
    expect(result.limit).toBe(5);
  });

  it("returns nothing for a zero limit", () => {
    const result = pageResult(null, rows(10), 0, 0);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(10);
  });

  it("handles an empty collection", () => {
    const result = pageResult(null, [], 0, 50);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("deriveItems", () => {
  // With no derivable fields the derive pass is a no-op, so each record passes through with its
  // stored fields intact — same records, same order.
  it("passes records through unchanged when the schema declares no fields", () => {
    expect(deriveItems({ fields: {} }, [{ a: 1 }, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
  });

  // The `schema.fields ?? {}` default: a schema with no `fields` key must not throw.
  it("tolerates a schema with no fields key", () => {
    expect(deriveItems({}, [{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it("returns an empty array for no items", () => {
    expect(deriveItems({ fields: {} }, [])).toEqual([]);
  });
});
