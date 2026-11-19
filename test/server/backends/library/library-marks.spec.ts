// @vitest-environment node
// Pins and names in the Library (#3329): the pure change, and the file — absent, corrupt, and two
// changes arriving together.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMarkChange, changeLibraryMark, readLibraryMarks } from "../../../../server/backends/library/library-marks";
import { emptyLibraryMarks, LIBRARY_NAME_MAX } from "../../../../common/library";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const scratchFile = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-library-marks-"));
  dirs.push(dir);
  return path.join(dir, "library", "marks.json");
};

describe("applyMarkChange", () => {
  it("puts a new pin first, moves a repeated one there, and takes one out on unpin", () => {
    let marks = applyMarkChange(emptyLibraryMarks(), "a", { pinned: true });
    marks = applyMarkChange(marks, "b", { pinned: true });
    expect(marks.pinned).toEqual(["b", "a"]);
    expect(applyMarkChange(marks, "a", { pinned: true }).pinned).toEqual(["a", "b"]);
    expect(applyMarkChange(marks, "b", { pinned: false }).pinned).toEqual(["a"]);
    expect(applyMarkChange(marks, "zzz", { pinned: false }).pinned).toEqual(["b", "a"]);
  });

  it("keeps a name on one line, within the cap, and clears it when blank or null", () => {
    const named = applyMarkChange(emptyLibraryMarks(), "a", { name: "  burn\n subtitles  " });
    expect(named.names).toEqual({ a: "burn subtitles" });
    expect(applyMarkChange(named, "a", { name: "   " }).names).toEqual({});
    expect(applyMarkChange(named, "a", { name: null }).names).toEqual({});
    expect(applyMarkChange(emptyLibraryMarks(), "a", { name: "x".repeat(LIBRARY_NAME_MAX + 9) }).names.a).toHaveLength(LIBRARY_NAME_MAX);
  });

  it("changes only the fields given", () => {
    const marks = { pinned: ["a"], names: { a: "A" } };
    expect(applyMarkChange(marks, "a", {})).toEqual(marks);
    expect(applyMarkChange(marks, "a", { pinned: false })).toEqual({ pinned: [], names: { a: "A" } });
  });
});

describe("the marks file", () => {
  it("reads as empty before anything was marked", async () => {
    expect(await readLibraryMarks(scratchFile())).toEqual(emptyLibraryMarks());
  });

  it("refuses to read a file that is not a marks file, rather than answering empty", async () => {
    const file = scratchFile();
    await changeLibraryMark("a", { pinned: true }, file);
    writeFileSync(file, "{ not json");
    await expect(readLibraryMarks(file)).rejects.toThrow();
    writeFileSync(file, JSON.stringify({ pinned: "a" }));
    await expect(readLibraryMarks(file)).rejects.toThrow();
    await expect(changeLibraryMark("b", { pinned: true }, file)).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify({ pinned: "a" })); // left as it was
  });

  it("keeps both of two changes made at the same moment", async () => {
    const file = scratchFile();
    await Promise.all([changeLibraryMark("a", { pinned: true }, file), changeLibraryMark("b", { name: "Bee" }, file)]);
    expect(await readLibraryMarks(file)).toEqual({ pinned: ["a"], names: { b: "Bee" } });
  });
});
