// The verify-mulmoterminal skill's helper: start a MulmoTerminal from THIS checkout on a scratch
// HOME, check it is the process you think it is, and stop it — never anything else.
//
//   node --import tsx scripts/verify-scratch.ts start  --home <dir> --port <n>
//   node --import tsx scripts/verify-scratch.ts doctor --home <dir>
//   node --import tsx scripts/verify-scratch.ts stop   --home <dir>
//
// What it may stop is decided in verify-scratch-plan.ts; this file only does the I/O.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isClientBuildStale, scratchSocketPath, socketStopDecision, tmuxSocketDirFor, type ScratchPaths } from "./verify-scratch-plan.js";

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = ".verify-scratch.json";
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;
const PROBE_TIMEOUT_MS = 1_000;
const STOP_GRACE_MS = 5_000;

interface ScratchState {
  pid: number;
  port: number;
  checkout: string;
  socketPath: string;
}

function fail(message: string): never {
  console.error(`verify-scratch: ${message}`);
  process.exit(1);
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function scratchPathsFor(home: string): ScratchPaths {
  const socketDir = tmuxSocketDirFor(process.env.TMUX_TMPDIR, os.userInfo().uid);
  const realSocketDir = existsSync(socketDir) ? realpathSync.native(socketDir) : socketDir;
  return { scratchHome: realpathSync.native(home), accountHome: realpathSync.native(os.userInfo().homedir), tmuxSocketDir: realSocketDir };
}

const isScratchState = (value: unknown): value is ScratchState =>
  typeof value === "object" &&
  value !== null &&
  "pid" in value &&
  Number.isInteger(value.pid) &&
  "port" in value &&
  Number.isInteger(value.port) &&
  "checkout" in value &&
  typeof value.checkout === "string" &&
  "socketPath" in value &&
  typeof value.socketPath === "string";

function readState(home: string): ScratchState {
  const file = path.join(home, STATE_FILE);
  if (!existsSync(file)) fail(`no ${STATE_FILE} in ${home}; nothing was started there by this helper`);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return isScratchState(parsed) ? parsed : fail(`${file} is not a state file this helper wrote`);
}

async function answers(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilAnswers(port: number): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await answers(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return false;
}

function processCwd(pid: number): string | null {
  try {
    if (process.platform === "linux") return realpathSync.native(`/proc/${pid}/cwd`);
    const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    const line = out.split("\n").find((entry) => entry.startsWith("n"));
    return line === undefined ? null : realpathSync.native(line.slice(1));
  } catch {
    return null;
  }
}

function newestMtimeMs(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).reduce((newest, entry) => {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs;
    return Math.max(newest, mtime);
  }, 0);
}

function clientBuildIsStale(): boolean {
  const distIndex = path.join(CHECKOUT, "dist", "index.html");
  const builtAt = existsSync(distIndex) ? statSync(distIndex).mtimeMs : null;
  return isClientBuildStale(builtAt, newestMtimeMs(path.join(CHECKOUT, "src")));
}

async function start(args: string[]): Promise<void> {
  const home = argValue(args, "--home") ?? fail("start needs --home <dir>");
  const port = Number(argValue(args, "--port") ?? fail("start needs --port <n>"));
  if (!Number.isInteger(port)) fail("--port must be an integer");
  if (clientBuildIsStale()) fail("dist/ is older than src/: run `yarn build` first, or the page you check is not this checkout's");
  if (await answers(port)) fail(`something already answers on port ${port}; it is not evidence about this checkout`);
  mkdirSync(home, { recursive: true });
  const socketPath = scratchSocketPath(scratchPathsFor(home)) ?? fail("--home is the account's own home; use a scratch directory");
  prepareHome(home);
  const pid = launch(home, port);
  writeFileSync(path.join(home, STATE_FILE), JSON.stringify({ pid, port, checkout: CHECKOUT, socketPath }, null, 2));
  if (!(await waitUntilAnswers(port))) fail(`the server did not answer on ${port}; see ${path.join(home, "server.log")}`);
  console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/`, pid, socketPath, log: path.join(home, "server.log") }, null, 2));
}

// A shell cell's prompt is the account name and host by default, and it lands in every
// screenshot taken of the cell; a short one keeps them out.
function prepareHome(home: string): void {
  mkdirSync(path.join(home, "work"), { recursive: true });
  const zshrc = path.join(home, ".zshrc");
  if (!existsSync(zshrc)) writeFileSync(zshrc, "PROMPT='%1~ $ '\n");
}

function tmuxServerRunning(socketPath: string): boolean {
  try {
    execFileSync("tmux", ["-S", socketPath, "list-sessions"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function launch(home: string, port: number): number {
  const log = openSync(path.join(home, "server.log"), "a");
  const child = spawn(
    process.execPath,
    [path.join(CHECKOUT, "bin", "mulmoterminal.js"), "--port", String(port), "--no-open", "--cwd", path.join(home, "work")],
    {
      cwd: CHECKOUT,
      env: { ...process.env, HOME: home },
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  child.unref();
  return child.pid ?? fail("the server process did not start");
}

async function doctor(args: string[]): Promise<void> {
  const home = argValue(args, "--home") ?? fail("doctor needs --home <dir>");
  const state = readState(home);
  const report = {
    serverAnswers: await answers(state.port),
    launcherCwdIsThisCheckout: processCwd(state.pid) === realpathSync.native(CHECKOUT),
    clientBuildFresh: !clientBuildIsStale(),
    scratchTmuxRunning: tmuxServerRunning(state.socketPath),
    socketPath: state.socketPath,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.serverAnswers || !report.launcherCwdIsThisCheckout || !report.clientBuildFresh) process.exit(1);
}

async function stop(args: string[]): Promise<void> {
  const home = argValue(args, "--home") ?? fail("stop needs --home <dir>");
  const state = readState(home);
  const decision = socketStopDecision(state.socketPath, scratchPathsFor(home));
  if (!decision.ok) fail(`refusing to stop tmux: ${decision.reason}`);
  const signalled = await stopServer(state);
  if (tmuxServerRunning(state.socketPath)) execFileSync("tmux", ["-S", state.socketPath, "kill-server"], { stdio: "ignore" });
  const report = {
    signalledPid: signalled ? state.pid : null,
    serverAnswers: await answers(state.port),
    scratchTmuxRunning: tmuxServerRunning(state.socketPath),
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.serverAnswers || report.scratchTmuxRunning) process.exit(1);
}

// Signals the launcher's process group only while that pid is still a process running in this
// checkout: a pid recorded long ago may since belong to something else.
async function stopServer(state: ScratchState): Promise<boolean> {
  if (processCwd(state.pid) !== realpathSync.native(state.checkout)) return false;
  process.kill(-state.pid, "SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline && (await answers(state.port))) await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  return true;
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void>> = { start, doctor, stop };
const run = commands[command ?? ""] ?? (() => fail("usage: verify-scratch.ts start|doctor|stop --home <dir> [--port <n>]"));
await run(rest);
