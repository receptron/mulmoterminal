// @vitest-environment node
// Reading Claude Code's session registry (#3237): every claude home, live processes only, and one
// read shared by the cells that ask within a moment of each other.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    const names = (await readClaudePeers(alive, 0)).map((peer) => peer.name).sort();
    expect(names).toEqual(["on-default", "on-second"]);
  });

  it("answers one read for a short while, then reads again", async () => {
    await write(defaultHome(), "1.json", JSON.stringify(entry({ pid: 1, name: "first" })));
    expect((await readClaudePeers(alive, 1000)).map((peer) => peer.name)).toEqual(["first"]);
    await write(defaultHome(), "2.json", JSON.stringify(entry({ pid: 2, name: "second" })));
    expect((await readClaudePeers(alive, 1000 + PEERS_CACHE_MS - 1)).map((peer) => peer.name)).toEqual(["first"]);
    expect((await readClaudePeers(alive, 1000 + PEERS_CACHE_MS)).map((peer) => peer.name).sort()).toEqual(["first", "second"]);
  });
});

describe("isProcessAlive", () => {
  it("knows this process is running and that nothing runs on an unused pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2147483647)).toBe(false);
  });
});
