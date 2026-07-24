// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// The supervisor's whole reason to exist: unlike `node --watch`, it must RESTART the backend
// after a crash instead of leaving it dead (which is what disconnected every terminal for
// good). Drive it with a stub entry that crashes on boot and assert it comes back.
const SUPERVISOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "dev-server.mjs");

let child: ChildProcess | null = null;
let dir: string | null = null;

afterEach(() => {
  if (child) child.kill("SIGKILL");
  child = null;
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("dev-server supervisor", () => {
  it("restarts the backend after it crashes on boot", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "dev-server-test-"));
    const boots = path.join(dir, "boots.log");
    const stub = path.join(dir, "stub.mjs");
    // Each boot appends its pid, then crashes immediately — so a second line proves a restart.
    writeFileSync(stub, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(boots)}, process.pid + "\\n");\nprocess.exit(1);\n`);
    const watchDir = mkdtempSync(path.join(os.tmpdir(), "dev-server-watch-")); // empty — isolates crash-restart from reload

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

  it("restarts the backend when a watched source file changes", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "dev-server-test-"));
    const boots = path.join(dir, "boots.log");
    const stub = path.join(dir, "stub.mjs");
    // A backend that boots (records its pid) and STAYS ALIVE — so a second boot can only come
    // from the supervisor killing it on a file change and starting a fresh one.
    writeFileSync(
      stub,
      `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(boots)}, process.pid + "\\n");\nsetInterval(() => {}, 1000);\n`,
    );
    // realpathSync expands a Windows 8.3 short path (os.tmpdir() → C:\Users\RUNNER~1\…), which
    // fs.watch is unreliable on (see docs/windows-gotchas.md).
    const watchDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "dev-server-watch-")));

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
  }, 20000);
});
