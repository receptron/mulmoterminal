// @vitest-environment node
// Pins and names in the Library (#3329): the pure change, and the file — absent, corrupt, and two
// changes arriving together.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyMarkChange,
  changeLibraryMark,
  changeUnlocked,
  MARKS_LOCK_STALE_MS,
  readLibraryMarks,
  withMarksLock,
} from "../../../../server/backends/library/library-marks";
import { mkdirSync, utimesSync } from "node:fs";
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

describe("the cross-process lock", () => {
  // Two servers have no in-process serializer in common; only the lock keeps their changes apart.
  it("keeps both changes when two holders that share no serializer change marks at once", async () => {
    const file = scratchFile();
    await Promise.all([
      withMarksLock(file, () => changeUnlocked("a", { pinned: true }, file)),
      withMarksLock(file, () => changeUnlocked("b", { name: "Bee" }, file)),
    ]);
    expect(await readLibraryMarks(file)).toEqual({ pinned: ["a"], names: { b: "Bee" } });
  });

  it("takes over a lock left by a process that died holding it", async () => {
    const file = scratchFile();
    mkdirSync(`${file}.lock`, { recursive: true });
    const old = (Date.now() - MARKS_LOCK_STALE_MS * 2) / 1000;
    utimesSync(`${file}.lock`, old, old);
    expect(await changeLibraryMark("a", { pinned: true }, file)).toEqual({ pinned: ["a"], names: {} });
  });

  it("leaves a lock alone that was taken over from it while it worked", async () => {
    const file = scratchFile();
    await withMarksLock(file, async () => {
      // A second holder took over (as after a stale timeout) and now owns the lock.
      writeFileSync(`${file}.lock/owner`, "someone-else");
    });
    expect(readFileSync(`${file}.lock/owner`, "utf8")).toBe("someone-else");
  });
});
