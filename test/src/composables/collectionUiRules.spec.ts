import { describe, it, expect } from "vitest";
import { htmlPreviewUrl, remoteViewItemsQuery, deleteErrorMessage } from "../../../src/composables/collectionUiRules";

describe("htmlPreviewUrl", () => {
  it("maps a well-formed artifacts/html/*.html path to the preview route", () => {
    expect(htmlPreviewUrl("artifacts/html/report.html")).toBe("/artifacts/html/report.html");
  });

  it("encodes each path segment", () => {
    expect(htmlPreviewUrl("artifacts/html/sub dir/a b.html")).toBe("/artifacts/html/sub%20dir/a%20b.html");
  });

  // The `.html` suffix is lowercased before the check, so an uppercase extension still
  // reaches the preview route.
  it("accepts an uppercase .HTML extension (suffix is case-insensitive)", () => {
    expect(htmlPreviewUrl("artifacts/html/X.HTML")).toBe("/artifacts/html/X.HTML");
  });

  // Deliberate, pre-existing asymmetry: the extension is matched case-insensitively but
  // the `artifacts/html/` directory prefix is matched case-sensitively. An uppercase
  // prefix therefore falls through to null (raw fallback). Pinned so it isn't
  // "corrected" into symmetry without an explicit decision.
  it("rejects an uppercase directory prefix (prefix is case-sensitive) — intentional existing behavior", () => {
    expect(htmlPreviewUrl("Artifacts/HTML/x.html")).toBeNull();
  });

  it("returns null for a non-html file", () => {
    expect(htmlPreviewUrl("artifacts/html/data.json")).toBeNull();
  });

  it("returns null when the html path is under a different directory", () => {
    expect(htmlPreviewUrl("docs/report.html")).toBeNull();
  });

  it("returns null when nothing follows the prefix", () => {
    expect(htmlPreviewUrl("artifacts/html/.html")).toBe("/artifacts/html/.html");
    expect(htmlPreviewUrl("artifacts/html/")).toBeNull();
  });

  it("returns null for the empty string", () => {
    expect(htmlPreviewUrl("")).toBeNull();
  });
});

describe("remoteViewItemsQuery", () => {
  // offset:0 is a valid first-page offset and must survive — the guard is `!= null`,
  // not a truthy check.
  it("includes offset when it is 0", () => {
    expect(remoteViewItemsQuery({ offset: 0 })).toBe("?offset=0");
  });

  it("includes a non-zero offset", () => {
    expect(remoteViewItemsQuery({ offset: 20 })).toBe("?offset=20");
  });

  it("omits offset when it is absent", () => {
    expect(remoteViewItemsQuery({ limit: 10 })).toBe("?limit=10");
  });

  it("includes limit (including limit:0)", () => {
    expect(remoteViewItemsQuery({ limit: 0 })).toBe("?limit=0");
  });

  it("drops an empty fields array", () => {
    expect(remoteViewItemsQuery({ offset: 5, fields: [] })).toBe("?offset=5");
  });

  it("includes a populated fields array joined by commas", () => {
    expect(remoteViewItemsQuery({ fields: ["title", "image"] })).toBe("?fields=title%2Cimage");
  });

  it("combines all three params", () => {
    expect(remoteViewItemsQuery({ offset: 0, limit: 10, fields: ["a", "b"] })).toBe("?offset=0&limit=10&fields=a%2Cb");
  });

  it("returns an empty string when everything is omitted", () => {
    expect(remoteViewItemsQuery({})).toBe("");
  });
});

describe("deleteErrorMessage", () => {
  it("returns the server error string when present", () => {
    expect(deleteErrorMessage({ error: "preset collections can't be deleted" }, 403)).toBe("preset collections can't be deleted");
  });

  it("falls back to HTTP <status> when error is not a string", () => {
    expect(deleteErrorMessage({ error: 42 }, 500)).toBe("HTTP 500");
  });

  it("falls back to HTTP <status> when the object has no error field", () => {
    expect(deleteErrorMessage({ message: "nope" }, 404)).toBe("HTTP 404");
  });

  it("falls back to HTTP <status> when body is null (parse failure)", () => {
    expect(deleteErrorMessage(null, 400)).toBe("HTTP 400");
  });

  it("falls back to HTTP <status> when body is a non-object", () => {
    expect(deleteErrorMessage("just a string", 502)).toBe("HTTP 502");
    expect(deleteErrorMessage(123, 418)).toBe("HTTP 418");
  });
});
