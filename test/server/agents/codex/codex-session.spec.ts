// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseSessionMetaLine,
  readSessionMeta,
  listRecentRollouts,
  snapshotSessions,
  pickFreshSession,
  watchForCodexSession,
} from "../../../../server/agents/codex/codex-session.js";

const UUID_A = "019f251d-001c-7542-b13e-9a627effce52";
const UUID_B = "019db01d-aaa3-7ba2-b597-b29a7fca488f";

const pad = (n: number): string => String(n).padStart(2, "0");
const dayDirOf = (root: string, d: Date): string => path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
const todayDir = (root: string): string => dayDirOf(root, new Date());
const metaLine = (id: string, cwd: string | null): string =>
  JSON.stringify({ timestamp: "t", type: "session_meta", payload: { id, cwd, originator: "codex-tui", source: "cli" } });

function writeRollout(root: string, id: string, cwd: string | null, extraLines: string[] = [], dir = todayDir(root)): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-x-${id}.jsonl`);
  writeFileSync(file, [metaLine(id, cwd), ...extraLines].join("\n") + "\n");
  return file;
}

describe("parseSessionMetaLine", () => {
  it("extracts id + cwd from a session_meta line", () => {
    expect(parseSessionMetaLine(metaLine(UUID_A, "/work"))).toEqual({ id: UUID_A, cwd: "/work" });
  });
  it("returns null for a non-session_meta record", () => {
    expect(parseSessionMetaLine(JSON.stringify({ type: "message", payload: { id: UUID_A } }))).toBeNull();
  });
  it("returns null for invalid JSON", () => {
    expect(parseSessionMetaLine("not json{")).toBeNull();
  });
  it("returns null when the id is not a uuid", () => {
    expect(parseSessionMetaLine(metaLine("nope", "/work"))).toBeNull();
  });
  it("keeps cwd null when absent", () => {
    expect(parseSessionMetaLine(JSON.stringify({ type: "session_meta", payload: { id: UUID_A } }))).toEqual({ id: UUID_A, cwd: null });
  });
});

describe("codex-session fs helpers", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the meta from the first line of a multi-line rollout", async () => {
    const file = writeRollout(root, UUID_A, "/work", ['{"type":"message"}', '{"type":"message"}']);
    expect(await readSessionMeta(file)).toEqual({ id: UUID_A, cwd: "/work" });
  });
  it("returns null reading a missing file", async () => {
    expect(await readSessionMeta(path.join(root, "nope.jsonl"))).toBeNull();
  });
  it("lists rollouts under today's day dir", () => {
    writeRollout(root, UUID_A, "/work");
    expect(listRecentRollouts(root)).toHaveLength(1);
  });
});

// The read is asynchronous now, so the session a watcher speaks for can die DURING it. A claim that
// outlives its session is either an attribution to a dead pty or a rollout nothing else can ever
// take, so the watcher gives it back (Codex on #1555).
describe("watchForCodexSession cancellation", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps neither the rollout nor its claim when the session was cancelled", async () => {
    const before = snapshotSessions(root);
    const file = writeRollout(root, UUID_A, "/a");
    const claimed = new Set<string>();
    const result = await watchForCodexSession(root, before, { cwd: "/a", claimed, isCancelled: () => true, maxWaitMs: 0 });
    expect(result).toBeNull();
    expect(claimed.has(file)).toBe(false);
  });

  it("keeps both when it was not cancelled", async () => {
    const before = snapshotSessions(root);
    const file = writeRollout(root, UUID_A, "/a");
    const claimed = new Set<string>();
    const result = await watchForCodexSession(root, before, { cwd: "/a", claimed, isCancelled: () => false, maxWaitMs: 0 });
    expect(result?.file).toBe(file);
    expect(claimed.has(file)).toBe(true);
  });
});

describe("pickFreshSession", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns null when nothing appeared after the snapshot", async () => {
    writeRollout(root, UUID_A, "/a");
    const before = snapshotSessions(root);
    expect(await pickFreshSession(root, before, null)).toBeNull();
  });
  it("attributes a single fresh rollout whose cwd agrees (unambiguous)", async () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/a");
    expect((await pickFreshSession(root, before, "/a"))?.id).toBe(UUID_A);
  });

  it("attributes a single fresh rollout when the caller has no cwd to check", async () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/a");
    expect((await pickFreshSession(root, before, null))?.id).toBe(UUID_A);
  });

  // The #1533 case: two spawns in DIFFERENT directories share ~/.codex, so "exactly one new file"
  // used to fire before the cwd was consulted — and the slower spawn claimed the faster spawn's
  // rollout across directories. Sole no longer beats a cwd that disagrees.
  it("refuses a single fresh rollout recorded for another directory", async () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/a");
    expect(await pickFreshSession(root, before, "/somewhere-else")).toBeNull();
  });
  it("attributes the unique cwd match when several are fresh", async () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/a");
    writeRollout(root, UUID_B, "/b");
    expect((await pickFreshSession(root, before, "/b"))?.id).toBe(UUID_B);
  });
  it("refuses to guess when several fresh rollouts share the cwd", async () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/same");
    writeRollout(root, UUID_B, "/same");
    expect(await pickFreshSession(root, before, "/same")).toBeNull();
  });
  it("refuses to guess when several are fresh and none matches the cwd", async () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/a");
    writeRollout(root, UUID_B, "/b");
    expect(await pickFreshSession(root, before, "/other")).toBeNull();
  });
  it("skips a rollout already claimed by another session", async () => {
    const before = snapshotSessions(root);
    const a = writeRollout(root, UUID_A, "/same");
    writeRollout(root, UUID_B, "/same");
    expect((await pickFreshSession(root, before, "/same", new Set([a])))?.id).toBe(UUID_B);
  });
  // Reading the meta is asynchronous now, so selecting and claiming are no longer one tick apart by
  // construction. Two watchers polling together must still not both take the same rollout — that is
  // the duplicate attribution #1533 exists to prevent, and it would map one conversation to two
  // session ids (Codex on #1555).
  it("gives one rollout to only ONE of two watchers polling at the same time", async () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/a");
    const claimed = new Set<string>();
    const picks = await Promise.all([pickFreshSession(root, before, "/a", claimed), pickFreshSession(root, before, "/a", claimed)]);
    expect(picks.filter((p) => p !== null)).toHaveLength(1);
    expect(claimed.size).toBe(1);
  });

  it("returns null when the only fresh rollout is already claimed", async () => {
    const before = snapshotSessions(root);
    const a = writeRollout(root, UUID_A, "/a");
    expect(await pickFreshSession(root, before, null, new Set([a]))).toBeNull();
  });
});

describe("watchForCodexSession", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves the session once its rollout is present", async () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/work");
    const found = await watchForCodexSession(root, before, { pollMs: 10, maxWaitMs: 500 });
    expect(found?.id).toBe(UUID_A);
    expect(found?.cwd).toBe("/work");
  });
  it("stops immediately when cancelled", async () => {
    const before = snapshotSessions(root);
    const found = await watchForCodexSession(root, before, { pollMs: 10, maxWaitMs: 5000, isCancelled: () => true });
    expect(found).toBeNull();
  });
  it("resolves null when nothing appears before the timeout", async () => {
    const before = snapshotSessions(root);
    const found = await watchForCodexSession(root, before, { pollMs: 10, maxWaitMs: 40 });
    expect(found).toBeNull();
  });

  // Two watchers awaiting the same poll interval both saw a lone rollout unclaimed when the claim
  // waited for the caller's `.then` (#1533) — so the watcher claims at the moment it selects.
  it("claims the rollout it selects, synchronously with the selection", async () => {
    const before = snapshotSessions(root);
    const file = writeRollout(root, UUID_A, "/work");
    const claimed = new Set<string>();
    const found = await watchForCodexSession(root, before, { pollMs: 10, maxWaitMs: 500, cwd: "/work", claimed });
    expect(found?.id).toBe(UUID_A);
    expect(claimed.has(file)).toBe(true);
  });
});

describe("watchForCodexSession over a long wait", () => {
  const ONE_SECOND_MS = 1000;
  const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
  const ONE_DAY_MS = 24 * 60 * ONE_MINUTE_MS;
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 10, 5, 22, 40));
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it("still catches a first prompt that comes after thirty minutes", async () => {
    const before = snapshotSessions(root);
    let settled = false;
    const watching = watchForCodexSession(root, before, { cwd: "/work" }).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(32 * ONE_MINUTE_MS);
    expect(settled).toBe(false);
    writeRollout(root, UUID_A, "/work");
    await vi.advanceTimersByTimeAsync(ONE_SECOND_MS);
    expect((await watching)?.id).toBe(UUID_A);
  });

  it("finds the rollout in the folder of the day the cell started, days later", async () => {
    const startDir = todayDir(root);
    const before = snapshotSessions(root);
    const watching = watchForCodexSession(root, before, { cwd: "/work", pollMs: ONE_MINUTE_MS, maxWaitMs: 3 * ONE_DAY_MS });
    await vi.advanceTimersByTimeAsync(2 * ONE_DAY_MS);
    writeRollout(root, UUID_A, "/work", [], startDir);
    await vi.advanceTimersByTimeAsync(ONE_DAY_MS);
    expect((await watching)?.id).toBe(UUID_A);
  });

  it("stops when the session goes, however long it has waited", async () => {
    const before = snapshotSessions(root);
    let alive = true;
    const watching = watchForCodexSession(root, before, { cwd: "/work", pollMs: ONE_MINUTE_MS, isCancelled: () => !alive });
    await vi.advanceTimersByTimeAsync(2 * ONE_DAY_MS);
    alive = false;
    await vi.advanceTimersByTimeAsync(ONE_MINUTE_MS);
    expect(await watching).toBeNull();
  });
});

describe("pickFreshSession with a scan", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps the meta of a fresh rollout that is not this session's", async () => {
    const before = snapshotSessions(root);
    const foreign = writeRollout(root, UUID_A, "/other");
    const scan = { startedAt: new Date(), metaCache: new Map() };
    expect(await pickFreshSession(root, before, "/work", undefined, scan)).toBeNull();
    expect(scan.metaCache.get(foreign)).toEqual({ id: UUID_A, cwd: "/other" });
  });

  it("decides from the kept meta on a later poll", async () => {
    const before = snapshotSessions(root);
    const file = writeRollout(root, UUID_A, "/other");
    const scan = { startedAt: new Date(), metaCache: new Map() };
    await pickFreshSession(root, before, "/work", undefined, scan);
    writeFileSync(file, metaLine(UUID_A, "/work") + "\n");
    expect(await pickFreshSession(root, before, "/work", undefined, scan)).toBeNull();
  });

  it("does not keep a rollout whose first line is not written yet", async () => {
    const before = snapshotSessions(root);
    const dir = todayDir(root);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-x-${UUID_A}.jsonl`);
    writeFileSync(file, "");
    const scan = { startedAt: new Date(), metaCache: new Map() };
    expect(await pickFreshSession(root, before, "/work", undefined, scan)).toBeNull();
    expect(scan.metaCache.has(file)).toBe(false);
    writeFileSync(file, metaLine(UUID_A, "/work") + "\n");
    expect((await pickFreshSession(root, before, "/work", undefined, scan))?.id).toBe(UUID_A);
  });
});
