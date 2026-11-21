// @vitest-environment node
// The Storage view's rules (#3333), both ways: what is counted and what is not, and what a setting
// reads as when it is missing, malformed or out of range.
import { describe, expect, it } from "vitest";
import { cleanupPeriodOf } from "../../../../server/backends/library/cleanup-period.js";
import { diskBytes, measurePath, WALK_BATCH, type WalkFs, type WalkStat } from "../../../../server/backends/library/storage-walk.js";
import { CLEANUP_PERIOD_DEFAULT_DAYS } from "../../../../common/libraryStorage.js";

describe("cleanupPeriodOf", () => {
  it("is the default with no settings file, or one that does not set it", () => {
    expect(cleanupPeriodOf(null)).toEqual({ state: "default", days: CLEANUP_PERIOD_DEFAULT_DAYS });
    expect(cleanupPeriodOf("{}")).toEqual({ state: "default", days: CLEANUP_PERIOD_DEFAULT_DAYS });
    expect(cleanupPeriodOf('{"model":"opus"}')).toEqual({ state: "default", days: CLEANUP_PERIOD_DEFAULT_DAYS });
  });

  it("is the value set, down to the smallest Claude Code takes", () => {
    expect(cleanupPeriodOf('{"cleanupPeriodDays":7}')).toEqual({ state: "set", days: 7 });
    expect(cleanupPeriodOf('{"cleanupPeriodDays":1}')).toEqual({ state: "set", days: 1 });
    expect(cleanupPeriodOf('{"cleanupPeriodDays":9999}')).toEqual({ state: "set", days: 9999 });
  });

  it("is unreadable for a value Claude Code would refuse, or a file that is not a settings object", () => {
    ["0", "-1", "1.5", '"7"', "null", "true", "[]"].forEach((value) => {
      expect(cleanupPeriodOf(`{"cleanupPeriodDays":${value}}`)).toEqual({ state: "unreadable" });
    });
    ["", "{", "[]", "7", "null", '"text"'].forEach((text) => expect(cleanupPeriodOf(text)).toEqual({ state: "unreadable" }));
  });
});

/** A tree in memory: a path is a file (its stat), a directory (its names), or missing / unreadable. */
type Node = { file: WalkStat } | { dir: string[]; stat?: WalkStat } | { unlistable: true } | { unstatable: true };
const fileOf = (size: number, blocks?: number): Node => ({ file: { size, blocks, isDirectory: () => false } });

function fakeFs(tree: Record<string, Node>): WalkFs & { maxInFlight: number } {
  let inFlight = 0;
  const state = { maxInFlight: 0 };
  const track = async <T>(work: () => T): Promise<T> => {
    inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return work();
  };
  return Object.assign(state, {
    join: (dir: string, name: string) => `${dir}/${name}`,
    lstat: (at: string) =>
      track(() => {
        const node = tree[at];
        if (node === undefined || "unstatable" in node) throw new Error(`ENOENT ${at}`);
        if ("file" in node) return node.file;
        return { size: 96, blocks: 8, isDirectory: () => true };
      }),
    readdir: (at: string) =>
      track(() => {
        const node = tree[at];
        if (node !== undefined && "dir" in node) return node.dir;
        throw new Error(`EACCES ${at}`);
      }),
  });
}

describe("measurePath", () => {
  it("counts blocks on disk, and the size where the platform has no blocks", () => {
    expect(diskBytes({ size: 10, blocks: 8, isDirectory: () => false })).toBe(4096);
    expect(diskBytes({ size: 10, blocks: 0, isDirectory: () => false })).toBe(0);
    expect(diskBytes({ size: 10, isDirectory: () => false })).toBe(10);
  });

  it("adds every file and the directories themselves, all the way down", async () => {
    const fs = fakeFs({ "/h": { dir: ["a", "sub"] }, "/h/a": fileOf(1, 2), "/h/sub": { dir: ["b"] }, "/h/sub/b": fileOf(1, 4) });
    expect(await measurePath("/h", fs)).toEqual({ bytes: (8 + 2 + 8 + 4) * 512, files: 2, unreadable: 0 });
  });

  it("counts a symbolic link as itself and does not follow it", async () => {
    // lstat answers for the link: not a directory, so its target is never listed.
    const fs = fakeFs({ "/h": { dir: ["link"] }, "/h/link": fileOf(20, 0), "/elsewhere": { dir: ["big"] } });
    expect(await measurePath("/h", fs)).toEqual({ bytes: 8 * 512, files: 1, unreadable: 0 });
  });

  it("counts what cannot be read and carries on with the rest", async () => {
    const fs = fakeFs({
      "/h": { dir: ["gone", "locked", "ok"] },
      "/h/gone": { unstatable: true },
      "/h/locked": { unlistable: true },
      "/h/ok": fileOf(1, 1),
    });
    expect(await measurePath("/h", fs)).toEqual({ bytes: (8 + 8 + 1) * 512, files: 1, unreadable: 2 });
    expect(await measurePath("/missing", fs)).toEqual({ bytes: 0, files: 0, unreadable: 1 });
  });

  it("an empty directory is its own space and no file", async () => {
    expect(await measurePath("/e", fakeFs({ "/e": { dir: [] } }))).toEqual({ bytes: 8 * 512, files: 0, unreadable: 0 });
  });

  it("never has more than one batch in flight, however wide or deep the tree", async () => {
    const wide = Array.from({ length: WALK_BATCH * 3 + 5 }, (_, i) => `f${String(i)}`);
    const tree: Record<string, Node> = { "/w": { dir: [...wide, "d"] }, "/w/d": { dir: wide } };
    wide.forEach((name) => {
      tree[`/w/${name}`] = fileOf(1, 1);
      tree[`/w/d/${name}`] = fileOf(1, 1);
    });
    const fs = fakeFs(tree);
    const size = await measurePath("/w", fs);
    expect(size.files).toBe(wide.length * 2);
    expect(fs.maxInFlight).toBeLessThanOrEqual(WALK_BATCH);
  });
});
