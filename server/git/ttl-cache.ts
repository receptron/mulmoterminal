export interface TtlCache<T> {
  get(key: string, now: () => number, ttlMs: number): T | undefined;
  set(key: string, value: T, now: () => number): void;
  clear(): void;
}

// A per-key cache whose entries go stale ttlMs after they were written. The clock is
// injected as `now` so tests can drive expiry deterministically; get reads it only on a
// hit, so probing a missing key never advances an injected clock.
export function createTtlCache<T>(): TtlCache<T> {
  const store = new Map<string, { value: T; at: number }>();
  return {
    get(key, now, ttlMs) {
      const hit = store.get(key);
      return hit && now() - hit.at < ttlMs ? hit.value : undefined;
    },
    set(key, value, now) {
      store.set(key, { value, at: now() });
    },
    clear() {
      store.clear();
    },
  };
}
