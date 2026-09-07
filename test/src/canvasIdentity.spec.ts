import { describe, it, expect } from "vitest";
import { collectionIdentity, documentIdentity, filePathIdentity, payloadString } from "../../src/utils/canvasIdentity";
import { storyWirePath } from "../../src/composables/canvasOpenFile";
import { storyRootDirsFrom } from "../../src/utils/canvasCardPath";

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

  // #3014's third collision point, closed here: the workspace subtree is a named stories root
  // (#1933), so one wire path can name two files. Folding on the path alone put a repository's
  // deck and the workspace's into ONE card.
  it("tells two roots' identically-named decks apart", () => {
    const inRepo = filePathIdentity({ data: { filePath: "stories/deck.json", root: "abc123", script: {} } });
    const inWorkspace = filePathIdentity({ data: { filePath: "stories/deck.json", script: {} } });
    expect(inRepo).not.toBe(inWorkspace);
    expect(filePathIdentity({ data: { filePath: "stories/deck.json", root: "def456", script: {} } })).not.toBe(inRepo);
  });

  // A card written before roots existed carries no `root`, and must keep folding against the
  // default-root card the agent writes today — otherwise every pre-#1933 card doubles.
  it("folds a rootless payload the way it always did", () => {
    expect(filePathIdentity({ data: { filePath: "stories/demo.json" } })).toBe(filePathIdentity({ data: { filePath: "stories/demo.json", script: {} } }));
  });

  it("gives two different artifacts two different identities", () => {
    const one = filePathIdentity({ data: { filePath: "artifacts/html/a.html" } });
    const two = filePathIdentity({ data: { filePath: "artifacts/html/b.html" } });
    expect(one).not.toBe(two);
  });
});

// The wire spelling a card carries is not a property of the FILE — it is a property of what this
// server registered when the card was made. These drive the real chain (the Files pane's
// `storyWirePath` mints the ref, the card carries it, this reads it back), because the defect is in
// how the two fit together and neither half shows it alone (#1976).
describe("filePathIdentity — one deck, whatever spelling reached it", () => {
  const WS = "/Users/me/w";
  const FILE = `${WS}/proj/decks/x.json`;
  /** What the server registers with only the workspace opened, and after `…/proj` is added as a
   *  preset — both as `/api/config` reports them. */
  const workspaceOnly = [{ id: "W", canonical: WS, paths: [WS] }];
  const withPreset = [...workspaceOnly, { id: "P", canonical: `${WS}/proj`, paths: [`${WS}/proj`] }];
  const gate = (registered: typeof workspaceOnly) => ({ workspaces: registered[0]?.paths ?? [], roots: registered });

  /** The identity the Canvas gives the card the Files pane would seed for `absolutePath`. */
  const identityFor = (absolutePath: string, registered: typeof workspaceOnly): string | null => {
    const ref = storyWirePath(absolutePath, gate(registered));
    return ref === null ? null : filePathIdentity({ data: { ...ref, script: {} } }, storyRootDirsFrom(registered));
  };

  // (B) Registering another directory re-spells every deck beneath it — `W\0stories/proj/decks/x.json`
  // became `P\0stories/decks/x.json`, measured on the pure functions. A card stored before the
  // preset and one made after it are then two cards for one file, and the older one supersedes
  // nothing.
  it("does not change when the user registers another directory", () => {
    expect(identityFor(FILE, workspaceOnly)).toBe(identityFor(FILE, withPreset));
    expect(identityFor(FILE, withPreset)).toBe(FILE);
  });

  // (C) A card in the workspace's own stories directory carried NO path component at all — every
  // workspace's `stories/x.json` was one identity, so the guard named roots got in #1933 did not
  // apply to the default root.
  it("tells two workspaces' default-root decks apart", () => {
    const one = identityFor("/Users/me/w1/artifacts/stories/x.json", [{ id: "W1", canonical: "/Users/me/w1", paths: ["/Users/me/w1"] }]);
    const two = identityFor("/Users/me/w2/artifacts/stories/x.json", [{ id: "W2", canonical: "/Users/me/w2", paths: ["/Users/me/w2"] }]);
    expect(one).toBe("/Users/me/w1/artifacts/stories/x.json");
    expect(two).not.toBe(one);
  });

  // What the gate in canvasOpenFile.ts is waiting for: once a deck outside every root can be opened
  // by absolute path, its card must be the SAME card as the one reached through a root. Both sides
  // are lexical — the plugin echoes an absolute `filePath` as the caller spelled it — so this holds
  // for a spelling that names the root the way the server resolved it, and a cell reached through a
  // symlink is the limit stated in canvasCardPath.ts.
  it("folds the absolute spelling onto the deck opened through a root", () => {
    const throughRoot = filePathIdentity({ data: { filePath: "stories/decks/x.json", root: "P", script: {} } }, storyRootDirsFrom(withPreset));
    const byPath = filePathIdentity({ data: { filePath: FILE, script: {} } }, storyRootDirsFrom(withPreset));
    expect(throughRoot).toBe(byPath);
  });

  it("still tells two roots' identically-named decks apart", () => {
    const inPreset = filePathIdentity({ data: { filePath: "stories/deck.json", root: "P", script: {} } }, storyRootDirsFrom(withPreset));
    const inWorkspace = filePathIdentity({ data: { filePath: "stories/deck.json", root: "W", script: {} } }, storyRootDirsFrom(withPreset));
    expect(inPreset).toBe(`${WS}/proj/deck.json`);
    expect(inWorkspace).toBe(`${WS}/deck.json`);
  });

  // A card made on another machine, or under a preset since removed. Resolving it would need a
  // directory nothing here knows, so it keeps the identity it has always had rather than folding
  // onto a guess.
  it("keeps the old identity for a root this server never registered", () => {
    expect(filePathIdentity({ data: { filePath: "stories/x.json", root: "gone" } }, storyRootDirsFrom(withPreset))).toBe("gone\u0000stories/x.json");
  });

  // Not every absolute-looking spelling names a file: a Windows path rooted on the current drive
  // does not carry the drive. Keeping the old identity is what stops it merging with a POSIX card
  // of the same tail (Codex P2 on #1976).
  it("keeps the old identity for a path whose drive is unknown", () => {
    expect(filePathIdentity({ data: { filePath: "\\decks\\x.json" } }, storyRootDirsFrom(withPreset))).toBe("\\decks\\x.json");
  });

  // The state the panel is in for the first moments after it opens.
  it("keeps the old identity until the config arrives", () => {
    expect(filePathIdentity({ data: { filePath: "stories/x.json", root: "W" } })).toBe("W\u0000stories/x.json");
    expect(filePathIdentity({ data: { filePath: "artifacts/html/a.html" } })).toBe("artifacts/html/a.html");
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
