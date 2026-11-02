// What one listing entry is. A Dirent reports the entry ITSELF, so a symlink or a Windows junction
// to a folder reads as "not a directory"; the followed stat is what says where it leads.
export interface FollowedStat {
  isDirectory(): boolean;
  size: number;
}

export interface BrowseEntry {
  name: string;
  dir: boolean;
  size: number;
}

/** `followed` is the entry's stat through any link, or null when it cannot be had (a broken
 *  link, a permission error) — such an entry stays a file of size 0 the editor will refuse. */
export function browseEntryOf(name: string, direntIsDirectory: boolean, followed: () => FollowedStat | null): BrowseEntry {
  if (direntIsDirectory) return { name, dir: true, size: 0 };
  const stat = followed();
  if (stat === null) return { name, dir: false, size: 0 };
  return stat.isDirectory() ? { name, dir: true, size: 0 } : { name, dir: false, size: stat.size };
}
