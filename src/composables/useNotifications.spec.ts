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

  it("returns itemId undefined when there is a query but no selected", () => {
    expect(parseCollectionTarget("/collections/todo?foo=bar")).toEqual({ slug: "todo", itemId: undefined });
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
