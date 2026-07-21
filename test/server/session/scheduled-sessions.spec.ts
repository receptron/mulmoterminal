import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createScheduledSessionRegistry,
  mergeScheduledSessions,
  parseScheduledSessions,
  scheduledSessionsFile,
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

describe("parseScheduledSessions", () => {
  const anyId = () => true;

  it("parses well-formed records", () => {
    expect(parseScheduledSessions([{ id: "a", createdAt: 1 }], anyId)).toEqual([{ id: "a", createdAt: 1 }]);
  });

  it("drops ids that fail validation", () => {
    const raw = [
      { id: "good", createdAt: 1 },
      { id: "../evil", createdAt: 2 },
    ];
    expect(parseScheduledSessions(raw, (id) => id === "good")).toEqual([{ id: "good", createdAt: 1 }]);
  });

  it("drops entries with a missing or non-numeric createdAt", () => {
    expect(parseScheduledSessions([{ id: "a" }, { id: "b", createdAt: "1" }, { id: "c", createdAt: NaN }], anyId)).toEqual([]);
  });

  it("drops non-object entries", () => {
    expect(parseScheduledSessions(["a", 1, null, undefined], anyId)).toEqual([]);
  });

  it("returns [] for a non-array (an object, a primitive, null)", () => {
    expect(parseScheduledSessions({ id: "a", createdAt: 1 }, anyId)).toEqual([]);
    expect(parseScheduledSessions("nope", anyId)).toEqual([]);
    expect(parseScheduledSessions(null, anyId)).toEqual([]);
  });

  it("returns [] for an empty array", () => {
    expect(parseScheduledSessions([], anyId)).toEqual([]);
  });
});

describe("mergeScheduledSessions", () => {
  const none = new Set<string>();

  it("keeps the ids a second server on this workspace wrote", () => {
    expect(mergeScheduledSessions([at(1, "theirs")], [at(2, "ours")], none)).toEqual([at(2, "ours"), at(1, "theirs")]);
  });

  it("prefers our own record for an id present on both sides", () => {
    const ours = { id: "same", createdAt: 200 };
    expect(mergeScheduledSessions([{ id: "same", createdAt: 100 }], [ours], none)).toEqual([ours]);
  });

  it("never resurrects an id this process already reaped", () => {
    expect(mergeScheduledSessions([at(1, "gone")], [], new Set(["gone"]))).toEqual([]);
  });

  it("returns our records unchanged when the file is empty", () => {
    expect(mergeScheduledSessions([], [at(1, "ours")], none)).toEqual([at(1, "ours")]);
  });

  it("adopts the file's records when we hold none", () => {
    expect(mergeScheduledSessions([at(1, "theirs")], [], none)).toEqual([at(1, "theirs")]);
  });
});

describe("scheduledSessionsFile", () => {
  // One writer per file is what makes the plain overwrite safe — two clones must never
  // land on the same path, however similar their names.
  it("gives each workspace its own file", () => {
    expect(scheduledSessionsFile("/ws/app", "/home")).not.toEqual(scheduledSessionsFile("/ws/app2", "/home"));
  });

  it("encodes the absolute path the way Claude encodes its project dirs", () => {
    expect(scheduledSessionsFile("/ws/my.app", "/home")).toBe(path.join("/home", "scheduled-sessions", "-ws-my-app.json"));
  });

  it("resolves a relative workspace so the same dir maps to one file", () => {
    expect(scheduledSessionsFile("/ws/app", "/home")).toBe(scheduledSessionsFile("/ws/sub/../app", "/home"));
  });
});

describe("createScheduledSessionRegistry", () => {
  let dir = "";
  let file = "";
  let clockMs = NOW;
  const reapSession = vi.fn();
  const killTmux = vi.fn();
  const hasTmux = vi.fn(() => true);
  const isAttached = vi.fn<(id: string) => boolean>(() => false);

  const registry = () =>
    createScheduledSessionRegistry({
      file,
      isValidId: (id) => id.startsWith("s"),
      isAttached,
      reapSession,
      hasTmux,
      killTmux,
      policy: { keep: 2, ttlMs: 24 * HOUR },
      now: () => clockMs,
    });

  const readFile = async () => JSON.parse(await fs.readFile(file, "utf8"));

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-scheduled-"));
    file = path.join(dir, "nested", "scheduled-sessions.json");
    clockMs = NOW;
    vi.clearAllMocks();
    hasTmux.mockReturnValue(true);
    isAttached.mockReturnValue(false);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("persists registered sessions, creating the directory", async () => {
    const r = registry();
    r.register("s1");
    await r.sweep();
    expect(await readFile()).toEqual([{ id: "s1", createdAt: NOW }]);
  });

  it("reaps the oldest once the count exceeds `keep`", async () => {
    const r = registry();
    r.register("s1");
    clockMs += HOUR;
    r.register("s2");
    clockMs += HOUR;
    r.register("s3");
    await r.sweep();
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(killTmux).toHaveBeenCalledWith("s1");
    expect((await readFile()).map((rec: ScheduledSessionRecord) => rec.id)).toEqual(["s3", "s2"]);
  });

  it("reaps a session past the ttl on a plain sweep, with nothing newly registered", async () => {
    const first = registry();
    first.register("s1");
    await first.sweep();

    clockMs += 25 * HOUR;
    const restarted = registry(); // a new process reading the same file
    await restarted.sweep();
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(await readFile()).toEqual([]);
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

  it("spares an expired session the user currently has open, and reaps it once they leave", async () => {
    const r = registry();
    r.register("s1");
    clockMs += 25 * HOUR;
    isAttached.mockReturnValue(true);
    await r.sweep();
    expect(reapSession).not.toHaveBeenCalled();

    isAttached.mockReturnValue(false);
    await r.sweep();
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(await readFile()).toEqual([]);
  });

  it("reaps the unattached expired sessions even when another is being viewed", async () => {
    const r = registry();
    r.register("s1");
    r.register("s2");
    clockMs += 25 * HOUR;
    isAttached.mockImplementation((id: string) => id === "s1");
    await r.sweep();
    expect(reapSession).toHaveBeenCalledExactlyOnceWith("s2");
    expect((await readFile()).map((rec: ScheduledSessionRecord) => rec.id)).toEqual(["s1"]);
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
  // other's ids, and each must enforce retention on them.
  it("sweeps an expired id a second server registered after we hydrated", async () => {
    const mine = registry();
    await mine.sweep(); // hydrates from an empty file — s1 does not exist yet

    const peer = registry();
    peer.register("s1");
    await peer.sweep();

    clockMs += 25 * HOUR;
    await mine.sweep(); // only a sweep-time reconcile can see s1 at all
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(await readFile()).toEqual([]);
  });

  it("re-adds an id of ours that a second server overwrote", async () => {
    const mine = registry();
    mine.register("s1");
    await mine.sweep();

    // The peer hydrated before s1 existed and writes its own view over ours.
    await fs.writeFile(file, JSON.stringify([{ id: "s2", createdAt: clockMs }]));

    await mine.sweep();
    expect((await readFile()).map((rec: ScheduledSessionRecord) => rec.id).sort()).toEqual(["s1", "s2"]);
  });

  it("picks up the ids a previous run of this workspace left behind", async () => {
    const previousRun = registry();
    previousRun.register("s1");
    await previousRun.sweep();

    clockMs += 25 * HOUR;
    await registry().sweep(); // the restarted server, same workspace => same file
    expect(reapSession).toHaveBeenCalledWith("s1");
    expect(await readFile()).toEqual([]);
  });

  it("leaves no temp file behind (the write is a rename, not a truncate)", async () => {
    const r = registry();
    r.register("s1");
    await r.sweep();
    expect(await fs.readdir(path.dirname(file))).toEqual(["scheduled-sessions.json"]);
  });

  it("starts empty when the file is missing", async () => {
    await registry().sweep();
    expect(reapSession).not.toHaveBeenCalled();
  });

  it("starts empty (and does not throw) when the file is corrupt", async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not json");
    const r = registry();
    r.register("s1");
    await r.sweep();
    expect(await readFile()).toEqual([{ id: "s1", createdAt: NOW }]);
  });

  it("ignores persisted entries whose id fails validation", async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify([{ id: "../evil", createdAt: NOW - 99 * HOUR }]));
    await registry().sweep();
    expect(reapSession).not.toHaveBeenCalled();
  });
});
