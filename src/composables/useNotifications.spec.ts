// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseCollectionTarget } from "./useNotifications";

describe("parseCollectionTarget", () => {
  it("parses slug + selected item", () => {
    expect(parseCollectionTarget("/collections/biology?selected=cell-1")).toEqual({ slug: "biology", itemId: "cell-1" });
  });

  it("parses a slug with no selected item", () => {
    expect(parseCollectionTarget("/collections/biology")).toEqual({ slug: "biology", itemId: undefined });
  });

  it("decodes percent-encoded slug + item (matches buildNavigateTarget's encodeURIComponent)", () => {
    expect(parseCollectionTarget("/collections/my%20slug?selected=a%2Fb")).toEqual({ slug: "my slug", itemId: "a/b" });
  });

  it("returns null for non-collection or empty targets", () => {
    expect(parseCollectionTarget("/files/x")).toBeNull();
    expect(parseCollectionTarget(undefined)).toBeNull();
    expect(parseCollectionTarget("/collections/")).toBeNull();
  });
});
