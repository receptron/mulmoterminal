// `Promise.all(files.map(read))` with a ceiling on how many run at once.
//
// Written for the codex session listing, which opens every rollout in `~/.codex/sessions` — a
// store that grows without bound (3000+ files on a heavy user's machine). An unbounded
// `Promise.all` asks the OS for that many descriptors in one tick and fails with EMFILE, and the
// failure arrives as "no sessions" rather than as an error the caller can see.
//
// Results keep the input order, so a caller can still zip them against the array it passed in.

/** Run `fn` over `items` with at most `limit` in flight, preserving input order. */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  // One iterator shared by every worker: `next()` is synchronous, so each worker takes a distinct
  // entry without a lock — and it types as [number, T], which indexing would widen to `T |
  // undefined` under noUncheckedIndexedAccess.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) out[index] = await fn(item, index);
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}
