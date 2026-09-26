import { describe, it, expect } from "vitest";
import { diskVersion, previewQuery } from "../../../src/components/filesPreviewSrc";
import { browseQuery } from "../../../src/components/filesPaneApi";

// Preview renders the file on disk through an iframe, so WHICH REVISION it shows is decided
// entirely by the URL it is given — and before #2136 that URL never changed, which is invisible
// from inside the component. Which VIEW is up is `filesPreviewMode.ts` and its own spec.

describe("diskVersion", () => {
  it("is the loaded version while the pane holds no conflict", () => {
    expect(diskVersion("abc", null)).toBe("abc");
  });

  // Dirty is exactly when the two disagree, and the preview is the disk's side of that
  // disagreement: the poll parked the version it found there on the conflict.
  it("is the version the poll found on disk once a conflict is open", () => {
    expect(diskVersion("abc", { version: "def" })).toBe("def");
  });

  // Not "fall back to baseVersion": the file was DELETED under the buffer, and rendering its
  // last known revision would show content that is no longer there.
  it("is null when the conflict says the file is gone", () => {
    expect(diskVersion("abc", { version: null })).toBeNull();
  });

  it("is null when nothing has been loaded yet", () => {
    expect(diskVersion(null, null)).toBeNull();
  });
});

describe("previewQuery", () => {
  it("carries the root and the path the browse routes take", () => {
    expect(previewQuery("/proj", "docs/a.md", null)).toBe("cwd=%2Fproj&path=docs%2Fa.md&embed=1");
  });

  // The whole point: the same file at a new revision must produce a DIFFERENT string, or the
  // browser serves the rendering it already has and the edit never appears.
  it("changes when the version changes", () => {
    const before = previewQuery("/proj", "a.md", "v1");
    const after = previewQuery("/proj", "a.md", "v2");
    expect(before).not.toBe(after);
  });

  // And the other half: an unchanged file must produce the SAME string, or every poll tick
  // refetches and the iframe flickers on a document nobody edited.
  it("is stable while the version is", () => {
    expect(previewQuery("/proj", "a.md", "v1")).toBe(previewQuery("/proj", "a.md", "v1"));
  });

  it("asks for a version when there is one", () => {
    expect(previewQuery(null, "a.md", "v1")).toBe("path=a.md&v=v1&embed=1");
  });

  it("omits the version rather than sending an empty one", () => {
    expect(previewQuery(null, "a.md", null)).toBe("path=a.md&embed=1");
  });

  // An absent cwd is how the server is told to use its default workspace, and adding `v` must
  // not start sending an empty `cwd` alongside it.
  it("still omits the root when the pane has none", () => {
    expect(previewQuery(null, "a.md", "v1")).not.toContain("cwd=");
  });

  it("escapes a version that would otherwise end the query", () => {
    expect(previewQuery(null, "a.md", "v&x=1")).toBe("path=a.md&v=v%26x%3D1&embed=1");
  });

  // The parameter the server actually reads (#2157): this url, and only this url, asks for the
  // document with the scroll reporter in it. A preview that stopped sending it would silently be
  // back to a view whose position cannot be read.
  it("asks for the embeddable document", () => {
    expect(previewQuery("/proj", "a.md", "v1")).toContain("embed=1");
  });

  // The new tab a clicked `.md` opens builds its own url and must keep getting the document that
  // runs nothing at all — so a caller that asks for a file this way is not embedding it.
  it("is the only builder that asks for it", () => {
    expect(browseQuery("/proj", "a.md")).not.toContain("embed");
  });

  it("escapes a path that would otherwise end the query", () => {
    expect(previewQuery(null, "a&b.md", "v1")).toBe("path=a%26b.md&v=v1&embed=1");
  });
});

// #2263. The app's theme rides the preview URL, so a theme change is a new src.
describe("previewQuery with a theme", () => {
  const theme = { bg: "#1a1a2e", fg: "#e6e6f0", muted: "#a0a0b8", subtle: "#232342", border: "#33335a", link: "#4a8cff" };

  it("carries every colour", () => {
    const params = new URLSearchParams(previewQuery("/w", "a.md", "v1", theme));
    expect(Object.fromEntries(Object.keys(theme).map((key) => [key, params.get(key)]))).toEqual(theme);
  });

  it("changes when the theme does", () => {
    expect(previewQuery("/w", "a.md", "v1", theme)).not.toBe(previewQuery("/w", "a.md", "v1", { ...theme, bg: "#f4f6fb" }));
  });

  it("carries nothing when there is no theme to pass on", () => {
    expect(new URLSearchParams(previewQuery("/w", "a.md", "v1", null)).has("bg")).toBe(false);
  });
});
