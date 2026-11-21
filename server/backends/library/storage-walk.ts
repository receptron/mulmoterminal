// The space a path takes on disk, as `du` counts it (#3333): every entry's allocated blocks, the
// directories' own included, never following a symbolic link (the link is counted, not its target).
// Something that cannot be read is counted as unreadable and skipped, so one locked folder does not
// void the rest. The file system is passed in, so the rules are tested without a disk.
import type { StorageSize } from "../../../common/libraryStorage.js";

export interface WalkStat {
  size: number;
  /** 512-byte blocks allocated; undefined where the platform has none (Windows). */
  blocks?: number | undefined;
  isDirectory(): boolean;
}

export interface WalkFs {
  lstat(path: string): Promise<WalkStat>;
  readdir(path: string): Promise<string[]>;
  join(dir: string, name: string): string;
}

const BLOCK_BYTES = 512;
/** How many entries of one directory are looked at together. */
export const WALK_BATCH = 64;

/** What one entry takes on disk. */
export const diskBytes = (stat: WalkStat): number => (typeof stat.blocks === "number" ? stat.blocks * BLOCK_BYTES : stat.size);

const NOTHING: StorageSize = { bytes: 0, files: 0, unreadable: 0 };

export const addSizes = (a: StorageSize, b: StorageSize): StorageSize => ({
  bytes: a.bytes + b.bytes,
  files: a.files + b.files,
  unreadable: a.unreadable + b.unreadable,
});

/** One entry's own space, and the children to look at next when it is a readable directory. */
async function visit(path: string, fs: WalkFs): Promise<{ size: StorageSize; children: string[] }> {
  const stat = await fs.lstat(path).catch(() => null);
  if (stat === null) return { size: { ...NOTHING, unreadable: 1 }, children: [] };
  const bytes = diskBytes(stat);
  if (!stat.isDirectory()) return { size: { bytes, files: 1, unreadable: 0 }, children: [] };
  const names = await fs.readdir(path).catch(() => null);
  if (names === null) return { size: { bytes, files: 0, unreadable: 1 }, children: [] };
  return { size: { bytes, files: 0, unreadable: 0 }, children: names.map((name) => fs.join(path, name)) };
}

/** The space `path` takes, all the way down. Walked from a list of paths still to look at, the newest
 *  batch at a time (depth first, so the list stays short), with no more than one batch in flight. */
export async function measurePath(path: string, fs: WalkFs): Promise<StorageSize> {
  const pending = [path];
  let total = NOTHING;
  while (pending.length > 0) {
    const visited = await Promise.all(pending.splice(Math.max(0, pending.length - WALK_BATCH)).map((next) => visit(next, fs)));
    visited.forEach(({ size, children }) => {
      total = addSizes(total, size);
      children.forEach((child) => pending.push(child));
    });
  }
  return total;
}
