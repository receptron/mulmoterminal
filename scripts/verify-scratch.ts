// The verify-mulmoterminal skill's helper: start a MulmoTerminal from THIS checkout on a scratch
// HOME, check it is the process you think it is, and stop it — never anything else. macOS and Linux.
//
//   node --import tsx scripts/verify-scratch.ts start  --home <dir> --port <n>
//   node --import tsx scripts/verify-scratch.ts doctor --home <dir>
//   node --import tsx scripts/verify-scratch.ts stop   --home <dir>
//
// Every decision is in verify-scratch-plan.ts; this file only observes and acts.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processTitle } from "../bin/process-title.js";
import {
  groupToSignal,
  isClientBuildStale,
  isSupportedPlatform,
  launcherArgs,
  launcherMatches,
  scratchServerPid,
  scratchSocketPath,
  socketStopDecision,
  tmuxCleanupDecision,
  tmuxSocketDirFor,
  type InstanceEntry,
  type LauncherRecord,
  type ProcessFacts,
  type ScratchPaths,
} from "./verify-scratch-plan.js";

const CHECKOUT = realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const LAUNCHER_SCRIPT = path.join(CHECKOUT, "bin", "mulmoterminal.js");
const STATE_FILE = ".verify-scratch.json";
const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 500;
const PROBE_TIMEOUT_MS = 1_000;
const STOP_GRACE_MS = 10_000;
const EXEC_TIMEOUT_MS = 5_000;
const EXEC_POLL_MS = 50;

interface ScratchState {
  launcher: LauncherRecord;
  port: number;
}

function fail(message: string): never {
  console.error(`verify-scratch: ${message}`);
  process.exit(1);
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

/** The scratch HOME as one absolute real path: what the helper computes from is what the server is given. */
function scratchHomeFrom(args: string[], create: boolean): string {
  const home = path.resolve(argValue(args, "--home") ?? fail("--home <dir> is required"));
  if (create) mkdirSync(home, { recursive: true });
  if (!existsSync(home)) fail(`${home} does not exist; nothing was started there`);
  return realpathSync.native(home);
}

const logPathFor = (home: string): string => path.join(home, "server.log");

function scratchPathsFor(home: string): ScratchPaths {
  const tmuxSocketDir = tmuxSocketDirFor(realpathSync.native("/tmp"), os.userInfo().uid);
  return { scratchHome: home, accountHome: realpathSync.native(os.userInfo().homedir), tmuxSocketDir };
}

function socketFor(home: string): string {
  return scratchSocketPath(scratchPathsFor(home)) ?? fail("--home is the account's own home; use a scratch directory");
}

const isLauncherRecord = (value: unknown): value is LauncherRecord =>
  typeof value === "object" &&
  value !== null &&
  "pid" in value &&
  Number.isInteger(value.pid) &&
  "startedAt" in value &&
  typeof value.startedAt === "string" &&
  "command" in value &&
  typeof value.command === "string";

const isScratchState = (value: unknown): value is ScratchState =>
  typeof value === "object" && value !== null && "port" in value && Number.isInteger(value.port) && "launcher" in value && isLauncherRecord(value.launcher);

function readState(home: string): ScratchState {
  const file = path.join(home, STATE_FILE);
  if (!existsSync(file)) fail(`no ${STATE_FILE} in ${home}; nothing was started there by this helper`);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return isScratchState(parsed) ? parsed : fail(`${file} is not a state file this helper wrote`);
}

function ps(pid: number, field: string): string | null {
  try {
    const out = execFileSync("ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

// The file fd 1 is open on: /proc on Linux, lsof on macOS. `start` points the launcher's stdout at
// the scratch HOME's log, and the server inherits it; nothing else writes there.
function processStdout(pid: number): string | null {
  try {
    if (process.platform === "linux") return realpathSync.native(`/proc/${pid}/fd/1`);
    const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "1", "-Fn"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const line = out.split("\n").find((entry) => entry.startsWith("n"));
    return line === undefined ? null : line.slice(1);
  } catch {
    return null;
  }
}

function processFacts(pid: number): ProcessFacts | null {
  const [pgid, startedAt, command] = [ps(pid, "pgid"), ps(pid, "lstart"), ps(pid, "command")];
  if (pgid === null || startedAt === null || command === null) return null;
  return { pid, pgid: Number(pgid), startedAt, command, stdoutPath: processStdout(pid) };
}

function instanceEntries(home: string): InstanceEntry[] {
  const dir = path.join(home, ".mulmoterminal", "instances");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try {
        const entry: unknown = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
        const isEntry = typeof entry === "object" && entry !== null && "pid" in entry && Number.isInteger(entry.pid) && "port" in entry;
        return isEntry ? [{ pid: Number(entry.pid), port: Number.isInteger(entry.port) ? Number(entry.port) : null }] : [];
      } catch {
        return [];
      }
    });
}

function identify(home: string, state: ScratchState): { launcherIdentified: boolean; serverPid: number | null } {
  const identity = { logPath: logPathFor(home), launcherScript: LAUNCHER_SCRIPT, launcherTitle: processTitle(state.port) };
  const launcherIdentified = launcherMatches(state.launcher, processFacts(state.launcher.pid), identity);
  return { launcherIdentified, serverPid: scratchServerPid(instanceEntries(home), state.port, processFacts, state.launcher.pid, logPathFor(home)) };
}

async function answers(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

async function until(condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
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

function tmuxServerRunning(socketPath: string): boolean {
  try {
    execFileSync("tmux", ["-S", socketPath, "list-sessions"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A shell cell's prompt is the account name and host by default, and it lands in every
// screenshot taken of the cell; a short one keeps them out.
function prepareHome(home: string): void {
  mkdirSync(path.join(home, "work"), { recursive: true });
  const zshrc = path.join(home, ".zshrc");
  if (!existsSync(zshrc)) writeFileSync(zshrc, "PROMPT='%1~ $ '\n");
}

// TMUX_TMPDIR is dropped so the server's sockets land where scratchPathsFor computes them.
async function launch(home: string, port: number): Promise<LauncherRecord> {
  const log = openSync(logPathFor(home), "a");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.TMUX_TMPDIR;
  const child = spawn(process.execPath, launcherArgs(CHECKOUT, port, path.join(home, "work")), {
    cwd: CHECKOUT,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  const pid = child.pid ?? fail("the server process did not start");
  const facts = await launcherFactsOnceExeced(pid);
  if (facts === null) {
    signalGroup(pid, "SIGKILL");
    fail(`the launcher (pid ${pid}) never ran ${LAUNCHER_SCRIPT}; see ${path.join(home, "server.log")}`);
  }
  return { pid, startedAt: facts.startedAt, command: facts.command };
}

// Right after spawn, ps can still show the PARENT's command line (before exec), and a record taken
// then would never match the launcher again. So wait until the pid is running the launcher script.
async function launcherFactsOnceExeced(pid: number): Promise<ProcessFacts | null> {
  const deadline = Date.now() + EXEC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const facts = processFacts(pid);
    if (facts?.command.includes(LAUNCHER_SCRIPT)) return facts;
    await new Promise((resolve) => setTimeout(resolve, EXEC_POLL_MS));
  }
  return null;
}

async function start(args: string[]): Promise<void> {
  const home = scratchHomeFrom(args, true);
  const port = Number(argValue(args, "--port") ?? fail("start needs --port <n>"));
  if (!Number.isInteger(port)) fail("--port must be an integer");
  const socketPath = socketFor(home);
  if (clientBuildIsStale()) fail("dist/ is older than src/: run `yarn build` first, or the page you check is not this checkout's");
  if (await answers(port)) fail(`something already answers on port ${port}; it is not evidence about this checkout`);
  prepareHome(home);
  const launcher = await launch(home, port);
  writeFileSync(path.join(home, STATE_FILE), JSON.stringify({ launcher, port, socketPath }, null, 2));
  if (!(await until(() => answers(port), READY_TIMEOUT_MS))) {
    await signalUntilSilent(launcher.pid, port);
    fail(`the server did not answer on ${port} and was stopped; see ${path.join(home, "server.log")}`);
  }
  console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/`, launcherPid: launcher.pid, socketPath, log: path.join(home, "server.log") }, null, 2));
}

async function doctor(args: string[]): Promise<void> {
  const home = scratchHomeFrom(args, false);
  const state = readState(home);
  const { launcherIdentified, serverPid } = identify(home, state);
  const report = {
    serverAnswers: await answers(state.port),
    launcherIsThisCheckouts: launcherIdentified,
    serverIsThisScratchHomes: serverPid !== null,
    clientBuildFresh: !clientBuildIsStale(),
    scratchTmuxRunning: tmuxServerRunning(socketFor(home)),
    socketPath: socketFor(home),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.serverAnswers || !report.launcherIsThisCheckouts || !report.serverIsThisScratchHomes || !report.clientBuildFresh) process.exit(1);
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal);
  } catch {
    // The group is already gone.
  }
}

/** SIGTERM to the launcher's group, then SIGKILL if the port still answers after the grace period. */
async function signalUntilSilent(group: number, port: number): Promise<boolean> {
  signalGroup(group, "SIGTERM");
  if (await until(async () => !(await answers(port)), STOP_GRACE_MS)) return true;
  signalGroup(group, "SIGKILL");
  return until(async () => !(await answers(port)), STOP_GRACE_MS);
}

async function stop(args: string[]): Promise<void> {
  const home = scratchHomeFrom(args, false);
  const state = readState(home);
  const socketPath = socketFor(home);
  const decision = socketStopDecision(socketPath, scratchPathsFor(home));
  if (!decision.ok) fail(`refusing to stop tmux: ${decision.reason}`);
  const { launcherIdentified, serverPid } = identify(home, state);
  const group = groupToSignal(launcherIdentified, serverPid, state.launcher.pid);
  if (group !== null) await signalUntilSilent(group, state.port);
  const serverAnswers = await answers(state.port);
  const cleanup = tmuxCleanupDecision(serverAnswers);
  if (cleanup.ok && tmuxServerRunning(socketPath)) execFileSync("tmux", ["-S", socketPath, "kill-server"], { stdio: "ignore" });
  const report = {
    signalledGroup: group,
    serverAnswers,
    scratchTmuxRunning: tmuxServerRunning(socketPath),
    ...(cleanup.ok ? {} : { refused: cleanup.reason }),
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.serverAnswers || report.scratchTmuxRunning) process.exit(1);
}

if (!isSupportedPlatform(process.platform)) fail(`${process.platform} is not supported; this helper needs ps, POSIX process groups and tmux`);
const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void>> = { start, doctor, stop };
const run = commands[command ?? ""] ?? (() => fail("usage: verify-scratch.ts start|doctor|stop --home <dir> [--port <n>]"));
await run(rest);
