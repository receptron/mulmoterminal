// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

import {
  askServerToStop,
  stopInstances,
  stopReport,
  stopExitCode,
  describeInstance,
  manualStopCommand,
  parseStopArgs,
  confirmInstance,
  selectByPort,
  noServerOnPortReport,
} from "../../bin/stop.js";

const instance = (pid: number, port: number | null = 34567) => ({ pid, port, startedAt: 1 });

// These instances sit on 34567, the port a LIVE server answers on, and the real request stops it —
// a run of this file once did. So every call goes through `stop`, which never sends the real one,
// and fetch itself refuses for anything that slips past.
type StopEffects = NonNullable<Parameters<typeof stopInstances>[1]>;
const stop = (instances: Parameters<typeof stopInstances>[0], effects: StopEffects) => stopInstances(instances, { request: async () => false, ...effects });
beforeAll(() => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("stop.spec must not reach a real server");
  });
});
afterAll(() => vi.unstubAllGlobals());

// The effects are injected, so a whole stop can be observed without a process to kill. `alive` is
// the world: a pid in the set is running, and a kill that "works" takes it out.
const world = (alive: number[], kill?: (pid: number) => void) => {
  const running = new Set(alive);
  return {
    running,
    effects: {
      kill: kill ?? ((pid: number) => running.delete(pid)),
      // Never the real request: these instances sit on 34567, the port a live server uses.
      request: async () => false,
      isAlive: (pid: number) => running.has(pid),
      sleep: async () => {},
      graceMs: 300,
      // Identity is proved separately below; these cases are about the stopping itself.
      confirm: async () => true,
    },
  };
};

const refuse = (code: string) => (pid: number) => {
  const err: NodeJS.ErrnoException = new Error(`kill ${pid}`);
  err.code = code;
  throw err;
};

describe("stopInstances", () => {
  it("stops every running server, not just the first", async () => {
    const { effects } = world([11, 22]);
    const result = await stop([instance(11, 34567), instance(22, 34568)], effects);
    expect(result.stopped.map((i) => i.pid)).toEqual([11, 22]);
    expect(result.stubborn).toEqual([]);
  });

  it("treats a server that ended on its own as nothing to report", async () => {
    // ESRCH is the registry being a moment stale — the user asked for it to be stopped and it is.
    const { effects } = world([], refuse("ESRCH"));
    const result = await stop([instance(11)], effects);
    expect(result.stopped).toEqual([]);
    expect(result.stubborn).toEqual([]);
  });

  it("reports a server it is not allowed to stop, rather than claiming success", async () => {
    const { effects } = world([11], refuse("EPERM"));
    const result = await stop([instance(11)], effects);
    expect(result.stopped).toEqual([]);
    expect(result.stubborn).toEqual([{ pid: 11, port: 34567, startedAt: 1, reason: "EPERM" }]);
  });

  it("gives up on a server that outlives the grace period, and says which", async () => {
    const { effects } = world([11]);
    const result = await stop([instance(11)], { ...effects, kill: () => {} });
    expect(result.stopped).toEqual([]);
    expect(result.stubborn.map((i) => i.reason)).toEqual(["still running"]);
  });

  it("waits for a slow shutdown instead of calling it stubborn", async () => {
    // The window exists because SIGTERM runs the same shutdown Ctrl+C runs, which is not instant.
    const { running, effects } = world([11]);
    let polls = 0;
    const result = await stop([instance(11)], {
      ...effects,
      kill: () => {},
      isAlive: (pid: number) => {
        if (++polls > 2) running.delete(pid);
        return running.has(pid);
      },
    });
    expect(result.stopped.map((i) => i.pid)).toEqual([11]);
  });

  it("asks them all before waiting on any, so one slow server does not delay the rest", async () => {
    const order: string[] = [];
    const { effects } = world([11, 22]);
    await stop([instance(11), instance(22)], {
      ...effects,
      kill: (pid: number) => order.push(`kill:${pid}`),
      isAlive: () => {
        order.push("poll");
        return false;
      },
    });
    expect(order.indexOf("kill:22")).toBeLessThan(order.indexOf("poll"));
  });

  it("sends SIGTERM by default — the signal the server has a handler for", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    // force, so this stays about the SIGNAL and does not depend on a server answering.
    await stop([instance(11)], { isAlive: () => false, sleep: async () => {}, graceMs: 0, force: true, request: async () => true });
    expect(kill).toHaveBeenCalledWith(11, "SIGTERM");
    kill.mockRestore();
  });
});

// #3234. On Windows the signal is TerminateProcess, so the server is asked over HTTP first and the
// signal is only the fallback.
describe("stopInstances asks over HTTP first", () => {
  it("sends no signal to a server that took the request, and waits for it to go", async () => {
    const { running, effects } = world([11]);
    const kill = vi.fn();
    let polls = 0;
    const result = await stop([instance(11)], {
      ...effects,
      kill,
      request: async () => true,
      isAlive: (pid: number) => {
        if (++polls > 1) running.delete(pid);
        return running.has(pid);
      },
    });
    expect(kill).not.toHaveBeenCalled();
    expect(result.stopped.map((i) => i.pid)).toEqual([11]);
  });

  it("signals a server that did not take the request", async () => {
    const { effects } = world([11]);
    const kill = vi.fn();
    await stop([instance(11)], { ...effects, kill, request: async () => false });
    expect(kill).toHaveBeenCalledWith(11);
  });

  it("does not ask an unconfirmed server under --force, since the port may be someone else's", async () => {
    const { effects } = world([11]);
    const request = vi.fn(async () => true);
    const kill = vi.fn();
    await stop([instance(11)], { ...effects, kill, request, confirm: async () => false, force: true });
    expect(request).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith(11);
  });

  it("never asks a server it could not confirm", async () => {
    const { effects } = world([11]);
    const request = vi.fn(async () => true);
    await stop([instance(11)], { ...effects, request, confirm: async () => false });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("askServerToStop", () => {
  it("posts to the instance's own shutdown route with the Origin the browser sends", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    expect(await askServerToStop(instance(11, 34601), { fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:34601/api/shutdown",
      expect.objectContaining({ method: "POST", headers: { Origin: "http://localhost:34601" } }),
    );
  });

  it("is false for a refusal, a failed connection, or no answer in time", async () => {
    expect(await askServerToStop(instance(11), { fetchImpl: async () => ({ ok: false }) })).toBe(false);
    expect(
      await askServerToStop(instance(11), {
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    ).toBe(false);
    const hang = (_url: string, init: RequestInit) =>
      new Promise<{ ok: boolean }>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await askServerToStop(instance(11), { fetchImpl: hang, timeoutMs: 10 })).toBe(false);
  });
});

describe("stopReport", () => {
  it("says so plainly when nothing was running", () => {
    expect(stopReport({ stopped: [], stubborn: [], unconfirmed: [] })).toEqual(["MulmoTerminal is not running."]);
  });

  it("names each server by the URL the user has open", () => {
    expect(stopReport({ stopped: [instance(11, 34567)], stubborn: [], unconfirmed: [] })).toEqual(["Stopped http://localhost:34567 (pid 11)"]);
  });

  it("hands over the pid when it could not stop one, because the registry is no longer readable to the user", () => {
    // The platform is named, because the command is not the same on all of them and this case is
    // about HANDING OVER THE PID — which one it names is pinned by the manualStopCommand suite.
    // Left to default, this assertion passes on the machine that wrote it and fails on the Windows
    // runner, which is what it did.
    const lines = stopReport({ stopped: [], stubborn: [{ ...instance(11), reason: "EPERM" }], unconfirmed: [] }, "darwin");
    expect(lines.join("\n")).toContain("Could NOT stop");
    expect(lines.join("\n")).toContain("kill -9 11");
  });

  it("falls back to the pid for an instance that never recorded a port", () => {
    expect(describeInstance(instance(11, null))).toBe("pid 11");
  });
});

describe("stopExitCode", () => {
  it("succeeds when there was nothing to stop, so a script can run it before starting", () => {
    expect(stopExitCode({ stopped: [], stubborn: [], unconfirmed: [] })).toBe(0);
  });

  it("fails only when something was asked to stop and did not", () => {
    expect(stopExitCode({ stopped: [instance(11)], stubborn: [], unconfirmed: [] })).toBe(0);
    expect(stopExitCode({ stopped: [], stubborn: [{ ...instance(11), reason: "EPERM" }], unconfirmed: [] })).toBe(1);
  });
});

// A LIVE PID IS NOT AN IDENTITY (CodeRabbit, Codex). A server killed outright leaves its registry
// file behind, and the OS may hand that pid to something else — at which point signalling it would
// SIGTERM a stranger's process. The old reader of this registry only ever asked "is one running?",
// which was harmless; stopping is not.
describe("stopInstances identity check", () => {
  const alive = { isAlive: () => false, sleep: async () => {}, graceMs: 0 };

  it("does not signal a pid it cannot corroborate", async () => {
    const kill = vi.fn();
    const result = await stop([instance(11)], { ...alive, kill, confirm: async () => false });
    expect(kill).not.toHaveBeenCalled();
    expect(result.unconfirmed.map((i) => i.pid)).toEqual([11]);
    expect(result.stopped).toEqual([]);
  });

  it("signals one it can", async () => {
    const kill = vi.fn();
    const result = await stop([instance(11)], { ...alive, kill, confirm: async () => true });
    expect(kill).toHaveBeenCalledWith(11);
    expect(result.stopped.map((i) => i.pid)).toEqual([11]);
  });

  it("stops asking once --force is given, which is the way out for a server that has hung", async () => {
    const kill = vi.fn();
    const confirm = vi.fn(async () => false);
    await stop([instance(11)], { ...alive, kill, confirm, force: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith(11);
  });

  it("judges each instance on its own, so one unconfirmed entry cannot spare the others", async () => {
    const kill = vi.fn();
    const result = await stop([instance(11, 34567), instance(22, 34568)], {
      ...alive,
      kill,
      confirm: async (i) => i.pid === 22,
    });
    expect(kill.mock.calls).toEqual([[22]]);
    expect(result.unconfirmed.map((i) => i.pid)).toEqual([11]);
  });
});

describe("the report when something was left alone", () => {
  const left = { stopped: [], stubborn: [], unconfirmed: [instance(11)] };

  it("says why, rather than reporting it as stopped", () => {
    const text = stopReport(left, "darwin").join("\n");
    expect(text).toContain("could not confirm");
    expect(text).toContain("--force");
    expect(text).not.toContain("Stopped http");
  });

  it("names a --force command the reader can actually run", () => {
    // An npx user has no global `mulmoterminal`, so a hardcoded one would send them to a command
    // that does not exist — the same defect the already-running prompt was fixed for (Codex).
    expect(stopReport(left, "darwin", "npx mulmoterminal@latest stop").join("\n")).toContain("npx mulmoterminal@latest stop --force");
    expect(stopReport(left, "darwin", "mulmoterminal stop").join("\n")).toContain("mulmoterminal stop --force");
  });

  it("is a failure, because it is not what the user asked for", () => {
    expect(stopExitCode(left)).toBe(1);
  });
});

// `kill -9` is not a command in a standard Windows shell — and a Windows report is why this whole
// feature exists, so printing something unusable there would be the same failure again.
describe("manualStopCommand", () => {
  it("gives a Windows user a command Windows has", () => {
    expect(manualStopCommand([11], "win32")).toBe("taskkill /PID 11 /F");
    expect(manualStopCommand([11, 22], "win32")).toBe("taskkill /PID 11 /F && taskkill /PID 22 /F");
  });

  it("keeps the POSIX one everywhere else", () => {
    expect(manualStopCommand([11, 22], "darwin")).toBe("kill -9 11 22");
    expect(manualStopCommand([11], "linux")).toBe("kill -9 11");
  });

  it("is what the report reaches for on each platform", () => {
    const result = { stopped: [], stubborn: [{ ...instance(11), reason: "EPERM" }], unconfirmed: [] };
    expect(stopReport(result, "win32").join("\n")).toContain("taskkill /PID 11 /F");
    expect(stopReport(result, "linux").join("\n")).toContain("kill -9 11");
  });
});

// `stop` ignoring its arguments meant `stop --help` SIGTERMed every server instead of printing
// help (CodeRabbit) — the worst possible reading of a request for information.
describe("parseStopArgs", () => {
  it("treats --help as a request for help, not as a request to stop everything", () => {
    expect(parseStopArgs(["--help"])).toEqual({ help: true });
    expect(parseStopArgs(["-h"])).toEqual({ help: true });
  });

  it("accepts --force", () => {
    expect(parseStopArgs(["--force"])).toEqual({ force: true, port: null });
    expect(parseStopArgs([])).toEqual({ force: false, port: null });
  });

  // #2683: one server out of several.
  it("accepts --port, alone or with --force, in either order", () => {
    expect(parseStopArgs(["--port", "34599"])).toEqual({ force: false, port: 34599 });
    expect(parseStopArgs(["--force", "--port", "34599"])).toEqual({ force: true, port: 34599 });
    expect(parseStopArgs(["--port", "34599", "--force"])).toEqual({ force: true, port: 34599 });
  });

  it("refuses a --port it cannot read rather than stopping every server", () => {
    ["0", "70000", "abc", "3456.7"].forEach((raw) => expect(parseStopArgs(["--port", raw]), raw).toMatchObject({ error: expect.stringContaining("--port") }));
    expect(parseStopArgs(["--port"])).toMatchObject({ error: expect.stringContaining("--port") });
  });

  it("refuses what it does not understand rather than stopping servers anyway", () => {
    expect(parseStopArgs(["--all"])).toMatchObject({ error: expect.stringContaining("--all") });
    expect(parseStopArgs(["34567"])).toMatchObject({ error: expect.stringContaining("34567") });
  });
});

// The identity check. What it must reject is a PORT THAT ANSWERS, so the kernel is asked who owns
// the port and the server's own self-report is only the fallback (Codex: "trusts an unauthenticated
// PID returned by an arbitrary loopback listener").
describe("confirmInstance", () => {
  const entry = { pid: 4242, port: 34567, startedAt: 1 };

  it("confirms when the KERNEL says that pid owns that port", async () => {
    expect(await confirmInstance(entry, { owners: async () => [4242] })).toBe(true);
  });

  it("refuses when the kernel names a different owner — however the port answers", async () => {
    // Crashed, restarted on the same port, old pid reused. The port is healthy; it is not that pid.
    expect(await confirmInstance(entry, { owners: async () => [9999] })).toBe(false);
  });

  it("refuses when the kernel says nobody is listening", async () => {
    expect(await confirmInstance(entry, { owners: async () => [] })).toBe(false);
  });

  it("FAILS CLOSED when the kernel cannot be asked", async () => {
    // null is "no lsof / unknown platform". Softening to some other check here would put the weaker
    // answer back on the path the user takes by default; --force is where that risk belongs.
    expect(await confirmInstance(entry, { owners: async () => null })).toBe(false);
  });

  it("never opens a socket for an entry that recorded no port", async () => {
    const owners = vi.fn(async () => [4242]);
    expect(await confirmInstance({ pid: 4242, port: null, startedAt: 1 }, { owners })).toBe(false);
    expect(owners).not.toHaveBeenCalled();
  });
});

// #2683. `stop --port` picks one registered server; a port with none says what IS running.
describe("selectByPort", () => {
  const a = { pid: 1, port: 34567, startedAt: 1 };
  const b = { pid: 2, port: 34599, startedAt: 2 };
  const unknown = { pid: 3, port: null, startedAt: 3 };

  it("keeps every server with no port asked for", () => {
    expect(selectByPort([a, b, unknown], null)).toEqual([a, b, unknown]);
  });

  it("keeps only the one on the port asked for", () => {
    expect(selectByPort([a, b, unknown], 34599)).toEqual([b]);
    expect(selectByPort([a, b], 40000)).toEqual([]);
  });
});

describe("noServerOnPortReport", () => {
  it("names the port and lists what is running instead", () => {
    const lines = noServerOnPortReport(40000, [{ pid: 1, port: 34567, startedAt: 1 }]);
    expect(lines[0]).toContain("40000");
    expect(lines[1]).toContain("http://localhost:34567 (pid 1)");
  });

  it("says nothing is running when nothing is", () => {
    expect(noServerOnPortReport(40000, [])).toEqual(["No MulmoTerminal server is running on port 40000.", "MulmoTerminal is not running."]);
  });
});

describe("the --force hint after stop --port", () => {
  it("keeps the port, so a retry cannot stop every server", () => {
    const result = { stopped: [], stubborn: [], unconfirmed: [{ pid: 7, port: 34599, startedAt: 1 }] };
    expect(stopReport(result, "darwin", "mulmoterminal stop --port 34599").join("\n")).toContain("mulmoterminal stop --port 34599 --force");
  });
});
