import { describe, it, expect } from "vitest";
import { canonicalCardPath, storyRootDirsFrom, NO_STORY_ROOTS, type StoryRootDirs } from "../../../src/utils/canvasCardPath";

// The file a card is ABOUT, from the spelling the card happens to carry. Identity is built on this,
// so a wrong answer merges two decks into one card and a missing one splits one deck into two.

const dirs: StoryRootDirs = { workspace: "/Users/me/w", byId: { W: "/Users/me/w", P: "/Users/me/w/proj" } };

describe("storyRootDirsFrom", () => {
  it("takes the workspace from the FIRST entry, which is the contract the server registers by", () => {
    expect(
      storyRootDirsFrom([
        { id: "W", canonical: "/w" },
        { id: "P", canonical: "/w/proj" },
      ]).workspace,
    ).toBe("/w");
  });

  it("maps every root that named its resolved spelling", () => {
    expect(
      storyRootDirsFrom([
        { id: "W", canonical: "/w" },
        { id: "P", canonical: "/w/proj" },
      ]).byId,
    ).toEqual({ W: "/w", P: "/w/proj" });
  });

  // A server older than #1976 sends `paths` and no `canonical`. Nothing may be guessed from the
  // spellings — the browser cannot tell which of them the server resolved — so the root resolves
  // nothing and its cards keep the identity they had before.
  it("drops a root that carries no resolved spelling", () => {
    const dirsFromOldServer = storyRootDirsFrom([{ id: "W" }, { id: "P", canonical: "/w/proj" }]);
    expect(dirsFromOldServer.workspace).toBeNull();
    expect(dirsFromOldServer.byId).toEqual({ P: "/w/proj" });
  });

  it("answers nothing-registered for an empty list", () => {
    expect(storyRootDirsFrom([])).toEqual(NO_STORY_ROOTS);
  });
});

describe("canonicalCardPath", () => {
  it("resolves a story under a named root", () => {
    expect(canonicalCardPath("stories/decks/x.json", "P", dirs)).toBe("/Users/me/w/proj/decks/x.json");
  });

  // The same file addressed through the workspace root instead — one deck, two wire spellings.
  it("resolves the same file the same way through a root further up", () => {
    expect(canonicalCardPath("stories/proj/decks/x.json", "W", dirs)).toBe("/Users/me/w/proj/decks/x.json");
  });

  it("resolves a rootless story under the workspace's own stories directory", () => {
    expect(canonicalCardPath("stories/x.json", null, dirs)).toBe("/Users/me/w/artifacts/stories/x.json");
  });

  it("takes an absolute path as the answer it already is", () => {
    expect(canonicalCardPath("/Users/me/decks/keynote.json", null, dirs)).toBe("/Users/me/decks/keynote.json");
  });

  it("keys an absolute path, so two spellings of one file are one card", () => {
    expect(canonicalCardPath("/Users/me//w/./decks/x.json", null, dirs)).toBe("/Users/me/w/decks/x.json");
  });

  it("keys a Windows path onto the separator the rest of the app compares with", () => {
    expect(canonicalCardPath("C:\\Users\\me\\decks\\x.json", null, dirs)).toBe("C:/Users/me/decks/x.json");
  });

  // Folded rather than refused: this value opens nothing (the server resolves and realpath-checks
  // the file itself), and folding is what keeps two spellings of one file on one card.
  it("folds a traversal instead of treating it as its own file", () => {
    expect(canonicalCardPath("stories/decks/../x.json", "P", dirs)).toBe("/Users/me/w/proj/x.json");
  });

  it("says nothing for a root this server never registered", () => {
    expect(canonicalCardPath("stories/x.json", "from-another-machine", dirs)).toBeNull();
  });

  it("says nothing before the config arrives", () => {
    expect(canonicalCardPath("stories/x.json", null, NO_STORY_ROOTS)).toBeNull();
    expect(canonicalCardPath("stories/x.json", "W", NO_STORY_ROOTS)).toBeNull();
  });

  // presentHtml addresses its pages relative to the workspace, not through a stories root. Nothing
  // here knows how to read that, and a guess would fold two tools' paths together.
  it("says nothing for a relative path that is not a story", () => {
    expect(canonicalCardPath("artifacts/html/report.html", null, dirs)).toBeNull();
  });

  it("says nothing for the stories directory itself", () => {
    expect(canonicalCardPath("stories/", null, dirs)).toBeNull();
  });
});
