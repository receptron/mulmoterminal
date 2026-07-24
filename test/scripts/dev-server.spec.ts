// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
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
    const watchDir = mkdtempSync(path.join(os.tmpdir(), "dev-server-watch-"));

    child = spawn(process.execPath, [SUPERVISOR], {
      env: { ...process.env, DEV_SERVER_ENTRY: stub, DEV_SERVER_WATCH: watchDir },
      stdio: "ignore",
    });

    // Wait for the first (persistent) boot, then edit a source file in the watched dir.
    for (let i = 0; i < 40 && !existsSync(boots); i++) await wait(100);
    await wait(300); // let fs.watch attach before the edit
    writeFileSync(path.join(watchDir, "touched.ts"), "export const x = 1;\n");

    // Poll for the second boot: proof the change killed the live backend and restarted it.
    let bootCount = 0;
    for (let i = 0; i < 40; i++) {
      bootCount = existsSync(boots) ? readFileSync(boots, "utf8").trim().split("\n").filter(Boolean).length : 0;
      if (bootCount >= 2) break;
      await wait(200);
    }
    rmSync(watchDir, { recursive: true, force: true });

    expect(bootCount).toBeGreaterThanOrEqual(2);
  }, 15000);
});
