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

  // On a WINDOWS server, where such a path names a file. Both separators fold, so the mixed
  // spelling `absoluteUnder` produces there keys the same as the backslashed one.
  it("keys a Windows path onto the separator the rest of the app compares with", () => {
    const onWindows: StoryRootDirs = { workspace: "C:/Users/me/w", byId: {} };
    expect(canonicalCardPath("C:\\Users\\me\\decks\\x.json", null, onWindows)).toBe("C:/Users/me/decks/x.json");
    expect(canonicalCardPath("C:\\Users\\me/decks/x.json", null, onWindows)).toBe("C:/Users/me/decks/x.json");
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

  // A Windows path rooted on the CURRENT DRIVE names no one file — the drive is not in the
  // spelling and the browser cannot infer it — so it is left to the caller's legacy identity
  // rather than keyed into something a drive-qualified card would not match (Codex P2 on #1976).
  it("says nothing for a path whose drive is unknown", () => {
    const onWindows: StoryRootDirs = { workspace: "C:/Users/me/w", byId: {} };
    expect(canonicalCardPath("\\decks\\x.json", null, onWindows)).toBeNull();
    expect(canonicalCardPath("C:\\decks\\x.json", null, onWindows)).toBe("C:/decks/x.json");
    // …and on a POSIX server neither spelling names anything at all.
    expect(canonicalCardPath("\\decks\\x.json", null, dirs)).toBeNull();
    expect(canonicalCardPath("C:\\decks\\x.json", null, dirs)).toBeNull();
  });

  // The rule both Windows findings on #1976 are instances of: a path that leans on the server's
  // CURRENT DRIVE names no one file, and which host that is comes from how the server spells its
  // own roots — the one signal a browser has (the page may be open on a phone). `/decks/x.json` is
  // the POSIX absolute form, so refusing it everywhere would disable identity on every other host.
  it("says nothing for a drive-less path when the server's roots are Windows ones", () => {
    const onWindows: StoryRootDirs = { workspace: "C:/Users/me/w", byId: { W: "C:/Users/me/w" } };
    expect(canonicalCardPath("/decks/x.json", null, onWindows)).toBeNull();
    expect(canonicalCardPath("\\decks\\x.json", null, onWindows)).toBeNull();
    // …while the two spellings that DO name a file on that host still resolve.
    expect(canonicalCardPath("C:\\decks\\x.json", null, onWindows)).toBe("C:/decks/x.json");
    expect(canonicalCardPath("//server/share/x.json", null, onWindows)).toBe("//server/share/x.json");
    // A root-relative card is unaffected: its base is the root's own drive-qualified spelling.
    expect(canonicalCardPath("stories/decks/x.json", "W", onWindows)).toBe("C:/Users/me/w/decks/x.json");
    // And on a POSIX server the same spelling is the answer it always was.
    expect(canonicalCardPath("/decks/x.json", null, dirs)).toBe("/decks/x.json");
  });

  // A Windows server whose workspace is a UNC share rather than a drive: `canonicalPath` keeps that
  // spelling, and a drive-less card path is just as unreconcilable there (Codex P2, third round).
  // The host test is the same one applied to the server's own root, so this case is closed by the
  // rule rather than by another branch.
  it("reads a UNC-rooted server as a Windows one too", () => {
    const onShare: StoryRootDirs = { workspace: "//server/share/project", byId: { W: "//server/share/project" } };
    expect(canonicalCardPath("/decks/x.json", null, onShare)).toBeNull();
    expect(canonicalCardPath("\\decks\\x.json", null, onShare)).toBeNull();
    expect(canonicalCardPath("//server/share/project/decks/x.json", null, onShare)).toBe("//server/share/project/decks/x.json");
    expect(canonicalCardPath("C:\\decks\\x.json", null, onShare)).toBe("C:/decks/x.json");
    expect(canonicalCardPath("stories/decks/x.json", "W", onShare)).toBe("//server/share/project/decks/x.json");
  });

  // A leading RUN of slashes is one root on POSIX — measured: `realpath("//tmp/x")` is `/tmp/x` —
  // while `dirPathKey` reads the first as a UNC share, which would give one file two cards
  // (Codex, re-review of the same head). Collapsed here rather than in the key: on a Windows host
  // `//server/share` really is a different place.
  it("folds a POSIX path's leading slash run, which names one file", () => {
    expect(canonicalCardPath("//Users/me/decks/x.json", null, dirs)).toBe("/Users/me/decks/x.json");
    expect(canonicalCardPath("///Users/me/decks/x.json", null, dirs)).toBe("/Users/me/decks/x.json");
    expect(canonicalCardPath("//Users/me/decks/x.json", null, dirs)).toBe(canonicalCardPath("/Users/me/decks/x.json", null, dirs));
  });

  // …and the same spelling on a Windows host is a share, which is a place of its own.
  it("keeps a UNC share as a share on a Windows host", () => {
    const onWindows: StoryRootDirs = { workspace: "C:/Users/me/w", byId: { W: "C:/Users/me/w" } };
    expect(canonicalCardPath("//server/share/x.json", null, onWindows)).toBe("//server/share/x.json");
  });

  // The mirror of the drive-less case: a Windows spelling names no file on a POSIX server, so it
  // keeps its legacy identity instead of being keyed as though it did.
  it("says nothing for a Windows spelling when the server is a POSIX one", () => {
    expect(canonicalCardPath("C:\\decks\\x.json", null, dirs)).toBeNull();
    expect(canonicalCardPath("\\\\server\\share\\x.json", null, dirs)).toBeNull();
  });

  // A workspace AT a filesystem root builds `//artifacts/stories/…` when the default root's base is
  // joined — a doubled leading slash, which `dirPathKey` reads as a UNC share. Both branches key by
  // one rule so that card is the same card as the absolute one for the same file.
  it("resolves the default root under a workspace that is the filesystem root", () => {
    const atRoot: StoryRootDirs = { workspace: "/", byId: { W: "/" } };
    expect(canonicalCardPath("stories/x.json", null, atRoot)).toBe("/artifacts/stories/x.json");
    expect(canonicalCardPath("stories/x.json", null, atRoot)).toBe(canonicalCardPath("/artifacts/stories/x.json", null, atRoot));
    expect(canonicalCardPath("stories/decks/x.json", "W", atRoot)).toBe("/decks/x.json");
  });

  // The server's spelling is read from whichever root is there — a card can arrive before the
  // workspace entry does, and the map is what `storyRootDirsFrom` fills either way.
  it("reads the host's spelling from a named root when there is no workspace", () => {
    expect(canonicalCardPath("/decks/x.json", null, { workspace: null, byId: { P: "C:/Users/me/w/proj" } })).toBeNull();
    expect(canonicalCardPath("/decks/x.json", null, { workspace: null, byId: { P: "/Users/me/w/proj" } })).toBe("/decks/x.json");
  });

  it("says nothing for the stories directory itself", () => {
    expect(canonicalCardPath("stories/", null, dirs)).toBeNull();
  });
});
