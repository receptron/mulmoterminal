import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRateLimitCacheWriter, parseRateLimitCache } from "./rate-limit-persist";
import type { RateLimitSnapshot } from "./rate-limit-store";

const snapshot = (percent: number): RateLimitSnapshot => ({
  codex: { limits: { fiveHour: { usedPercentage: percent, resetsAt_sec: 1 }, sevenDay: null }, reportedAt_ms: 1 },
});

const cachedPercent = (file: string): number | null | undefined => parseRateLimitCache(readFileSync(file, "utf8")).codex?.limits.fiveHour?.usedPercentage;

// The file survives upgrades, so it is the one input guaranteed to have been written by a
// different version of this code — junk in it must cost the head start, never the feature.
describe("parseRateLimitCache", () => {
  it.each([
    ["not JSON at all", "{ not json"],
    ["a JSON array", "[]"],
    // #1074 swapped a hand-copied `isRecord` for the shared one, which REJECTS arrays where the
    // copy accepted them. Same answer either way — pinned so the swap stays invisible.
    ["an array holding what looks like an entry", '[{"codex":{"limits":{"fiveHour":{"usedPercentage":5}},"reportedAt_ms":1}}]'],
    ["an entry that is an array", '{"codex":[{"limits":{"fiveHour":{"usedPercentage":5}},"reportedAt_ms":1}]}'],
    ["an entry with no timestamp", '{"codex":{"limits":{"fiveHour":{"usedPercentage":5}}}}'],
  ])("reads %s as an empty cache", (_case, text) => {
    expect(parseRateLimitCache(text)).toEqual({});
  });

  it("keeps an entry that carries both the limits and the timestamp", () => {
    const text = JSON.stringify(snapshot(42));
    expect(parseRateLimitCache(text).codex?.limits.fiveHour?.usedPercentage).toBe(42);
  });
});

describe("createRateLimitCacheWriter", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-rl-cache-"));
    file = path.join(dir, "rate-limits.json");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the first time", () => {
    createRateLimitCacheWriter(file)(snapshot(10));
    expect(cachedPercent(file)).toBe(10);
  });

  // The caller is a request handler and the write is synchronous. Codex is re-read on every poll
  // and its windows move once every few minutes at most, so without this the same bytes hit the
  // event loop several times a minute — and every few seconds while a probe is in flight.
  it("does not write again when nothing changed", () => {
    const write = createRateLimitCacheWriter(file);
    write(snapshot(10));
    const first = statSync(file).mtimeMs;

    write(snapshot(10));
    expect(statSync(file).mtimeMs).toBe(first);

    write(snapshot(11));
    expect(cachedPercent(file)).toBe(11);
  });

  // Windows has no POSIX mode bits — `chmod` there only really moves the read-only flag, so the
  // file comes back 0o666. The behaviour under test (0600 on the platforms that have it) is
  // unchanged; asserting it on Windows tests Node's emulation, not our code. Same skip as
  // session-settings.spec.ts, which guards the identical assertion.
  it.skipIf(process.platform === "win32")("keeps the file private", () => {
    createRateLimitCacheWriter(file)(snapshot(10));
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  // A write that failed must not be remembered as done, or the cache would stay wrong until the
  // value happened to change again — which for a rate-limit window can be hours.
  it("retries after a failed write rather than assuming it landed", () => {
    const missing = path.join(dir, "not-there-yet");
    const target = path.join(missing, "rate-limits.json");
    const write = createRateLimitCacheWriter(target);

    write(snapshot(10)); // the directory does not exist — swallowed
    expect(() => statSync(target)).toThrow();

    mkdirSync(missing, { recursive: true });
    write(snapshot(10)); // the SAME snapshot must still be written
    expect(cachedPercent(target)).toBe(10);
  });
});
