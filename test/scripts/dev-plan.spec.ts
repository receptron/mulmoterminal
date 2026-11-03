// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { combinedExitCode, devRunPlan, DEV_SCRIPTS } from "../../scripts/dev-plan.js";

describe("devRunPlan", () => {
  // macOS and Linux keep exactly what `yarn dev` ran before: the same concurrently line.
  it.each(["darwin", "linux"])("runs concurrently with the same arguments on %s", (platform) => {
    expect(devRunPlan(platform)).toEqual({
      kind: "concurrently",
      args: ["-n", "server,vite", "-c", "blue,green", "node scripts/dev-server.mjs", "vite"],
    });
  });

  // #3253. concurrently ends its children with `taskkill /T /F` there, killing the backend before
  // it flushes; the commands are started directly instead.
  it("starts the scripts directly on Windows, with no batch file in between", () => {
    expect(devRunPlan("win32")).toEqual({ kind: "direct", scripts: DEV_SCRIPTS });
    expect(DEV_SCRIPTS.map((s) => s.script)).toEqual(["scripts/dev-server.mjs", "node_modules/vite/bin/vite.js"]);
  });

  // The script path has to stay where the vite package says its CLI is, or the Windows run starts nothing.
  it("names the CLI the installed vite declares", () => {
    const pkg: unknown = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules/vite/package.json"), "utf8"));
    const bin =
      typeof pkg === "object" && pkg !== null && "bin" in pkg && typeof pkg.bin === "object" && pkg.bin !== null && "vite" in pkg.bin ? pkg.bin.vite : null;
    expect(`node_modules/vite/${String(bin)}`).toBe(DEV_SCRIPTS[1]?.script);
  });
});

describe("combinedExitCode", () => {
  it.each([
    [[0, 0], 0],
    [[0, 1], 1],
    [[2, 1], 2],
    [[null, 0], 0],
    [[], 0],
  ])("%j gives %i", (codes, expected) => {
    expect(combinedExitCode(codes)).toBe(expected);
  });
});

describe("devRunPlan's test override", () => {
  it("runs the given commands directly", () => {
    expect(devRunPlan("darwin", { DEV_RUN_SCRIPTS: '["a.mjs", "b c.mjs"]' })).toEqual({
      kind: "direct",
      scripts: [
        { name: "script0", script: "a.mjs" },
        { name: "script1", script: "b c.mjs" },
      ],
    });
  });

  it.each(["", "not json", "{}", "[1]", "[]"])("ignores %j", (value) => {
    expect(devRunPlan("darwin", { DEV_RUN_SCRIPTS: value }).kind).toBe("concurrently");
  });
});

// The runner as a process, against stubs that record how they ended. Not on Windows: a signal sent
// from here terminates the runner there without running its handlers.
const RUNNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "dev.mjs");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const STARTUP_MS = 10000;
const POLL_MS = 50;

describe.skipIf(process.platform === "win32")("the dev runner", () => {
  let dir = "";
  let runner: ChildProcess | null = null;
  afterEach(() => {
    if (runner && runner.exitCode === null && runner.signalCode === null) runner.kill("SIGKILL");
    // The stubs outlive a SIGKILLed runner, so they are ended by the pids they recorded.
    ["a", "b"].forEach((name) => {
      const pid = pidOf(name);
      if (!pid) return;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    });
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // A stub that records its pid, stays up, and records a SIGTERM before leaving with `code`.
  function stub(name: string, code: number): string {
    const file = path.join(dir, `${name}.mjs`);
    const log = path.join(dir, `${name}.log`);
    writeFileSync(
      file,
      [
        'import { appendFileSync } from "node:fs";',
        `appendFileSync(${JSON.stringify(log)}, "pid " + process.pid + "\\n");`,
        `process.on("SIGTERM", () => { appendFileSync(${JSON.stringify(log)}, "SIGTERM\\n"); process.exit(${code}); });`,
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    return file;
  }
  const logOf = (name: string): string[] => {
    const file = path.join(dir, `${name}.log`);
    return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
  };
  const pidOf = (name: string): number | undefined => Number(logOf(name)[0]?.replace("pid ", "")) || undefined;

  // Wrapped, because an async function returning a promise would wait for the runner to exit.
  async function started(): Promise<{ exited: Promise<number | null> }> {
    dir = mkdtempSync(path.join(tmpdir(), "dev-runner-"));
    const scripts = JSON.stringify([stub("a", 0), stub("b", 3)]);
    const proc = spawn(process.execPath, [RUNNER], { env: { ...process.env, DEV_RUN_SCRIPTS: scripts }, stdio: "ignore" });
    runner = proc;
    const exited = new Promise<number | null>((resolve) => proc.on("exit", (code) => resolve(code)));
    for (let waited = 0; waited < STARTUP_MS && !(pidOf("a") && pidOf("b")); waited += POLL_MS) await wait(POLL_MS);
    return { exited };
  }

  // Ctrl+C reaches every process in the terminal; the runner must not end its children for it, nor
  // leave before them. Here only the runner gets it, so the stubs are still there afterwards.
  it("does not pass a Ctrl+C on, and stays until its commands have ended", async () => {
    const { exited } = await started();
    runner?.kill("SIGINT");
    await wait(300);
    expect(runner?.exitCode).toBeNull();
    expect(logOf("a")).not.toContain("SIGTERM");
    [pidOf("a"), pidOf("b")].forEach((pid) => pid && process.kill(pid, "SIGTERM"));
    expect(await exited).toBe(3);
  }, 20000);

  it("passes a SIGTERM aimed at it on to its commands", async () => {
    const { exited } = await started();
    runner?.kill("SIGTERM");
    expect(await exited).toBe(3);
    expect(logOf("a")).toContain("SIGTERM");
    expect(logOf("b")).toContain("SIGTERM");
  }, 20000);
});
