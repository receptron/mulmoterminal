import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createScheduledSessionRegistry,
  heldByAnotherProcess,
  parseScheduledSessionRecord,
  scheduledSessionsDir,
  selectExpiredScheduledSessions,
  SCHEDULED_SESSION_RETENTION,
  type ScheduledSessionRecord,
} from "../../../server/session/scheduled-sessions.js";

const HOUR = 60 * 60_000;
const NOW = 1_000 * HOUR;
const policy = { keep: 3, ttlMs: 24 * HOUR };
const at = (hoursAgo: number, id = `s${hoursAgo}`): ScheduledSessionRecord => ({ id, createdAt: NOW - hoursAgo * HOUR });
const ids = (records: ScheduledSessionRecord[]) => records.map((r) => r.id);

describe("selectExpiredScheduledSessions", () => {
  it("keeps the newest `keep` and expires the rest", () => {
    const { keep, expire } = selectExpiredScheduledSessions([at(1), at(2), at(3), at(4), at(5)], NOW, policy);
    expect(ids(keep)).toEqual(["s1", "s2", "s3"]);
    expect(ids(expire)).toEqual(["s4", "s5"]);
  });

  it("expires anything past the ttl even when it is within `keep`", () => {
    const { keep, expire } = selectExpiredScheduledSessions([at(1), at(30)], NOW, policy);
    expect(ids(keep)).toEqual(["s1"]);
    expect(ids(expire)).toEqual(["s30"]);
  });

  it("keeps a record exactly at the `keep` boundary and expires the next one", () => {
    const { keep, expire } = selectExpiredScheduledSessions([at(1), at(2), at(3), at(4)], NOW, policy);
    expect(ids(keep)).toHaveLength(policy.keep);
    expect(ids(expire)).toEqual(["s4"]);
  });

  it("expires a record exactly at the ttl but keeps one a millisecond younger", () => {
    const exactly = { id: "exact", createdAt: NOW - policy.ttlMs };
    const justUnder = { id: "under", createdAt: NOW - policy.ttlMs + 1 };
    const { keep, expire } = selectExpiredScheduledSessions([exactly, justUnder], NOW, policy);
    expect(ids(keep)).toEqual(["under"]);
    expect(ids(expire)).toEqual(["exact"]);
  });

  it("returns empty lists for no records", () => {
    expect(selectExpiredScheduledSessions([], NOW, policy)).toEqual({ keep: [], expire: [] });
  });

  it("orders by age, not by array position", () => {
    const { keep, expire } = selectExpiredScheduledSessions([at(9), at(1), at(5), at(2)], NOW, policy);
    expect(ids(keep)).toEqual(["s1", "s2", "s5"]);
    expect(ids(expire)).toEqual(["s9"]);
  });

  it("does not mutate the input", () => {
    const records = [at(9), at(1)];
    selectExpiredScheduledSessions(records, NOW, policy);
    expect(ids(records)).toEqual(["s9", "s1"]);
  });

  it("expires everything when a clock jump makes every record look ancient", () => {
    const { keep, expire } = selectExpiredScheduledSessions([at(1), at(2)], NOW + 100 * HOUR, policy);
    expect(keep).toEqual([]);
    expect(ids(expire)).toEqual(["s1", "s2"]);
  });

  it("defaults to keeping 5 for 24 hours", () => {
    expect(SCHEDULED_SESSION_RETENTION).toEqual({ keep: 5, ttlMs: 24 * HOUR });
    const { keep } = selectExpiredScheduledSessions([at(1), at(2), at(3), at(4), at(5), at(6)], NOW);
    expect(ids(keep)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });
});

describe("parseScheduledSessionRecord", () => {
  const anyId = () => true;

  it("parses a well-formed entry", () => {
    expect(parseScheduledSessionRecord("a", { createdAt: 1 }, anyId)).toEqual({ id: "a", createdAt: 1 });
  });

  it("rejects an id that fails validation", () => {
    expect(parseScheduledSessionRecord("../evil", { createdAt: 1 }, (id) => id === "good")).toBeNull();
  });

  it("rejects a missing, non-numeric or non-finite createdAt", () => {
    expect(parseScheduledSessionRecord("a", {}, anyId)).toBeNull();
    expect(parseScheduledSessionRecord("a", { createdAt: "1" }, anyId)).toBeNull();
    expect(parseScheduledSessionRecord("a", { createdAt: NaN }, anyId)).toBeNull();
  });

  it("rejects a non-object payload", () => {
    expect(parseScheduledSessionRecord("a", "nope", anyId)).toBeNull();
    expect(parseScheduledSessionRecord("a", null, anyId)).toBeNull();
    expect(parseScheduledSessionRecord("a", [1], anyId)).toBeNull();
  });
});

describe("heldByAnotherProcess", () => {
  // The leak this registry exists for IS our own detached background pty: it holds a tmux
  // client, so it must NOT read as somebody else's, or nothing would ever be reaped.
  it("does not count our own pty as another process", () => {
    expect(heldByAnotherProcess(1, true)).toBe(false);
  });

  it("reports a second client while we hold one", () => {
    expect(heldByAnotherProcess(2, true)).toBe(true);
  });

  it("reports any client at all when we hold none", () => {
    expect(heldByAnotherProcess(1, false)).toBe(true);
  });

  it("treats a session with no clients as free", () => {
    expect(heldByAnotherProcess(0, false)).toBe(false);
    expect(heldByAnotherProcess(0, true)).toBe(false);
  });

  // null = tmux could not tell us, which means there is no tmux session to take away.
  it("treats an unanswerable count as not held", () => {
    expect(heldByAnotherProcess(null, false)).toBe(false);
    expect(heldByAnotherProcess(null, true)).toBe(false);
  });
});

describe("scheduledSessionsDir", () => {
  it("gives each workspace its own directory", () => {
    expect(scheduledSessionsDir("/ws/app", "/home")).not.toEqual(scheduledSessionsDir("/ws/app2", "/home"));
  });

  it("resolves a relative workspace so the same dir maps to one registry", () => {
    expect(scheduledSessionsDir("/ws/app", "/home")).toBe(scheduledSessionsDir("/ws/sub/../app", "/home"));
  });

  // A Windows path carries "\" and ":" — used raw they would break the write (or escape
  // the intended directory), silently costing Windows its restart-time cleanup.
  it("leaves no path-unsafe characters in a Windows-style workspace", () => {
    const name = path.basename(scheduledSessionsDir("C:\\Users\\RUNNER~1\\ws", "/home"));
    expect(name).toMatch(/^[a-zA-Z0-9-]+$/);
  });

  it("keeps workspaces apart even when their names fold to the same slug", () => {
    expect(scheduledSessionsDir("/ws/a.b", "/home")).not.toEqual(scheduledSessionsDir("/ws/a-b", "/home"));
  });

  it("bounds the directory name for a deep path", () => {
    const segments = Array.from({ length: 40 }, (_, i) => `segment-${i}`);
    const deep = path.join("/", ...segments);
    expect(path.basename(scheduledSessionsDir(deep, "/home")).length).toBeLessThanOrEqual(80);
  });
});

describe("createScheduledSessionRegistry", () => {
  let home = "";
  let dir = "";
  let clockMs = NOW;
  const reapSession = vi.fn();
  const killTmux = vi.fn();
  const hasTmux = vi.fn(() => true);
  const isInUse = vi.fn<(id: string) => boolean>(() => false);

  const registry = () =>
    createScheduledSessionRegistry({
      dir,
      isValidId: (id) => id.startsWith("s"),
      isInUse,
      reapSession,
      hasTmux,
      killTmux,
      policy: { keep: 2, ttlMs: 24 * HOUR },
      now: () => clockMs,
    });

  const registered = async (): Promise<string[]> => (await fs.readdir(dir).catch(() => [])).sort();
  const writeEntry = (id: string, createdAt: number) => fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ createdAt }));

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-scheduled-"));
    dir = scheduledSessionsDir("/ws/app", home);
    clockMs = NOW;
    vi.clearAllMocks();
    hasTmux.mockReturnValue(true);
    isInUse.mockReturnValue(false);
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it("records a registered session, creating the directory", async () => {
    const r = registry();
    r.register("s1");
    await r.sweep();
    expect(await registered()).toEqual(["s1.json"]);
  });

  it("reaps the oldest once the count exceeds `keep`", async () => {
    const r = registry();
    r.register("s1");
    clockMs += HOUR;
    r.register("s2");
    clockMs += HOUR;
    r.register("s3");
    await r.sweep();
    expect(reapSession).toHaveBeenCalledExactlyOnceWith("s1");
    expect(killTmux).toHaveBeenCalledExactlyOnceWith("s1");
    expect(await registered()).toEqual(["s2.json", "s3.json"]);
  });

  it("reaps a session past the ttl on a plain sweep, with nothing newly registered", async () => {
    const first = registry();
    first.register("s1");
    await first.sweep();

    clockMs += 25 * HOUR;
    await registry().sweep(); // a new process reading the same directory
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(await registered()).toEqual([]);
  });

  it("kills a tmux left behind by a previous run, whose pty is long gone", async () => {
    const first = registry();
    first.register("s1");
    await first.sweep();

    clockMs += 25 * HOUR;
    await registry().sweep();
    // reap() is a no-op without a live entry, so the direct kill is what frees the tmux.
    expect(killTmux).toHaveBeenCalledWith("s1");
  });

  it("does not kill tmux for a session whose tmux is already gone", async () => {
    const r = registry();
    r.register("s1");
    clockMs += 25 * HOUR;
    hasTmux.mockReturnValue(false);
    await r.sweep();
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(killTmux).not.toHaveBeenCalled();
  });

  it("spares an expired session that is still in use, and reaps it once it is not", async () => {
    const r = registry();
    r.register("s1");
    clockMs += 25 * HOUR;
    isInUse.mockReturnValue(true);
    await r.sweep();
    expect(reapSession).not.toHaveBeenCalled();
    expect(await registered()).toEqual(["s1.json"]);

    isInUse.mockReturnValue(false);
    await r.sweep();
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(await registered()).toEqual([]);
  });

  it("reaps the idle expired sessions even when another is in use", async () => {
    const r = registry();
    r.register("s1");
    r.register("s2");
    clockMs += 25 * HOUR;
    isInUse.mockImplementation((id: string) => id === "s1");
    await r.sweep();
    expect(reapSession).toHaveBeenCalledExactlyOnceWith("s2");
    expect(await registered()).toEqual(["s1.json"]);
  });

  it("leaves everything alone while within the policy", async () => {
    const r = registry();
    r.register("s1");
    await r.sweep();
    await r.sweep();
    expect(reapSession).not.toHaveBeenCalled();
    expect(killTmux).not.toHaveBeenCalled();
  });

  // PORT is configurable, so two servers CAN share a workspace. Neither may drop the
  // other's entries, and each must enforce retention on them.
  it("sweeps an expired session a second server registered after we started", async () => {
    const mine = registry();
    await mine.sweep();

    const peer = registry();
    peer.register("s1");
    await peer.sweep();

    clockMs += 25 * HOUR;
    await mine.sweep();
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(await registered()).toEqual([]);
  });

  it("keeps a second server's registration when we register our own", async () => {
    const mine = registry();
    await mine.sweep();

    await fs.mkdir(dir, { recursive: true });
    await writeEntry("s1", clockMs); // the peer's entry, which we never saw registered

    mine.register("s2");
    await mine.sweep();
    expect(await registered()).toEqual(["s1.json", "s2.json"]);
  });

  it("picks up the sessions a previous run of this workspace left behind", async () => {
    const previousRun = registry();
    previousRun.register("s1");
    await previousRun.sweep();

    clockMs += 25 * HOUR;
    await registry().sweep(); // the restarted server, same workspace => same directory
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(await registered()).toEqual([]);
  });

  it("leaves no temp file behind (the write is a rename, not a truncate)", async () => {
    const r = registry();
    r.register("s1");
    await r.sweep();
    expect(await registered()).toEqual(["s1.json"]);
  });

  // The id becomes a filename, so a bad one must never reach the write path.
  it("refuses to register an id that could escape the registry directory", async () => {
    const r = registry();
    const escapee = path.join("..", "..", "escaped");
    r.register(escapee);
    await r.sweep();
    expect(await registered()).toEqual([]);
    await expect(fs.stat(path.join(home, "escaped.json"))).rejects.toThrow();
  });

  it("ignores a registration whose id fails validation", async () => {
    const r = registry();
    r.register("nope"); // isValidId requires an "s" prefix
    await r.sweep();
    expect(await registered()).toEqual([]);
  });

  it("starts empty when the directory is missing", async () => {
    await registry().sweep();
    expect(reapSession).not.toHaveBeenCalled();
  });

  it("ignores an entry whose file is corrupt", async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "s1.json"), "{not json");
    await registry().sweep();
    expect(reapSession).not.toHaveBeenCalled();
  });

  it("ignores entries whose id fails validation", async () => {
    await fs.mkdir(dir, { recursive: true });
    await writeEntry("nope", clockMs - 99 * HOUR); // isValidId requires an "s" prefix
    await registry().sweep();
    expect(reapSession).not.toHaveBeenCalled();
  });

  it("ignores files that are not entries", async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "README"), "not an entry");
    await registry().sweep();
    expect(reapSession).not.toHaveBeenCalled();
  });
});
