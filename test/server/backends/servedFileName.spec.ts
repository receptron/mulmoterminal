// @vitest-environment node
import { describe, it, expect } from "vitest";
import { servedFileName } from "../../../server/backends/servedFileName.js";

// What the browser is told to call a file saved from /api/files/raw. Without it the save name is
// the URL's last segment plus an extension guessed from the type — `raw.pdf` for every file
// (#2040, measured the same way in Chromium and WebKit).
describe("servedFileName", () => {
  it("takes the last segment", () => {
    expect(servedFileName("artifacts/reports/2026-08-report.pdf")).toBe("2026-08-report.pdf");
  });

  it("keeps a name the header has to escape rather than sanitising it here", () => {
    // The quoting is `content-disposition`'s job, and doing it twice is how a name ends up
    // mangled. This function decides WHICH name, never how it is spelled on the wire.
    expect(servedFileName('a/weird";name.pdf')).toBe('weird";name.pdf');
    expect(servedFileName("a/月次レポート 2026-08.pdf")).toBe("月次レポート 2026-08.pdf");
    expect(servedFileName("a/line\nbreak.pdf")).toBe("line\nbreak.pdf");
  });

  it("splits on both separators, since `rel` arrives off the wire", () => {
    expect(servedFileName("artifacts\\reports\\note.pdf")).toBe("note.pdf");
    expect(servedFileName("artifacts/reports\\note.pdf")).toBe("note.pdf");
  });

  it("ignores segments that name a directory rather than a file", () => {
    expect(servedFileName("reports/./note.pdf")).toBe("note.pdf");
    expect(servedFileName("reports/note.pdf/")).toBe("note.pdf");
    expect(servedFileName("reports//note.pdf")).toBe("note.pdf");
    expect(servedFileName("reports/sub/..")).toBe("sub");
  });

  it("expands nothing: a tilde segment is a directory, not a name", () => {
    expect(servedFileName("~/note.pdf")).toBe("note.pdf");
    expect(servedFileName("~")).toBeNull();
  });

  // Null is the important answer: the caller omits the header, which leaves the browser exactly
  // where it was before this existed. A placeholder would name a file nobody asked for.
  it("answers null when there is no name to give", () => {
    expect(servedFileName("")).toBeNull();
    expect(servedFileName("/")).toBeNull();
    expect(servedFileName("///")).toBeNull();
    expect(servedFileName("\\")).toBeNull();
    expect(servedFileName("  ")).toBeNull();
    expect(servedFileName(".")).toBeNull();
    expect(servedFileName("..")).toBeNull();
    expect(servedFileName("./../.")).toBeNull();
  });
});
