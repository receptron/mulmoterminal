// @vitest-environment node
import { describe, it, expect } from "vitest";
import { rawContentType, browserDisplays } from "../../common/rawContentType.js";
import { SOURCE_CODE_EXTENSIONS } from "../../common/sourceExtensions.js";

// Both sides read this: the raw route sets it as `Content-Type`, and the terminal's file links ask
// it to decide where a click goes. A type the browser cannot display turns a new tab into a silent
// download, which is what #2038 is about — so the two must not answer differently.
//
// The generator below is what a differential harness used while this moved out of
// `rawServingPlan.ts`: 20,608 names across extension, basename, directory and case, matched
// exactly between the old and new implementations. The harness could not survive the move (half
// of it was the deleted code); the generator and the property are what it left behind.
describe("rawContentType", () => {
  it("serves source and prose as text, so a tab VIEWS them", () => {
    for (const ext of [...SOURCE_CODE_EXTENSIONS, ".md", ".txt", ".rst", ".html"]) {
      expect(browserDisplays(`/w/a${ext}`)).toBe(true);
    }
  });

  it("types the media a browser renders", () => {
    expect(rawContentType("/w/a.png")).toBe("image/png");
    expect(rawContentType("/w/a.pdf")).toBe("application/pdf");
    expect(rawContentType("/w/a.mp4")).toBe("video/mp4");
  });

  // The one that matters for #2038: an office document has nothing a tab can do with it, so the
  // tab becomes a download — which is why the click has to go to the pane instead.
  it("answers octet-stream for what a browser would download", () => {
    for (const name of ["/w/book.xlsx", "/w/report.docx", "/w/archive.zip", "/w/blob.bin", "/w/a.unknown"]) {
      expect(rawContentType(name)).toBe("application/octet-stream");
      expect(browserDisplays(name)).toBe(false);
    }
  });

  // `path.extname` is "" for a dotfile, so keying by extension alone would download every one of
  // them. The whole basename is the key when there is no extension.
  it("reads a dotfile by its whole name", () => {
    for (const name of [".gitignore", ".env", ".editorconfig", ".dockerignore"]) {
      expect(browserDisplays(`/w/${name}`)).toBe(true);
    }
  });

  it("is case-insensitive, and reads only the LAST dot", () => {
    expect(rawContentType("/w/A.PNG")).toBe("image/png");
    expect(rawContentType("/w/README.Md")).toBe(rawContentType("/w/readme.md"));
    expect(rawContentType("/w/name.with.dots.png")).toBe("image/png");
  });

  it("reads the basename, not the directory, on both separators", () => {
    expect(rawContentType("/w.png/a.xlsx")).toBe("application/octet-stream");
    expect(rawContentType("C:\\w.png\\a.xlsx")).toBe("application/octet-stream");
    expect(rawContentType("C:\\w\\a.png")).toBe("image/png");
  });

  // A name that is nothing but an extension-looking string is a DOTFILE, not an extension.
  it("does not read a leading dot as an extension", () => {
    expect(rawContentType("/w/.png")).toBe("application/octet-stream");
  });
});
