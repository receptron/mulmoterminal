// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyMissingPresets, decidePrune, MISSING_CONFIRM_MS, type DirPresence, type DirProbe } from "../../../../server/config/dir/missing-presets";
import { dirHasEntries, loadMissingSince, probeDir, saveMissingSince } from "../../../../server/config/dir/cwd-presets";

const at = (posixPath: string) => path.resolve(posixPath);
/** A probe over a fixed picture of the filesystem: listed paths answer as given, the rest are present
 *  and hold something, except the directories named in `empty`. */
const fsWith = (entries: Record<string, DirPresence>, empty: readonly string[] = []): DirProbe => ({
  presence: (dir) => entries[dir] ?? "present",
  hasEntries: (dir) => !empty.includes(dir),
});

describe("classifyMissingPresets", () => {
  it("calls a directory gone when its parent is still there", () => {
    const dir = at("/work/old-worktree");
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent" }))).toEqual({ gone: [dir], unreachable: [] });
  });

  it("calls it unreachable when the parent is missing too", () => {
    const dir = at("/srv/share/project");
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent", [at("/srv/share")]: "absent" }))).toEqual({ gone: [], unreachable: [dir] });
  });

  it("never forgets a symlink whose target is missing, wherever its parent is", () => {
    const dir = at("/work/usb-link");
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "dangling" }))).toEqual({ gone: [], unreachable: [dir] });
  });

  it("treats a parent that is a dangling symlink as out of reach", () => {
    const dir = at("/work/usb-link/project");
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent", [at("/work/usb-link")]: "dangling" }))).toEqual({ gone: [], unreachable: [dir] });
  });

  // An unplugged drive removes its own mount directory while the mount root stays.
  it.skipIf(process.platform === "win32").each(["/Volumes/USB", "/media/USB", "/mnt/share", "/media/me/USB", "/run/media/me/USB"])(
    "never forgets a volume root such as %s",
    (dir) => {
      expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent" }))).toEqual({ gone: [], unreachable: [dir] });
    },
  );

  it.skipIf(process.platform === "win32")("still forgets a folder deleted INSIDE a mounted volume", () => {
    const dir = "/Volumes/USB/old-project";
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent" }))).toEqual({ gone: [dir], unreachable: [] });
  });

  // A mount point that stays behind as an empty folder after an unmount.
  it("never forgets a directory whose parent is present but empty", () => {
    const dir = at("/mnt/nas/project");
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent" }, [at("/mnt/nas")]))).toEqual({ gone: [], unreachable: [dir] });
  });

  it.skipIf(process.platform === "win32").each(["/Volumes/USB/project", "/media/me/USB/project", "/run/media/me/USB/project"])(
    "never forgets %s while its volume is unplugged",
    (dir) => {
      expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent", [path.dirname(dir)]: "absent" }))).toEqual({ gone: [], unreachable: [dir] });
    },
  );

  it("leaves present directories out of both lists, keeping the saved order for the rest", () => {
    const [a, b, c, d] = ["/w/a", "/w/b", "/v/x/c", "/w/d"].map(at);
    const result = classifyMissingPresets([a, b, c, d], fsWith({ [b]: "absent", [c]: "absent", [at("/v/x")]: "absent", [d]: "absent" }));
    expect(result).toEqual({ gone: [b, d], unreachable: [c] });
  });

  it("never asks about a relative path or a filesystem root", () => {
    const asked: string[] = [];
    const root = path.parse(process.cwd()).root;
    const result = classifyMissingPresets(["relative/dir", "", root], {
      presence: (dir) => {
        asked.push(dir);
        return "absent";
      },
      hasEntries: () => true,
    });
    expect(result).toEqual({ gone: [], unreachable: [] });
    expect(asked).toEqual([]);
  });

  it("answers empty lists for an empty input", () => {
    expect(classifyMissingPresets([], { presence: () => "absent", hasEntries: () => true })).toEqual({ gone: [], unreachable: [] });
  });
});

describe("decidePrune", () => {
  const DAY = MISSING_CONFIRM_MS;
  const NOW = 10 * DAY;
  const [kept, deleted, usb] = ["/w/kept", "/w/deleted", "/v/usb/p"].map(at);
  const fs = fsWith({ [deleted]: "absent", [usb]: "absent", [path.dirname(usb)]: "absent" });

  it("only hides a suspected deletion at first sight, and records when it was seen", () => {
    expect(decidePrune([kept, deleted, usb], fs, {}, NOW)).toEqual({ gone: [], unreachable: [deleted, usb], missingSince: { [deleted]: NOW } });
  });

  it("keeps the first sighting's time while the day has not passed", () => {
    expect(decidePrune([deleted], fs, { [deleted]: NOW - DAY + 1 }, NOW)).toEqual({
      gone: [],
      unreachable: [deleted],
      missingSince: { [deleted]: NOW - DAY + 1 },
    });
  });

  it("forgets it on a sighting at least a day after the first, and drops it from the record", () => {
    expect(decidePrune([kept, deleted], fs, { [deleted]: NOW - DAY }, NOW)).toEqual({ gone: [deleted], unreachable: [], missingSince: {} });
  });

  it("never puts an unreachable directory on the clock, however old a record says it is", () => {
    expect(decidePrune([usb], fs, { [usb]: 0 }, NOW)).toEqual({ gone: [], unreachable: [usb], missingSince: {} });
  });

  it("drops a directory that came back, or that left the list, from the record", () => {
    expect(decidePrune([kept], fs, { [kept]: 0, [at("/w/removed")]: 0 }, NOW).missingSince).toEqual({});
  });

  it("does not confirm against a first sighting in the future (a clock set back)", () => {
    expect(decidePrune([deleted], fs, { [deleted]: NOW + DAY }, NOW).gone).toEqual([]);
  });
});

describe("loadMissingSince / saveMissingSince", () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-missing-since-")));
  const file = path.join(dir, "missing-dirs.json");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips a record and reads a missing file as empty", () => {
    expect(loadMissingSince(file)).toEqual({});
    expect(saveMissingSince(file, { "/a": 1 })).toBe(true);
    expect(loadMissingSince(file)).toEqual({ "/a": 1 });
  });

  it("reads malformed JSON, a non-object, and non-number entries as nothing", () => {
    writeFileSync(file, "{ nope");
    expect(loadMissingSince(file)).toEqual({});
    writeFileSync(file, "[1, 2]");
    expect(loadMissingSince(file)).toEqual({});
    writeFileSync(file, JSON.stringify({ "/a": "yesterday", "/b": null, "/c": 5 }));
    expect(loadMissingSince(file)).toEqual({ "/c": 5 });
  });
});

describe("probeDir", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-absent-")));
  const file = path.join(root, "file.txt");
  writeFileSync(file, "x");
  afterAll(() => {
    if (existsSync(path.join(root, "locked"))) chmodSync(path.join(root, "locked"), 0o755);
    rmSync(root, { recursive: true, force: true });
  });

  it("answers present for a directory and a file that exist", () => {
    expect(probeDir(root)).toBe("present");
    expect(probeDir(file)).toBe("present");
  });

  it("answers absent for a missing path and for a path through a file (ENOTDIR)", () => {
    expect(probeDir(path.join(root, "missing"))).toBe("absent");
    expect(probeDir(path.join(file, "child"))).toBe("absent");
  });

  it.skipIf(process.platform === "win32")("answers dangling for a symlink whose target is missing", () => {
    const link = path.join(root, "link");
    symlinkSync(path.join(root, "nowhere"), link);
    expect(probeDir(link)).toBe("dangling");
  });

  it("dirHasEntries is true only for a readable directory that holds something", () => {
    expect(dirHasEntries(root)).toBe(true);
    const empty = path.join(root, "empty");
    mkdirSync(empty);
    expect(dirHasEntries(empty)).toBe(false);
    expect(dirHasEntries(path.join(root, "missing"))).toBe(false);
  });

  // The caller deletes saved entries on `true`, so a permission error must read as present.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("answers present when the path cannot be read (EACCES)", () => {
    const locked = path.join(root, "locked");
    mkdirSync(path.join(locked, "inner"), { recursive: true });
    chmodSync(locked, 0o000);
    expect(probeDir(path.join(locked, "inner"))).toBe("present");
  });
});
