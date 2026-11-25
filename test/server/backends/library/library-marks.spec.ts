// @vitest-environment node
// Pins and names in the Library (#3329): the pure change, and the file — absent, corrupt, and two
// changes arriving together.
import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fsPromises, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyMarkChange,
  changeLibraryMark,
  changeUnlocked,
  MARKS_LOCK_STALE_MS,
  readLibraryMarks,
  removeIfOwnedBy,
  tryAcquire,
  withMarksLock,
} from "../../../../server/backends/library/library-marks";
import { existsSync, mkdirSync, utimesSync } from "node:fs";
import { emptyLibraryMarks, LIBRARY_NAME_MAX } from "../../../../common/library";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
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
    // As a dead holder leaves it: a lock always has its owner in it (it is renamed into place so).
    // An EMPTY directory here would be replaced by the rename on POSIX and refused on Windows, and so
    // would not test the takeover at all.
    mkdirSync(`${file}.lock`, { recursive: true });
    writeFileSync(`${file}.lock/owner`, "a-dead-process");
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

  it("does not write when the lock was taken over while it worked", async () => {
    const file = scratchFile();
    await changeLibraryMark("kept", { pinned: true }, file);
    const write = withMarksLock(file, (stillHeld) =>
      changeUnlocked("lost", { pinned: true }, file, async () => {
        writeFileSync(`${file}.lock/owner`, "someone-else"); // taken over during the pause
        return stillHeld();
      }),
    );
    await expect(write).rejects.toThrow("taken over");
    expect(await readLibraryMarks(file)).toEqual({ pinned: ["kept"], names: {} });
  });

  it("puts back a lock that was renewed between finding it stale and taking it", async () => {
    const file = scratchFile();
    const lock = `${file}.lock`;
    mkdirSync(lock, { recursive: true });
    writeFileSync(`${lock}/owner`, "fresh-holder"); // judged stale under another owner, now someone else's
    await removeIfOwnedBy(lock, "the-stale-one");
    expect(readFileSync(`${lock}/owner`, "utf8")).toBe("fresh-holder");
  });

  it("acquires a free lock with its owner already in it, and never one that is held", async () => {
    const file = scratchFile();
    const lock = `${file}.lock`;
    mkdirSync(path.dirname(lock), { recursive: true });
    expect(await tryAcquire(lock, "first")).toBe(true);
    expect(readFileSync(`${lock}/owner`, "utf8")).toBe("first");
    expect(await tryAcquire(lock, "second")).toBe(false);
    expect(readFileSync(`${lock}/owner`, "utf8")).toBe("first"); // the holder's token is untouched
  });

  it("removes its own lock on release, by the same owner check", async () => {
    const file = scratchFile();
    const lock = `${file}.lock`;
    mkdirSync(path.dirname(lock), { recursive: true });
    expect(await tryAcquire(lock, "me")).toBe(true);
    await removeIfOwnedBy(lock, "me");
    expect(await tryAcquire(lock, "next")).toBe(true); // it was really released
  });

  it("does not take over a lock whose moved copy turns out to be young, even under the expected owner", async () => {
    const file = scratchFile();
    const lock = `${file}.lock`;
    mkdirSync(path.dirname(lock), { recursive: true });
    expect(await tryAcquire(lock, "fresh")).toBe(true); // a new lock, which only LOOKED stale before
    await removeIfOwnedBy(lock, "fresh", { onlyIfStale: true });
    expect(readFileSync(`${lock}/owner`, "utf8")).toBe("fresh");
  });

  it("never matches an owner it could not read", async () => {
    const file = scratchFile();
    const lock = `${file}.lock`;
    mkdirSync(lock, { recursive: true }); // a lock with no owner file at all
    await removeIfOwnedBy(lock, ""); // an unreadable owner must not equal any token, the empty one included
    expect(existsSync(lock)).toBe(true);
  });
  it.each(["EPERM", "EBUSY", "EACCES"])("still releases its lock when the move aside is refused %s for a moment", async (code) => {
    const file = scratchFile();
    const lock = `${file}.lock`;
    mkdirSync(path.dirname(lock), { recursive: true });
    expect(await tryAcquire(lock, "me")).toBe(true);
    const rename = fsPromises.rename.bind(fsPromises);
    const refusals = { left: 2 };
    vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
      if (refusals.left === 0) return rename(from, to);
      refusals.left -= 1;
      throw Object.assign(new Error(`${code}: busy`), { code });
    });
    await removeIfOwnedBy(lock, "me");
    expect(existsSync(lock)).toBe(false);
  });

  it("does not retry a move aside that failed for a reason other than busy", async () => {
    const file = scratchFile();
    const lock = `${file}.lock`;
    mkdirSync(path.dirname(lock), { recursive: true });
    expect(await tryAcquire(lock, "me")).toBe(true);
    const rename = vi.spyOn(fsPromises, "rename").mockRejectedValue(Object.assign(new Error("ENOENT: gone"), { code: "ENOENT" }));
    await removeIfOwnedBy(lock, "me");
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
