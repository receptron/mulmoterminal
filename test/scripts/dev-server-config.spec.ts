// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  resolveWatchDirs,
  shouldSchedule,
  isReloadableChange,
  restartPlan,
  isListeningMessage,
  PORT_IN_USE_EXIT_CODE,
} from "../../scripts/dev-server-config.js";

describe("resolveWatchDirs", () => {
  const root = "/repo";

  it("watches server/, common/ and bin/ by default (not just server/)", () => {
    const dirs = resolveWatchDirs({}, root);
    // Codex #734: the backend imports common/modelIds.ts and bin/update-check.js, so editing
    // those must reload too — server/ alone regresses `node --watch`'s dependency tracking.
    expect(dirs).toEqual([path.join(root, "server"), path.join(root, "common"), path.join(root, "bin")]);
  });

  it("overrides to a single absolute dir when DEV_SERVER_WATCH is set", () => {
    expect(resolveWatchDirs({ DEV_SERVER_WATCH: "/srv/watch-me" }, root)).toEqual([path.resolve("/srv/watch-me")]);
  });
});

describe("shouldSchedule", () => {
  it("schedules a bring-up when idle", () => {
    expect(shouldSchedule({ shuttingDown: false, restartPending: false })).toBe(true);
  });

  it("skips when a restart is already pending — collapses an overlapping crash + file-change to one spawn", () => {
    // Codex #734: without this, a crash landing inside the file-change debounce would spawn a
    // second backend and race the first onto port 34567 (EADDRINUSE).
    expect(shouldSchedule({ shuttingDown: false, restartPending: true })).toBe(false);
  });

  it("skips while shutting down", () => {
    expect(shouldSchedule({ shuttingDown: true, restartPending: false })).toBe(false);
    expect(shouldSchedule({ shuttingDown: true, restartPending: true })).toBe(false);
  });
});

describe("isReloadableChange", () => {
  it("reloads on source extensions", () => {
    for (const f of ["index.ts", "a.mjs", "b.js", "c.json", "dir/deep.ts"]) expect(isReloadableChange(f)).toBe(true);
  });

  it("ignores editor temp files, extensionless names, and non-strings", () => {
    for (const f of ["index.ts.swp", "4913", "README.md", ".DS_Store"]) expect(isReloadableChange(f)).toBe(false);
    expect(isReloadableChange(null)).toBe(false);
    expect(isReloadableChange(undefined)).toBe(false);
  });
});

// #1735: a second `yarn dev` on a taken port respawned a 113% CPU boot every 3-4 seconds for
// hours. The supervisor decided from how FAST the process died, and the backend does its whole
// setup before it binds — so a busy port took ~3s to fail, landed outside the fast-crash window,
// and reset the delay to its floor every time. The exponential backoff never fired once.
describe("restartPlan", () => {
  const plan = (over: Partial<Parameters<typeof restartPlan>[0]> = {}) =>
    restartPlan({ code: 1, signal: null, consecutiveFailures: 1, minDelayMs: 250, maxDelayMs: 4000, ...over });

  describe("a port that is already in use", () => {
    // Retrying cannot fix it, and every attempt re-runs setup that copies files into the user's
    // home — so this is the one exit the supervisor must NOT come back from.
    it("does not retry, however early or late in a run it happens", () => {
      for (const n of [1, 2, 50]) expect(plan({ code: PORT_IN_USE_EXIT_CODE, consecutiveFailures: n }).retry).toBe(false);
    });

    it("says what to do about it, since nothing will happen on its own", () => {
      const { reason } = plan({ code: PORT_IN_USE_EXIT_CODE });
      expect(reason).toContain("already in use");
      expect(reason).toContain("PORT=");
      // The way back: an edit re-arms the loop, and a dev who is not told that sees a dead server.
      expect(reason).toContain("retry");
    });

    it("is the code server/index.ts actually exits with", () => {
      // Kept in sync with PORT_IN_USE_EXIT_CODE in server/infra/server-exit.ts, which bin/ also
      // reads. A drift here turns the rule above into a no-op that still passes its own tests.
      expect(PORT_IN_USE_EXIT_CODE).toBe(75);
    });
  });

  describe("any other exit", () => {
    it("comes back at the floor the first time", () => {
      expect(plan({ consecutiveFailures: 1 })).toMatchObject({ retry: true, delayMs: 250 });
    });

    // The actual regression: these are all SLOW crashes, which the old elapsed-time test read as
    // one-offs. Backing off is now a function of the count, so it fires regardless of timing.
    it("doubles per consecutive failure and caps", () => {
      const delays = [1, 2, 3, 4, 5, 6].map((n) => plan({ consecutiveFailures: n }).delayMs);
      expect(delays).toEqual([250, 500, 1000, 2000, 4000, 4000]);
    });

    it("names the loop only once there is one", () => {
      expect(plan({ consecutiveFailures: 1 }).reason).not.toContain("in a row");
      expect(plan({ consecutiveFailures: 3 }).reason).toContain("3 in a row");
    });

    it("reports a signal as a signal", () => {
      expect(plan({ code: null, signal: "SIGSEGV" }).reason).toContain("signal SIGSEGV");
      expect(plan({ code: 1, signal: null }).reason).toContain("code 1");
    });

    it("never returns a delay outside the bounds it was given", () => {
      for (const n of [0, 1, 7, 99]) {
        const { delayMs } = plan({ consecutiveFailures: n });
        expect(delayMs).toBeGreaterThanOrEqual(250);
        expect(delayMs).toBeLessThanOrEqual(4000);
      }
    });
  });
});

// What resets the crash count. An earlier draft of this fix used "the process stayed up 5
// seconds", and Codex caught that it re-created the very defect being fixed: the backend does its
// whole setup BEFORE it binds, so a machine slow enough — or a pre-bind failure late enough — puts
// every crash above the threshold, resets the count, and loops at the floor forever. Only the
// backend saying it bound the port means it bound the port.
describe("isListeningMessage", () => {
  it("accepts the message server/index.ts sends from inside listen()", () => {
    expect(isListeningMessage({ type: "listening", port: 34567 })).toBe(true);
    expect(isListeningMessage({ type: "listening" })).toBe(true);
  });

  // A reset on the wrong message is a crash loop that never backs off, so this is not pedantry:
  // anything that is not that message must not count.
  it("rejects every other shape", () => {
    for (const other of [{ type: "other" }, {}, [], null, undefined, "listening", 42, true]) {
      expect(isListeningMessage(other)).toBe(false);
    }
  });
});

// The readiness send must not be able to kill the backend it is reporting from.
//
// After the parent disconnects, `process.send` STAYS a function and `process.connected` goes
// false. Calling it then raises ERR_IPC_CHANNEL_CLOSED **asynchronously** — it arrives as an
// uncaughtException, so neither `?.` nor a try/catch around the call stops the process dying.
// Reachable in practice: Ctrl+C on the supervisor while the backend is still in its ~3s of setup,
// which is exactly when this message is sent. CodeRabbit raised it on #1736; this pins the shape
// server/index.ts uses rather than the file itself, which cannot be booted in a unit test.
describe("the readiness notification's guard", () => {
  const runChild = (body: string): Promise<{ code: number | null; messages: unknown[] }> => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-ipc-"));
    const file = path.join(dir, "child.mjs");
    writeFileSync(file, body);
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [file], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
      const messages: unknown[] = [];
      child.on("message", (m) => messages.push(m));
      // Disconnect while the child is still "starting up", the way Ctrl+C would.
      setTimeout(() => child.disconnect(), 100);
      child.on("exit", (code) => {
        rmSync(dir, { recursive: true, force: true });
        resolve({ code, messages });
      });
    });
  };

  // The guard server/index.ts actually uses.
  const GUARDED = `
    setTimeout(() => {
      if (process.connected) process.send?.({ type: "listening", port: 1 }, undefined, undefined, () => {});
      setTimeout(() => process.exit(0), 150);
    }, 300);
  `;

  it("survives a parent that disconnected before the port was bound", async () => {
    const { code } = await runChild(GUARDED);
    expect(code).toBe(0);
  }, 10000);

  // The negative control: without the guard the same child dies, which is what makes the test
  // above mean something.
  it("would die without it — the reason the guard is there", async () => {
    const { code } = await runChild(`
      setTimeout(() => {
        process.send?.({ type: "listening", port: 1 });
        setTimeout(() => process.exit(0), 150);
      }, 300);
    `);
    expect(code).not.toBe(0);
  }, 10000);
});
