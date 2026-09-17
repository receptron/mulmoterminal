// @vitest-environment node
// Knowing which servers are alive (#1061). Two things depend on this and both used to guess:
// the launcher only noticed a peer when the PORT clashed, and the settings prune assumed the
// only PTYs that ever existed were its own.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { earliestStartedAt, instancesDir, isProcessAlive, liveInstances, registerInstance, servingInstances } from "../../bin/instances.js";

describe("isProcessAlive", () => {
  it("says yes for this very process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("says no for a pid that cannot exist", () => {
    // Nothing is pid 0 in the sense signal-0 tests; a huge pid is past every platform's range.
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(2 ** 31 - 1)).toBe(false);
  });

  it("says no for junk rather than throwing", () => {
    expect(isProcessAlive(Number.NaN)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });
});

describe("earliestStartedAt", () => {
  const entry = (startedAt: number | null) => ({ pid: 1, port: null, startedAt });

  it("is the moment the FIRST of them started — the cutoff a prune can trust", () => {
    expect(earliestStartedAt([entry(300), entry(100), entry(200)])).toBe(100);
  });

  it("is null when nothing else is running, which restores the unguarded prune", () => {
    expect(earliestStartedAt([])).toBeNull();
  });

  it("ignores an entry with no start time instead of treating it as time zero", () => {
    // Time zero would make every file "newer than the earliest peer" and stop the prune for good.
    expect(earliestStartedAt([entry(null), entry(500)])).toBe(500);
    expect(earliestStartedAt([entry(null)])).toBeNull();
  });
});

// The registry is only useful if a LIVE peer stays in it. Codex caught the first version deleting
// any entry it failed to parse — so a reader arriving mid-write would permanently erase a running
// peer, and the over-pruning this whole change prevents would come straight back.
describe("liveInstances — a live peer must not be erasable", () => {
  const dirs: string[] = [];
  // Both, because `os.homedir()` reads USERPROFILE on Windows and HOME everywhere else —
  // stubbing only HOME left the Windows run pointed at the runner's own home, so one test
  // failed and the parse-guard one passed while asserting nothing ("the file is still there"
  // is trivially true when the code never looked at that directory). Same shape, same reason
  // as test/server/config/unknown-config-keys.spec.ts (#1079).
  const withHome = <T>(run: () => T): T => {
    const home = mkdtempHome();
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    try {
      return run();
    } finally {
      vi.unstubAllEnvs();
    }
  };
  const mkdtempHome = () => {
    const dir = path.join(tmpdir(), `mt-instances-${process.pid}-${dirs.length}`);
    mkdirSync(path.join(dir, ".mulmoterminal", "instances"), { recursive: true });
    dirs.push(dir);
    return dir;
  };
  const entriesDir = () => path.join(homedir(), ".mulmoterminal", "instances");
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  // Guards the redirection itself. Without it, a home var the platform ignores makes every
  // test in this block read some other directory, and the ones that assert a file SURVIVES
  // keep passing while testing nothing.
  it("redirects the directory the code actually reads, not just HOME", () => {
    withHome(() => {
      // `dirs` holds only homes THIS block created, so this fails on any platform whose
      // homedir() ignores the vars we set — which is what happened on Windows.
      expect(dirs).toContain(homedir());
      expect(instancesDir()).toBe(path.join(homedir(), ".mulmoterminal", "instances"));
    });
  });

  it("leaves an entry it cannot parse alone, instead of deleting it", () => {
    withHome(() => {
      writeFileSync(path.join(entriesDir(), "999999.json"), '{"pid":9999'); // caught mid-write
      liveInstances(process.pid);
      expect(readdirSync(entriesDir())).toContain("999999.json");
    });
  });

  it("removes an entry whose owner is genuinely gone", () => {
    withHome(() => {
      writeFileSync(path.join(entriesDir(), "2147483647.json"), JSON.stringify({ pid: 2147483647, port: 1, startedAt: 1 }));
      expect(liveInstances(process.pid)).toEqual([]);
      expect(readdirSync(entriesDir())).not.toContain("2147483647.json");
    });
  });

  it("reports nothing about a file whose name disagrees with the pid inside it, and leaves it alone", () => {
    withHome(() => {
      // No writer produces this; a hand edit or corruption does. The pid is alive (this process),
      // so only the name check keeps it out of what callers act on by pid.
      writeFileSync(path.join(entriesDir(), "111.json"), JSON.stringify({ pid: process.pid, port: 1, startedAt: 1 }));
      expect(liveInstances(process.pid + 1)).toEqual([]);
      expect(readdirSync(entriesDir())).toContain("111.json");
    });
  });

  it("reports a registered peer and never itself", () => {
    withHome(() => {
      // This process is alive, so registering it and asking as somebody else must find it.
      registerInstance(34567);
      expect(liveInstances(process.pid)).toEqual([]);
      const asPeer = liveInstances(process.pid + 1);
      expect(asPeer.map((i) => i.port)).toEqual([34567]);
    });
  });

  it("leaves no partial file behind for a reader to trip over", () => {
    withHome(() => {
      registerInstance(34567);
      expect(readdirSync(entriesDir()).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    });
  });
});

// A LIVE PID IS NOT AN IDENTITY. The OS hands a number out again once its process is gone, so an
// entry left by a hard kill becomes a peer that never dies — and on the reported Windows machine
// `svchost.exe` and later `csrss.exe` were holding that number, so every start was told one was
// already running (#2090). isProcessAlive cannot see any of this; the kernel's view of who owns
// the port can.
describe("servingInstances — a reused pid is not still us", () => {
  const dirs: string[] = [];
  // `await run()` INSIDE the try, not `return run()`: the latter hands the promise back and lets
  // the finally unstub the home before a single await inside has resolved, so every assertion
  // then reads the real home directory.
  const withHome = async <T>(run: () => Promise<T>): Promise<T> => {
    const dir = path.join(tmpdir(), `mt-serving-${process.pid}-${dirs.length}`);
    mkdirSync(path.join(dir, ".mulmoterminal", "instances"), { recursive: true });
    dirs.push(dir);
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    try {
      return await run();
    } finally {
      vi.unstubAllEnvs();
    }
  };
  const entriesDir = () => path.join(homedir(), ".mulmoterminal", "instances");
  const write = (pid: number, port: number | null) => {
    writeFileSync(path.join(entriesDir(), `${pid}.json`), JSON.stringify({ pid, port, startedAt: 1 }));
    return { pid, port, startedAt: 1 };
  };
  // Same guard as the block above: without it a home var the platform ignores would make every
  // "the file survived" assertion trivially true.
  const guardRedirect = () => expect(dirs).toContain(homedir());
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("keeps the entry when the kernel says that pid owns that port", async () => {
    await withHome(async () => {
      guardRedirect();
      const entry = write(4242, 34567);
      const owners = vi.fn(async () => [4242]);
      expect(await servingInstances([entry], { owners })).toEqual([entry]);
      expect(owners).toHaveBeenCalledWith(34567);
      expect(readdirSync(entriesDir())).toContain("4242.json");
    });
  });

  it("drops a reused pid — somebody else owns the port now — and removes the file", async () => {
    await withHome(async () => {
      guardRedirect();
      const entry = write(4242, 34567);
      expect(await servingInstances([entry], { owners: async () => [9999] })).toEqual([]);
      expect(readdirSync(entriesDir())).not.toContain("4242.json");
    });
  });

  it("drops an entry whose port nobody is listening on, which is the reported shape", async () => {
    await withHome(async () => {
      guardRedirect();
      const entry = write(4242, 34567);
      // registerInstance runs inside the server's listen callback, so an entry that exists with
      // an unbound port cannot be a peer that has not finished starting. [] is a real answer.
      expect(await servingInstances([entry], { owners: async () => [] })).toEqual([]);
      expect(readdirSync(entriesDir())).not.toContain("4242.json");
    });
  });

  it("KEEPS the entry when the kernel could not be asked, unlike stop's fail-closed check", async () => {
    await withHome(async () => {
      guardRedirect();
      const entry = write(4242, 34567);
      // null is "could not ask" (no lsof, a timeout, a platform with no command). Losing the
      // second-instance warning is worse here than keeping a line that may be stale, which is the
      // opposite trade to signalling a process.
      expect(await servingInstances([entry], { owners: async () => null })).toEqual([entry]);
      expect(readdirSync(entriesDir())).toContain("4242.json");
    });
  });

  it("keeps an entry with no port rather than deleting what it cannot check", async () => {
    await withHome(async () => {
      guardRedirect();
      const entry = write(4242, null);
      const owners = vi.fn(async () => []);
      expect(await servingInstances([entry], { owners })).toEqual([entry]);
      expect(owners).not.toHaveBeenCalled();
      expect(readdirSync(entriesDir())).toContain("4242.json");
    });
  });

  it("never deletes a live server's entry over a stale file that names the same pid", async () => {
    await withHome(async () => {
      guardRedirect();
      // The live server's own entry, on a port it owns — and a file named for some other pid whose
      // content names the SAME pid on a port nobody holds. Disproving the second deleted the first,
      // because servingInstances removes `<pid>.json` (Codex, PR #2092 round 1).
      const live = process.pid;
      writeFileSync(path.join(entriesDir(), `${live}.json`), JSON.stringify({ pid: live, port: 34567, startedAt: 2 }));
      writeFileSync(path.join(entriesDir(), "111.json"), JSON.stringify({ pid: live, port: 34568, startedAt: 1 }));
      const owners = async (port: number) => (port === 34567 ? [live] : []);
      const serving = await servingInstances(liveInstances(-1), { owners });
      expect(serving.map((e) => e.port)).toEqual([34567]);
      expect(readdirSync(entriesDir())).toContain(`${live}.json`);
    });
  });

  it("says nothing is serving when there is nothing to ask about", async () => {
    expect(await servingInstances([], { owners: async () => [] })).toEqual([]);
  });
});
