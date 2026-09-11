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
  // ` report.pdf` and `report.pdf` are two different files on a POSIX filesystem, and the bytes
  // served are the untrimmed one. Advertising the trimmed name saves the file under a name that
  // does not match it (CodeRabbit on #2040) — the same trap `dirPathKey` set for a workspace whose
  // name ended in a space (#1934).
  it("keeps whitespace that is part of the name", () => {
    expect(servedFileName("reports/ leading.pdf")).toBe(" leading.pdf");
    expect(servedFileName("reports/trailing .pdf")).toBe("trailing .pdf");
    expect(servedFileName("reports/both .pdf ")).toBe("both .pdf ");
    expect(servedFileName(" spaced dir /file.pdf")).toBe("file.pdf");
    // A file whose whole name is whitespace is legal on POSIX, so it is a name like any other.
    expect(servedFileName("reports/  ")).toBe("  ");
  });

  it("answers null when there is no name to give", () => {
    expect(servedFileName("")).toBeNull();
    expect(servedFileName("/")).toBeNull();
    expect(servedFileName("///")).toBeNull();
    expect(servedFileName("\\")).toBeNull();
    expect(servedFileName(".")).toBeNull();
    expect(servedFileName("..")).toBeNull();
    expect(servedFileName("./../.")).toBeNull();
  });
});
