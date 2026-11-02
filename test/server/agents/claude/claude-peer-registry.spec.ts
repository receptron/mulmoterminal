// @vitest-environment node
// Reading Claude Code's session registry (#3237): every claude home, live processes only, and one
// read shared by the cells that ask within a moment of each other.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  forgetClaudePeers,
  isProcessAlive,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_SCANNED,
  PEERS_CACHE_MS,
  processStartTimes,
  readClaudePeers,
  readPeersIn,
} from "../../../../server/agents/claude/claude-peer-registry";
import { setAccountsProvider } from "../../../../server/session/session-home";

let home = "";
const defaultHome = () => path.join(home, ".claude");

const entry = (over: Record<string, unknown>): Record<string, unknown> => ({
  pid: 4321,
  sessionId: "s-1",
  cwd: "/x",
  name: "proj-ab",
  nameSource: "derived",
  tmux: "mt-s-1:@0.%0",
  updatedAt: 10,
  ...over,
});

async function write(claudeHome: string, file: string, body: string): Promise<void> {
  const dir = path.join(claudeHome, "sessions");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), body);
}

const alive = (pid: number): boolean => pid !== 99;
/** No OS answer about starts: the registry specs above are about the files. */
const unknownStarts = async (): Promise<null> => null;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-claude-peers-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  setAccountsProvider(() => []);
  forgetClaudePeers();
});

afterEach(async () => {
  vi.restoreAllMocks();
  setAccountsProvider(() => []);
  forgetClaudePeers();
  await fs.rm(home, { recursive: true, force: true });
});

describe("readPeersIn", () => {
  it("reads the live entries, and skips a dead process, a half-written file and the key files", async () => {
    await write(defaultHome(), "4321.json", JSON.stringify(entry({})));
    await write(defaultHome(), "99.json", JSON.stringify(entry({ pid: 99, name: "gone" })));
    await write(defaultHome(), "77.json", "{ not json");
    await write(defaultHome(), "4321.abcdef.key", "secret");
    const names = (await readPeersIn(defaultHome(), alive)).map((peer) => peer.name);
    expect(names).toEqual(["proj-ab"]);
  });

  it("answers none where there is no registry", async () => {
    expect(await readPeersIn(defaultHome(), alive)).toEqual([]);
  });

  // The `.key` beside an entry is that session's messaging secret. A symlink named like an entry
  // must not be followed to it — nor to anything else — so the reader opens regular files only.
  it("does not follow a symlink named like an entry", async () => {
    await write(defaultHome(), "9.abcdef.key", JSON.stringify(entry({ pid: 9, name: "via-symlink" })));
    await fs.symlink(path.join(defaultHome(), "sessions", "9.abcdef.key"), path.join(defaultHome(), "sessions", "9.json"));
    expect(await readPeersIn(defaultHome(), alive)).toEqual([]);
  });

  it("reads only files named the way the registry names them", async () => {
    await write(defaultHome(), "notes.json", JSON.stringify(entry({ pid: 5, name: "not-an-entry" })));
    await write(defaultHome(), "5.json.bak", JSON.stringify(entry({ pid: 5, name: "not-an-entry" })));
    await write(defaultHome(), "5.json", JSON.stringify(entry({ pid: 5, name: "an-entry" })));
    expect((await readPeersIn(defaultHome(), alive)).map((peer) => peer.name)).toEqual(["an-entry"]);
  });

  it("leaves a file too large to be an entry unread", async () => {
    const padded = JSON.stringify(entry({ pid: 6, name: "huge" })) + " ".repeat(MAX_ENTRY_BYTES);
    await write(defaultHome(), "6.json", padded);
    await write(defaultHome(), "7.json", JSON.stringify(entry({ pid: 7, name: "small" })));
    expect((await readPeersIn(defaultHome(), alive)).map((peer) => peer.name)).toEqual(["small"]);
  });

  it("reads at most MAX_ENTRIES files of a folder that has gone strange", async () => {
    const extra = 3;
    await Promise.all(
      Array.from({ length: MAX_ENTRIES + extra }, (_, i) =>
        write(defaultHome(), `${String(i + 1000)}.json`, JSON.stringify(entry({ pid: i + 1000, name: `p${String(i + 1000)}` }))),
      ),
    );
    expect(await readPeersIn(defaultHome(), alive)).toHaveLength(MAX_ENTRIES);
  });

  // The listing itself is bounded, not only the files opened: a folder full of names that are not
  // entries is not read to its end. The scan bound is below the entry bound here, so the order the
  // folder lists its names in cannot make the assertion flap.
  it("stops listing a folder after a bounded number of names, entries or not", async () => {
    const total = 10;
    await Promise.all(
      Array.from({ length: total }, (_, i) => write(defaultHome(), `${String(i + 1)}.json`, JSON.stringify(entry({ pid: i + 1, name: `p${String(i + 1)}` })))),
    );
    const scanned = 4;
    expect((await readPeersIn(defaultHome(), alive, { entries: MAX_ENTRIES, scanned })).length).toBeLessThanOrEqual(scanned);
    expect(await readPeersIn(defaultHome(), alive, { entries: 2, scanned })).toHaveLength(2);
    expect(MAX_SCANNED).toBeGreaterThanOrEqual(MAX_ENTRIES);
  });
});

describe("readClaudePeers", () => {
  it("reads the default home's registry and each account's", async () => {
    const second = path.join(home, "second-login");
    setAccountsProvider(() => [{ id: "second", label: "Second", agent: "claude", home: second }]);
    await write(defaultHome(), "1.json", JSON.stringify(entry({ pid: 1, name: "on-default" })));
    await write(second, "2.json", JSON.stringify(entry({ pid: 2, name: "on-second" })));
    const names = (await readClaudePeers(alive, 0, unknownStarts)).map((peer) => peer.name).sort();
    expect(names).toEqual(["on-default", "on-second"]);
  });

  it("answers one read for a short while, then reads again", async () => {
    await write(defaultHome(), "1.json", JSON.stringify(entry({ pid: 1, name: "first" })));
    expect((await readClaudePeers(alive, 1000, unknownStarts)).map((peer) => peer.name)).toEqual(["first"]);
    await write(defaultHome(), "2.json", JSON.stringify(entry({ pid: 2, name: "second" })));
    expect((await readClaudePeers(alive, 1000 + PEERS_CACHE_MS - 1, unknownStarts)).map((peer) => peer.name)).toEqual(["first"]);
    expect((await readClaudePeers(alive, 1000 + PEERS_CACHE_MS, unknownStarts)).map((peer) => peer.name).sort()).toEqual(["first", "second"]);
  });
});

describe("readClaudePeers — the process behind the entry", () => {
  // A pid proves only that some process owns the number. The entry's own start has to agree with
  // the OS's account of the process, so a crashed claude's file does not borrow a reused pid.
  it("drops an entry whose pid belongs to a process that started at another time", async () => {
    await write(defaultHome(), "1.json", JSON.stringify(entry({ pid: 1, name: "reused", startedAt: 1_000_000 })));
    await write(defaultHome(), "2.json", JSON.stringify(entry({ pid: 2, name: "genuine", startedAt: 5_000_000 })));
    const starts = async (): Promise<Map<number, number>> =>
      new Map([
        [1, 9_000_000],
        [2, 4_998_000],
      ]);
    expect((await readClaudePeers(alive, 0, starts)).map((peer) => peer.name)).toEqual(["genuine"]);
  });

  it("asks the OS about the live pids only, once", async () => {
    await write(defaultHome(), "1.json", JSON.stringify(entry({ pid: 1, name: "live", startedAt: 5_000_000 })));
    await write(defaultHome(), "99.json", JSON.stringify(entry({ pid: 99, name: "dead", startedAt: 5_000_000 })));
    const asked: number[][] = [];
    const starts = async (pids: readonly number[]): Promise<Map<number, number>> => {
      asked.push([...pids]);
      return new Map(pids.map((pid) => [pid, 5_000_000]));
    };
    expect((await readClaudePeers(alive, 0, starts)).map((peer) => peer.name)).toEqual(["live"]);
    expect(asked).toEqual([[1]]);
  });

  // The real `ps`, on this process: the spec runner started well within the tolerance of "now".
  it.skipIf(process.platform === "win32")("agrees with the OS about this process, and not about an entry claiming an old start", async () => {
    const starts = await processStartTimes([process.pid]);
    expect(starts?.get(process.pid)).toBeDefined();
    await write(defaultHome(), `${String(process.pid)}.json`, JSON.stringify(entry({ pid: process.pid, name: "this-process", startedAt: Date.now() })));
    expect((await readClaudePeers(() => true, 0)).map((peer) => peer.name)).toEqual(["this-process"]);
    forgetClaudePeers();
    await write(
      defaultHome(),
      `${String(process.pid)}.json`,
      JSON.stringify(entry({ pid: process.pid, name: "an-old-start", startedAt: Date.now() - 86_400_000 })),
    );
    expect(await readClaudePeers(() => true, 0)).toEqual([]);
  });

  // A sandbox may refuse the spawn itself, before any child exists: that is "cannot be asked" too,
  // and it must not reach the route as a rejection.
  it("answers nothing about starts when ps cannot even be started", async () => {
    const refused = (): never => {
      throw new Error("spawn EPERM");
    };
    expect(await processStartTimes([process.pid], refused as unknown as typeof spawn)).toBeNull();
  });

  it("answers no peers, and forgets the read, when a read fails outright", async () => {
    await write(defaultHome(), "1.json", JSON.stringify(entry({ pid: 1, name: "live", startedAt: 5_000_000 })));
    let calls = 0;
    const starts = async (): Promise<Map<number, number>> => {
      calls++;
      if (calls === 1) throw new Error("ps exploded");
      return new Map([[1, 5_000_000]]);
    };
    expect(await readClaudePeers(alive, 0, starts)).toEqual([]);
    expect((await readClaudePeers(alive, 0, starts)).map((peer) => peer.name)).toEqual(["live"]); // not the failure again
  });

  it("answers nothing about starts where there is nothing to ask, or where ps cannot answer", async () => {
    expect(await processStartTimes([])).toBeNull();
    // A number no process can have: ps refuses the whole call with nothing listed, which is "cannot
    // be asked", not "none of them is running".
    if (process.platform !== "win32") expect(await processStartTimes([2_147_483_647])).toBeNull();
  });
});

describe("isProcessAlive", () => {
  it("knows this process is running and that nothing runs on an unused pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2147483647)).toBe(false);
  });
});
