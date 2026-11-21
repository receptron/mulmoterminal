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

/** One entry's own space, and its children's names when it is a directory that can be listed. */
async function visit(path: string, fs: WalkFs): Promise<{ size: StorageSize; names: string[] | null }> {
  const stat = await fs.lstat(path).catch(() => null);
  if (stat === null) return { size: { ...NOTHING, unreadable: 1 }, names: null };
  const bytes = diskBytes(stat);
  if (!stat.isDirectory()) return { size: { bytes, files: 1, unreadable: 0 }, names: null };
  const names = await fs.readdir(path).catch(() => null);
  return { size: { bytes, files: 0, unreadable: names === null ? 1 : 0 }, names };
}

/** A directory being walked: its children's names, and how far through them the walk is. */
interface Frame {
  dir: string;
  names: string[];
  next: number;
}

/** The space `path` takes, all the way down. Depth first over the directories still being walked,
 *  each holding only its names: a child's path is made when its batch is taken, and no more than
 *  one batch is in flight. */
export async function measurePath(path: string, fs: WalkFs): Promise<StorageSize> {
  const root = await visit(path, fs);
  let total = root.size;
  const frames: Frame[] = root.names === null ? [] : [{ dir: path, names: root.names, next: 0 }];
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const batch = frame.names.slice(frame.next, frame.next + WALK_BATCH);
    frame.next += batch.length;
    if (frame.next >= frame.names.length) frames.pop(); // its names are released as soon as they are all taken
    const visited = await Promise.all(batch.map((name) => visit(fs.join(frame.dir, name), fs)));
    const dir = frame.dir;
    visited.forEach(({ size, names }, at) => {
      total = addSizes(total, size);
      const name = batch[at];
      if (names !== null && names.length > 0 && name !== undefined) frames.push({ dir: fs.join(dir, name), names, next: 0 });
    });
  }
  return total;
}
