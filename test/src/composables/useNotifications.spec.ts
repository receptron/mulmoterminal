import { describe, it, expect } from "vitest";
import { parseCollectionTarget } from "./useNotifications";

describe("parseCollectionTarget", () => {
  it("parses slug + selected itemId", () => {
    expect(parseCollectionTarget("/collections/todo?selected=item-1")).toEqual({ slug: "todo", itemId: "item-1" });
  });

  it("parses a bare slug with no record", () => {
    expect(parseCollectionTarget("/collections/todo")).toEqual({ slug: "todo", itemId: undefined });
  });

  it("decodes percent-encoded slug + itemId", () => {
    expect(parseCollectionTarget("/collections/my%20col?selected=a%2Fb")).toEqual({ slug: "my col", itemId: "a/b" });
  });

  it("ignores unrelated query params and keeps selected", () => {
    expect(parseCollectionTarget("/collections/todo?selected=x&notificationId=y")).toEqual({ slug: "todo", itemId: "x" });
  });

  it("does not double-decode a selected id containing a literal percent", () => {
    // URLSearchParams already decodes %25%20 → "% ". A second decodeURIComponent
    // would throw "URI malformed" on the resulting "100% done".
    expect(parseCollectionTarget("/collections/annual?selected=100%25%20done")).toEqual({ slug: "annual", itemId: "100% done" });
  });

  it("returns itemId undefined when there is a query but no selected", () => {
    expect(parseCollectionTarget("/collections/todo?foo=bar")).toEqual({ slug: "todo", itemId: undefined });
  });

  it("returns null for a slug with malformed percent-encoding (non-actionable, no throw)", () => {
    expect(parseCollectionTarget("/collections/%E0%A4%A")).toBeNull();
    expect(parseCollectionTarget("/collections/%E0%A4%A?selected=x")).toBeNull();
  });

  it("returns null for a non-collection target", () => {
    expect(parseCollectionTarget("/documents/abc")).toBeNull();
  });

  it("returns null for an empty slug", () => {
    expect(parseCollectionTarget("/collections/")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseCollectionTarget(undefined)).toBeNull();
  });
});
