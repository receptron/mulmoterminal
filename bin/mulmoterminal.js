#!/usr/bin/env node

// MulmoTerminal launcher — `npx mulmoterminal` entry point.
//
// Ships the server source (TypeScript) + a pre-built client (Vite dist/), and
// runs the server via tsx. Mirrors the mulmoclaude launcher.

import { execSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  classifyInstall,
  fetchLatestVersion,
  gitUpdateNotice,
  hasNodeModulesSegment,
  isTreeDirtyForUpdate,
  isUpdateCheckDisabled,
  npmUpdateNotice,
  parseLsRemoteHead,
} from "./update-check.js";
import { chooseCwd, parsePortArg, portInUseAction, portInUseMessage, saysYes, secondInstancePrompt, SECOND_INSTANCE_NOTE } from "./cli-args.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");
const SERVER_ENTRY = join(PKG_DIR, "server", "index.ts");
const DEFAULT_PORT = 34567;
const READY_TIMEOUT_MS = 15_000;
// Server exit code meaning "port taken at bind time" — keep in sync with
// server/index.ts (PORT_IN_USE_EXIT_CODE).
const PORT_IN_USE_EXIT_CODE = 75;

// Single source of truth: read the version from the shipped package.json so
// `--version` never drifts from the published version.
const { version: VERSION } = createRequire(import.meta.url)("../package.json");

const log = (msg) => console.log(`\x1b[36m[mulmoterminal]\x1b[0m ${msg}`);
const error = (msg) => console.error(`\x1b[31m[mulmoterminal]\x1b[0m ${msg}`);

// Upper bound on every git probe, including the network ls-remote — matches the
// npm fetch timeout so a slow remote can't delay the notice past startup.
const GIT_PROBE_TIMEOUT_MS = 1500;

// Run git inside the package directory, best-effort. Resolves the trimmed stdout
// on a clean exit, or null on anything else (git absent, non-zero exit, timeout).
// GIT_TERMINAL_PROMPT=0 turns an auth prompt into a fast failure instead of a
// hang, so ls-remote against a private remote can't block startup waiting on a
// password nobody is there to type.
function runGit(gitArgs, timeout_ms = GIT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("git", ["-C", PKG_DIR, ...gitArgs], {
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch {
      return resolve(null);
    }
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout_ms);
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() : null);
    });
  });
}

// npm install → registry latest vs the bundled version; git checkout → local
// HEAD vs the remote's, read without fetching. Only ask git which one this is
// when the path doesn't already answer it.
async function installKind() {
  if (hasNodeModulesSegment(PKG_DIR)) return "npm";
  return classifyInstall(PKG_DIR, (await runGit(["rev-parse", "--is-inside-work-tree"])) === "true");
}

// The git-side notice, or null. A dirty tree stops here without touching the
// network — it can't fast-forward, so there is nothing worth asking the remote.
async function gitUpdateMessage() {
  const status = await runGit(["status", "--porcelain"]);
  if (status === null || isTreeDirtyForUpdate(status)) return null;
  const [localSha, localShort, lsRemote] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["rev-parse", "--short", "HEAD"]),
    runGit(["ls-remote", "origin", "HEAD"]),
  ]);
  return gitUpdateNotice({ localSha, localShort, remoteSha: parseLsRemoteHead(lsRemote), dirty: false });
}

// Where the notice is left for the running server to read and surface in the web header —
// the console line is easy to miss when you only watch the browser. Sits next to the other
// shared ~/.mulmoterminal state (activity-state.json, etc.).
const UPDATE_STATUS_FILE = join(homedir(), ".mulmoterminal", "update-status.json");

// Persist the current notice (null when clean, opted out, or the check failed). Written on
// every start so a stale "update available" from a prior run can't linger after the user
// updated. Best-effort — a failed write never disrupts startup.
async function writeUpdateStatus(notice) {
  try {
    await mkdir(dirname(UPDATE_STATUS_FILE), { recursive: true });
    await writeFile(UPDATE_STATUS_FILE, JSON.stringify({ notice: notice ?? null }));
  } catch {
    // best-effort
  }
}

// Non-blocking notice that a newer version exists — neither `npm i -g` nor a git
// checkout auto-updates. Opt out via MULMOTERMINAL_NO_UPDATE_CHECK / NO_UPDATE_NOTIFIER.
async function checkForUpdate() {
  let notice = null;
  if (!isUpdateCheckDisabled(process.env)) {
    try {
      notice = (await installKind()) === "git" ? await gitUpdateMessage() : npmUpdateNotice(VERSION, await fetchLatestVersion());
    } catch {
      // best-effort; never disrupt startup
    }
  }
  await writeUpdateStatus(notice);
  if (notice) log(`\x1b[33m${notice}\x1b[0m`);
}

// Detect a CLI on the user's PATH by asking for its version. Intentionally resolves from
// PATH — detecting the user's installed tools is the whole point of the pre-flight /
// `init` checks.
function hasCommand(cmd, versionArg = "--version") {
  try {
    execSync(`${cmd} ${versionArg}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function claudeInstalled() {
  return hasCommand("claude");
}

function promptYesNo(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      res(saysYes(answer));
    });
  });
}

// `npx mulmoterminal init` — idempotent first-run setup. Environment/CLI checks + the
// optional interactive-config launch live here (PATH-command detection); the config
// derivation + write is the tsx-run server/cli-init.ts.
async function runInit(initArgs) {
  log("Setting up MulmoTerminal…\n");

  const [maj, min] = process.versions.node.split(".").map((n) => Number.parseInt(n, 10));
  const nodeOk = maj > 22 || (maj === 22 && min >= 9);
  console.log(nodeOk ? `  ✓ Node ${process.versions.node}` : `  ✗ Node ${process.versions.node} — MulmoTerminal needs ≥ 22.9`);

  const hasClaude = claudeInstalled();
  if (hasClaude) {
    console.log("  ✓ Claude Code CLI");
  } else {
    console.log("  ✗ Claude Code CLI — not found");
    console.log("      → npm install -g @anthropic-ai/claude-code   (then run `claude` and log in)");
  }

  for (const [cmd, versionArg, why, hint] of [
    ["tmux", "-V", "sessions survive a restart", "brew install tmux  ·  apt install tmux"],
    ["gh", "--version", "PRs & Issues view + one-click PRs", "https://cli.github.com  (then: gh auth login)"],
    ["codex", "--version", "run OpenAI Codex as an agent", "npm install -g @openai/codex"],
  ]) {
    console.log(hasCommand(cmd, versionArg) ? `  ✓ ${cmd} — ${why}` : `  ○ ${cmd} — optional (${why})\n      → ${hint}`);
  }

  // Config half: derive working-dir presets from Claude history + write config.json.
  console.log("");
  const initExit = await new Promise((res) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(PKG_DIR, "server", "cli-init.ts"), ...initArgs], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: "inherit",
    });
    child.on("exit", (code) => res(code ?? 0));
  });
  if (initExit) {
    process.exitCode = initExit;
    error("Setup did not complete — see the error above.");
    return;
  }

  // Offer the interactive skill only in a real terminal; a non-TTY run (CI / piped input)
  // must never block waiting on stdin.
  if (hasClaude && process.stdin.isTTY && (await promptYesNo("\nConfigure interactively now with the /mulmoterminal-config skill? [y/N] "))) {
    log("Launching Claude — use  /mulmoterminal-config  (or just ask it to configure MulmoTerminal).");
    spawn("claude", ["Use the mulmoterminal-config skill to configure MulmoTerminal."], { stdio: "inherit" });
    return;
  }
  if (hasClaude) log("Later: run `claude` in any project and use  /mulmoterminal-config");
  log("Setup done. Start MulmoTerminal:  npx mulmoterminal");
}

// `npx mulmoterminal google <command>` — Google account linking. Consent needs a
// loopback listener on this machine, so it can't be driven from the web UI (a phone
// browser can't reach 127.0.0.1 here); the flow lives in the tsx-run server/cli-google.ts.
function runGoogle(googleArgs) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(PKG_DIR, "server", "cli-google.ts"), ...googleArgs], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 0;
      res();
    });
  });
}

function pickOpenCommand() {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "start";
  return "xdg-open";
}

// Resolve with true if nothing is listening on `port`, false otherwise. Binds
// without a host — same as the server's `server.listen(port)` (the `::`
// dual-stack address) — so the probe and the real bind agree on availability.
// Probing 127.0.0.1 here let a port held only on `::` slip through as "free".
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

// Poll the server until it answers, then call onReady; give up after the timeout
// so the launcher never hangs on a crash loop. Returns a cancel function — a
// raced/abandoned attempt stops polling so it can't fire a stale banner.
function waitUntilReady(port, onReady) {
  const startedAt = Date.now();
  let timer = null;
  let cancelled = false;
  const attempt = () => {
    if (cancelled) return;
    const req = httpGet({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (res) => {
      res.resume();
      if (!cancelled) onReady();
    });
    req.on("error", retry);
    req.on("timeout", () => {
      req.destroy();
      retry();
    });
  };
  const retry = () => {
    if (cancelled || Date.now() - startedAt > READY_TIMEOUT_MS) return;
    timer = setTimeout(attempt, 300);
  };
  attempt();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

function printReadyBanner(url) {
  const bar = "\x1b[32m" + "─".repeat(48) + "\x1b[0m";
  console.log(`\n${bar}`);
  console.log(`\x1b[32m  ✓ MulmoTerminal is ready\x1b[0m`);
  console.log(`\x1b[32m  → ${url}\x1b[0m`);
  console.log(`\x1b[32m  Press Ctrl+C to stop.\x1b[0m`);
  console.log(`${bar}\n`);
}

// The two flag decisions live in cli-args.js so they can be checked without a process to
// exit; this turns a decision into the message and the exit.
function decideOrExit(choice) {
  if ("error" in choice) {
    error(choice.error);
    process.exit(1);
  }
  return choice;
}

// Resolve the workspace directory claude runs in (and whose sessions the sidebar
// lists), always absolute. An explicit --cwd that isn't an existing directory is a hard
// error (catches typos before launch); an inherited one is the workspace the server creates.
function resolveCwd(args) {
  const { path: chosen, mustExist } = decideOrExit(chooseCwd(args, process.env));
  const abs = resolve(process.cwd(), chosen);
  if (mustExist && (!existsSync(abs) || !statSync(abs).isDirectory())) {
    error(`--cwd is not a directory: ${abs}`);
    process.exit(1);
  }
  return abs;
}

// Ask the OS for a free port (listen on 0) and return the one it assigned, or null. Only
// reached once someone has said yes to a second instance.
function findEphemeralPort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(null));
    probe.once("listening", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.listen(0);
  });
}

async function choosePort(requested, explicit) {
  if (await isPortFree(requested)) return requested;
  // No SILENT fallback: starting a second server on another port without saying so is how
  // someone ends up with two sharing one home directory without knowing (#611).
  if (portInUseAction(explicit, process.stdin.isTTY) === "stop") {
    error(portInUseMessage(requested, explicit));
    process.exit(1);
  }
  if (!(await promptYesNo(secondInstancePrompt(requested)))) process.exit(1);
  const fallback = await findEphemeralPort();
  if (fallback === null) {
    error("No free port could be found for a second instance.");
    process.exit(1);
  }
  log(SECOND_INSTANCE_NOTE);
  return fallback;
}

// Spawn the server on `port` and report the child via `onChild` (so signal
// handlers target the live process). Resolves only when the server exits because
// the port was taken at bind time before it became ready — the caller then
// reports that and stops. In every other case (clean shutdown, fatal error,
// or the server simply running) the process exits with the server's code.
function runServer(port, noOpen, cwd, onChild) {
  return new Promise((resolveExit) => {
    log(`Starting MulmoTerminal on port ${port}...`);
    const server = spawn(process.execPath, ["--import", "tsx", SERVER_ENTRY], {
      cwd: PKG_DIR,
      env: { ...process.env, NODE_ENV: "production", PORT: String(port), CLAUDE_CWD: cwd },
      stdio: "inherit",
    });
    onChild(server);

    const url = `http://localhost:${port}`;
    const cancelReady = waitUntilReady(port, () => {
      printReadyBanner(url);
      if (noOpen) return;
      try {
        // The command is a hardcoded literal; url is http://localhost:<numeric port>.

        execSync(`${pickOpenCommand()} ${url}`, { stdio: "pipe" });
      } catch {
        log(`Open your browser: ${url}`);
      }
    });

    server.on("exit", (code) => {
      cancelReady();
      // Exit code 75 means this child failed to bind (EADDRINUSE) and never
      // served — always retriable, regardless of what a probe to the port saw
      // (another process could have answered it). Other exits are terminal.
      if (code === PORT_IN_USE_EXIT_CODE) {
        resolveExit();
        return;
      }
      process.exit(code ?? 1);
    });
  });
}

function printHelp() {
  console.log(`
Usage: npx mulmoterminal [command] [options]

Commands:
  (none)            Start the server (default)
  init              First-run setup: check your environment, seed working-directory
                    presets from your Claude Code history, and write
                    ~/.mulmoterminal/config.json (idempotent — safe to re-run)
  google login      Link a Google account (browser consent, on this machine) so the
                    Calendar tool and the phone's google.calendar.* commands can run

Options:
  --cwd <dir>       Working directory claude runs in (default: current directory; relative paths allowed)
  --port <number>   Server port (default: ${DEFAULT_PORT}). If it is in use, you are asked
                    whether to start a second instance on a free port; with --port, or
                    with no terminal to ask, startup stops instead.
  --no-open         Don't open the browser automatically
  --version         Show version
  --help            Show this help
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "init") {
    await runInit(args.slice(1));
    return;
  }

  if (args[0] === "google") {
    await runGoogle(args.slice(1));
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version")) {
    console.log(`mulmoterminal ${VERSION}`);
    return;
  }

  checkForUpdate();

  if (!claudeInstalled()) {
    error("Claude Code CLI not found.");
    error("Install it first:  npm install -g @anthropic-ai/claude-code  &&  claude auth login");
    process.exit(1);
  }
  log("Claude Code CLI ✓");

  if (!existsSync(SERVER_ENTRY)) {
    error(`Server entry not found at ${SERVER_ENTRY}`);
    process.exit(1);
  }

  const { port: requestedPort, explicit: portExplicit } = decideOrExit(parsePortArg(args, DEFAULT_PORT));
  const noOpen = args.includes("--no-open");
  const cwd = resolveCwd(args);
  log(`Workspace: ${cwd}`);

  // Registered once; always targets the live child across bind-retries.
  let child = null;
  const shutdown = () => {
    child?.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // The probe above can still lose to something binding the port in the same instant, in
  // which case the server exits 75 and runServer returns. Same answer as the probe: say who
  // has it rather than moving to a port nobody asked for.
  const port = await choosePort(requestedPort, portExplicit);
  await runServer(port, noOpen, cwd, (c) => {
    child = c;
  });
  error(portInUseMessage(port, portExplicit));
  process.exit(1);
}

main();
