// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { makeTempDir } from "../support/tempDir.js";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The supervisor's whole reason to exist: unlike `node --watch`, it must RESTART the backend
// after a crash instead of leaving it dead (which is what disconnected every terminal for
// good). Drive it with a stub entry that crashes on boot and assert it comes back.
const SUPERVISOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "dev-server.mjs");

let child: ChildProcess | null = null;
let dir: string | null = null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SUPERVISOR_EXIT_MS = 5000;
// How long a stub whose channel closed waits for a SIGTERM that may be arriving with it.
const SIGNAL_RACE_MS = 500;
const POLL_MS = 100;
// Generous: a loaded machine can take seconds to start two node processes.
const BOOT_WAIT_MS = 15000;

async function waitFor(done: () => boolean, limitMs: number): Promise<void> {
  for (let waited = 0; waited < limitMs && !done(); waited += POLL_MS) await wait(POLL_MS);
}

// SIGTERM, not SIGKILL: the supervisor stops its backend from its signal handler. SIGKILL only when it
// does not exit — its backend then ends on its own (see stayingStub).
async function stopSupervisor(supervisor: ChildProcess): Promise<void> {
  if (supervisor.exitCode !== null || supervisor.signalCode !== null) return;
  const exited = new Promise((resolve) => supervisor.once("exit", resolve));
  supervisor.kill("SIGTERM");
  await Promise.race([exited, wait(SUPERVISOR_EXIT_MS)]);
  if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill("SIGKILL");
}

const linesOf = (file: string): string[] => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : []);
const bootedPids = (boots: string): number[] => linesOf(boots).map(Number);

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A backend that boots (records its pid) and stays up until it is stopped, and records HOW it stopped
 *  in `ends`. It also ends when its supervisor is gone however the supervisor ended (the IPC channel it
 *  opens closes), so a supervisor this spec stops cannot leave one behind (#2609, #2691). Not a run that
 *  is itself killed with the supervisor still up: nothing closes the channel then.
 *
 *  The supervisor asks it to stop over the channel, as it asks the real backend (#3234); a SIGTERM is
 *  recorded too, for a supervisor that falls back to one. The wait on `disconnect` lets a request
 *  already on its way be the one recorded. */
const stayingStub = (boots: string, ends: string): string =>
  [
    'import { appendFileSync } from "node:fs";',
    `appendFileSync(${JSON.stringify(boots)}, process.pid + "\\n");`,
    `const end = (how) => { appendFileSync(${JSON.stringify(ends)}, how + "\\n"); process.exit(0); };`,
    'process.on("SIGTERM", () => end("SIGTERM"));',
    'process.on("message", (m) => { if (m && m.type === "shutdown") end("shutdown"); });',
    `process.on("disconnect", () => setTimeout(() => end("disconnect"), ${SIGNAL_RACE_MS}));`,
    "setInterval(() => {}, 1000);",
  ].join("\n");

// Removing the directory while a stub is still writing how it ended fails with ENOTEMPTY: wait for the
// stubs it booted to be gone first, and let `rmSync` retry the one race left.
const RM_RETRIES = 3;
// Room for the worst case (the supervisor's stop, then its stubs' end), past the 10 s default: a hook
// that times out keeps running, and must never outlive its own test.
const CLEANUP_BUDGET_MS = 20000;
afterEach(async () => {
  // Taken and cleared before the first wait, so the next test's supervisor and directory are its own.
  const [supervisor, testDir] = [child, dir];
  child = null;
  dir = null;
  if (supervisor) await stopSupervisor(supervisor);
  if (!testDir) return;
  const booted = bootedPids(path.join(testDir, "boots.log"));
  await waitFor(() => !booted.some(isAlive), SUPERVISOR_EXIT_MS + SIGNAL_RACE_MS);
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true, maxRetries: RM_RETRIES });
}, CLEANUP_BUDGET_MS);

describe("dev-server supervisor", () => {
  it("restarts the backend after it crashes on boot", async () => {
    dir = makeTempDir("dev-server-test-");
    const boots = path.join(dir, "boots.log");
    const stub = path.join(dir, "stub.mjs");
    // Each boot appends its pid, then crashes immediately — so a second line proves a restart.
    writeFileSync(stub, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(boots)}, process.pid + "\\n");\nprocess.exit(1);\n`);
    const watchDir = makeTempDir("dev-server-watch-"); // empty — isolates crash-restart from reload

    child = spawn(process.execPath, [SUPERVISOR], {
      env: { ...process.env, DEV_SERVER_ENTRY: stub, DEV_SERVER_WATCH: watchDir },
      stdio: "ignore",
    });

    // Poll for a second distinct boot (proof it restarted), rather than a fixed sleep.
    let bootCount = 0;
    for (let i = 0; i < 40; i++) {
      if (existsSync(boots)) {
        bootCount = readFileSync(boots, "utf8").trim().split("\n").filter(Boolean).length;
        if (bootCount >= 2) break;
      }
      await wait(200);
    }
    rmSync(watchDir, { recursive: true, force: true });

    // At least two boots means the supervisor brought the backend back after the first crash.
    expect(bootCount).toBeGreaterThanOrEqual(2);
  }, 15000);

  // What `yarn dev`'s Ctrl-C relies on. Not on Windows: this spec's SIGTERM to the supervisor there
  // terminates it without running the handler that asks the backend to stop.
  it.skipIf(process.platform === "win32")(
    "stops the backend it started when it is stopped",
    async () => {
      dir = makeTempDir("dev-server-test-");
      const boots = path.join(dir, "boots.log");
      const stub = path.join(dir, "stub.mjs");
      const ends = path.join(dir, "ends.log");
      writeFileSync(stub, stayingStub(boots, ends));
      const watchDir = makeTempDir("dev-server-watch-");
      // Its own handle: after a wait, the shared one may already be the next test's supervisor.
      const supervisor = spawn(process.execPath, [SUPERVISOR], {
        env: { ...process.env, DEV_SERVER_ENTRY: stub, DEV_SERVER_WATCH: watchDir },
        stdio: "ignore",
      });
      child = supervisor;
      await waitFor(() => bootedPids(boots).length > 0, BOOT_WAIT_MS);
      const [backend] = bootedPids(boots);
      expect(backend, "the backend never booted").toBeDefined();
      expect(isAlive(backend)).toBe(true);

      await stopSupervisor(supervisor);
      await waitFor(() => !isAlive(backend), SUPERVISOR_EXIT_MS);
      rmSync(watchDir, { recursive: true, force: true });
      expect(isAlive(backend)).toBe(false);
      // Stopped BY the supervisor, which asked it to — not merely left to end with it.
      expect(linesOf(ends)[0]).toBe("shutdown");
    },
    30000,
  );

  // Skipped on Windows, where it is flaky rather than failing: `fs.watch` gives no delivery
  // guarantee there, and the same commit passes on one Node version and not the other (#802).
  // The 8.3-short-path workaround and the 50-round re-touch loop below already push it as far
  // as it goes; what is left is the platform's, and a CI job that is red half the time hides
  // the regressions it exists to catch. The crash-restart case above still covers Windows.
  it.skipIf(process.platform === "win32")(
    "restarts the backend when a watched source file changes",
    async () => {
      dir = makeTempDir("dev-server-test-");
      const boots = path.join(dir, "boots.log");
      const stub = path.join(dir, "stub.mjs");
      // A backend that boots (records its pid) and STAYS ALIVE — so a second boot can only come
      // from the supervisor killing it on a file change and starting a fresh one.
      const ends = path.join(dir, "ends.log");
      writeFileSync(stub, stayingStub(boots, ends));
      // realpathSync expands a Windows 8.3 short path (os.tmpdir() → C:\Users\RUNNER~1\…), which
      // fs.watch is unreliable on (see docs/windows-gotchas.md).
      const watchDir = makeTempDir("dev-server-watch-");

      child = spawn(process.execPath, [SUPERVISOR], {
        env: { ...process.env, DEV_SERVER_ENTRY: stub, DEV_SERVER_WATCH: watchDir },
        stdio: "ignore",
      });

      // Wait for the first (persistent) boot before touching the watched dir.
      for (let i = 0; i < 40 && !existsSync(boots); i++) await wait(100);

      // Poll for the second boot, RE-TOUCHING the source each round. fs.watch gives no delivery
      // guarantee and on Windows can arm late or drop the first event, so a single write is flaky;
      // re-touching until the restart lands makes it deterministic. Extra restarts only push the
      // count past the >=2 we assert.
      const touched = path.join(watchDir, "touched.ts");
      let bootCount = 0;
      for (let i = 0; i < 50; i++) {
        writeFileSync(touched, `export const x = ${i};\n`);
        await wait(200); // > the supervisor's 120ms change debounce, so each write can trigger
        bootCount = existsSync(boots) ? readFileSync(boots, "utf8").trim().split("\n").filter(Boolean).length : 0;
        if (bootCount >= 2) break;
      }
      rmSync(watchDir, { recursive: true, force: true });

      expect(bootCount).toBeGreaterThanOrEqual(2);
    },
    20000,
  );

  // A backend that does not act on the request must not stop the reload for good: past the cap the
  // supervisor ends it, and the next one comes up.
  it.skipIf(process.platform === "win32")(
    "still restarts a backend that ignores the request to stop",
    async () => {
      dir = makeTempDir("dev-server-test-");
      const boots = path.join(dir, "boots.log");
      const stub = path.join(dir, "stub.mjs");
      writeFileSync(
        stub,
        [
          `import { appendFileSync } from "node:fs";`,
          `appendFileSync(${JSON.stringify(boots)}, process.pid + "\\n");`,
          'process.on("disconnect", () => process.exit(0));',
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );
      const watchDir = makeTempDir("dev-server-watch-");
      child = spawn(process.execPath, [SUPERVISOR], {
        env: { ...process.env, DEV_SERVER_ENTRY: stub, DEV_SERVER_WATCH: watchDir },
        stdio: "ignore",
      });
      await waitFor(() => bootedPids(boots).length > 0, BOOT_WAIT_MS);
      const touched = path.join(watchDir, "touched.ts");
      for (let i = 0; i < 50 && bootedPids(boots).length < 2; i++) {
        writeFileSync(touched, `export const x = ${i};\n`);
        await wait(200);
      }
      rmSync(watchDir, { recursive: true, force: true });
      expect(bootedPids(boots).length).toBeGreaterThanOrEqual(2);
    },
    30000,
  );
});
