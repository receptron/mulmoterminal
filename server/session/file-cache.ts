// A tiny memo keyed by a file's (mtime, size): reuse a derived value while the file is
// unchanged, recompute only when it's written. Purpose-built for the session-transcript
// summary, whose input `.jsonl` is append-only and can be hundreds of MB — re-reading and
// re-parsing it on every window focus / grid-cell refresh stalls the event loop.
//
// `size` guards the sub-millisecond case where a file is rewritten within the same mtime
// tick; together (mtime, size) is a cheap, good-enough freshness stamp (a full content hash
// would defeat the point — we're avoiding reading the file at all on a hit).

export interface FileStamp {
  mtimeMs: number;
  size: number;
}

const sameStamp = (a: FileStamp, b: FileStamp): boolean => a.mtimeMs === b.mtimeMs && a.size === b.size;

export interface FileCache<T> {
  get(key: string, stamp: FileStamp): T | undefined;
  set(key: string, stamp: FileStamp, value: T): void;
}

// Bounded by `max` entries with rough-LRU eviction (a hit/refresh moves the key to the end,
// so the oldest untouched key is evicted first), so a machine that has opened thousands of
// sessions doesn't retain every summary forever.
export function createFileCache<T>(max = 500): FileCache<T> {
  const entries = new Map<string, { stamp: FileStamp; value: T }>();
  return {
    get(key, stamp) {
      const hit = entries.get(key);
      if (!hit || !sameStamp(hit.stamp, stamp)) return undefined;
      entries.delete(key); // move to end (most-recently used)
      entries.set(key, hit);
      return hit.value;
    },
    set(key, stamp, value) {
      entries.delete(key);
      entries.set(key, { stamp, value });
      if (entries.size > max) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
  };
}
