import { describe, it, expect } from "vitest";
import { collectionIdentity, documentIdentity, filePathIdentity, payloadString } from "../../src/utils/canvasIdentity";

// What each tool calls "the same thing". These decide whether a card on screen is REPLACED, so
// the cases that must return null (nothing durable behind the result, an unrecognised shape) are
// pinned as hard as the ones that must match.

describe("payloadString", () => {
  it("reads the field from data", () => {
    expect(payloadString({ data: { filePath: "artifacts/html/a.html" } }, "filePath")).toBe("artifacts/html/a.html");
  });

  it("falls back to jsonData when data lacks the field", () => {
    // A view persisting its own state may send a partial result carrying only one of the two.
    expect(payloadString({ jsonData: { filePath: "stories/x.json" } }, "filePath")).toBe("stories/x.json");
  });

  it("prefers data over jsonData", () => {
    expect(payloadString({ data: { filePath: "a" }, jsonData: { filePath: "b" } }, "filePath")).toBe("a");
  });

  it("returns null for an empty string, so a blank path never merges two cards", () => {
    expect(payloadString({ data: { filePath: "" } }, "filePath")).toBeNull();
  });

  it("returns null for a non-string value", () => {
    expect(payloadString({ data: { filePath: 42 } }, "filePath")).toBeNull();
  });

  it("returns null for shapes with no payload at all", () => {
    expect(payloadString({}, "filePath")).toBeNull();
    expect(payloadString(null, "filePath")).toBeNull();
    expect(payloadString("nope", "filePath")).toBeNull();
    expect(payloadString({ data: "nope" }, "filePath")).toBeNull();
  });
});

describe("filePathIdentity", () => {
  it("identifies presentHtml by its page on disk", () => {
    expect(filePathIdentity({ data: { filePath: "artifacts/html/report.html", title: "Report" } })).toBe("artifacts/html/report.html");
  });

  it("identifies presentMulmoScript by its story on disk", () => {
    expect(filePathIdentity({ data: { filePath: "stories/demo.json", script: {} } })).toBe("stories/demo.json");
  });

  it("gives two different artifacts two different identities", () => {
    const one = filePathIdentity({ data: { filePath: "artifacts/html/a.html" } });
    const two = filePathIdentity({ data: { filePath: "artifacts/html/b.html" } });
    expect(one).not.toBe(two);
  });
});

describe("documentIdentity", () => {
  it("identifies a document by docPath", () => {
    expect(documentIdentity({ data: { markdown: "# hi", docPath: "artifacts/documents/notes.md" } })).toBe("artifacts/documents/notes.md");
  });

  it("returns null for inline markdown, which has nothing durable behind it", () => {
    expect(documentIdentity({ data: { markdown: "# just some text" } })).toBeNull();
  });

  it("does not mistake a one-line markdown body for a path", () => {
    // `README.md` is a perfectly good document body as well as a path — the package's accessor
    // only reads the legacy in-`markdown` form for its own artifacts directory.
    expect(documentIdentity({ data: { markdown: "README.md" } })).toBeNull();
  });

  it("reads the legacy pre-docPath form, where the artifact path lived in `markdown`", () => {
    expect(documentIdentity({ data: { markdown: "artifacts/documents/old.md" } })).toBe("artifacts/documents/old.md");
  });

  it("returns null for shapes with no payload", () => {
    expect(documentIdentity({})).toBeNull();
    expect(documentIdentity(null)).toBeNull();
  });
});

describe("collectionIdentity", () => {
  it("identifies a collection by its slug", () => {
    expect(collectionIdentity({ data: { collectionSlug: "books" } })).toBe("books");
  });

  it("ignores itemId, so editing a record and editing the collection are one subject", () => {
    // The owner's decision behind this change: slug alone, not slug+itemId.
    expect(collectionIdentity({ data: { collectionSlug: "books", itemId: "42" } })).toBe("books");
    expect(collectionIdentity({ data: { collectionSlug: "books" } })).toBe(collectionIdentity({ data: { collectionSlug: "books", itemId: "42" } }));
  });

  it("keeps two collections apart", () => {
    expect(collectionIdentity({ data: { collectionSlug: "books" } })).not.toBe(collectionIdentity({ data: { collectionSlug: "films" } }));
  });

  it("returns null when there is no slug", () => {
    expect(collectionIdentity({ data: {} })).toBeNull();
    expect(collectionIdentity(null)).toBeNull();
  });
});
