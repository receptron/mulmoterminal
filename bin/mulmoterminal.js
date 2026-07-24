#!/usr/bin/env node

// MulmoTerminal launcher — `npx mulmoterminal` entry point.
//
// Ships the server source (TypeScript) + a pre-built client (Vite dist/), and
// runs the server via tsx. Mirrors the mulmoclaude launcher.

import { execSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { get as httpGet } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { computeUpdateNotice, isUpdateCheckDisabled } from "./update-check.js";
import { detectNpxCacheDir, npxCacheHintLines } from "./npx-cache-hint.js";
import {
  chooseCwd,
  parsePortArg,
  portInUseAction,
  portInUseMessage,
  saysYes,
  secondInstancePrompt,
  SECOND_INSTANCE_NOTE,
  nodeMeetsMinimum,
  MIN_NODE_LABEL,
} from "./cli-args.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");
const SERVER_ENTRY = join(PKG_DIR, "server", "index.ts");
const DEFAULT_PORT = 34567;
const READY_TIMEOUT_MS = 15_000;
// Server exit code meaning "port taken at bind time" — keep in sync with
// server/index.ts (PORT_IN_USE_EXIT_CODE).
const PORT_IN_USE_EXIT_CODE = 75;
// Only the end of stderr matters for the crash diagnosis; a long-lived server can log
// arbitrarily much before dying, so the tail is bounded.
const STDERR_TAIL_MAX_BYTES = 64 * 1024;

// Single source of truth: read the version from the shipped package.json so
// `--version` never drifts from the published version.
const { version: VERSION } = createRequire(import.meta.url)("../package.json");

const log = (msg) => console.log(`\x1b[36m[mulmoterminal]\x1b[0m ${msg}`);
const error = (msg) => console.error(`\x1b[31m[mulmoterminal]\x1b[0m ${msg}`);

// Non-blocking console notice that a newer version exists — neither `npm i -g` nor a git
// checkout auto-updates. Opt out via MULMOTERMINAL_NO_UPDATE_CHECK / NO_UPDATE_NOTIFIER. The
// same check runs in the server for the web-header badge (the launcher isn't involved under
// `yarn dev`), sharing computeUpdateNotice so the two never drift.
async function checkForUpdate() {
  if (isUpdateCheckDisabled(process.env)) return;
  try {
    const notice = await computeUpdateNotice(PKG_DIR, VERSION);
    if (notice) log(`\x1b[33m${notice}\x1b[0m`);
  } catch {
    // best-effort; never disrupt startup
  }
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

  const nodeOk = nodeMeetsMinimum(process.versions.node);
  console.log(nodeOk ? `  ✓ Node ${process.versions.node}` : `  ✗ Node ${process.versions.node} — MulmoTerminal needs ≥ ${MIN_NODE_LABEL}`);

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
    // stderr is piped (and passed through) so a fatal boot error can be inspected once the
    // child closes — a half-unpacked npx cache entry crashes here with ERR_MODULE_NOT_FOUND,
    // and without reading stderr the launcher cannot tell that from a real bug.
    const server = spawn(process.execPath, ["--import", "tsx", SERVER_ENTRY], {
      cwd: PKG_DIR,
      env: { ...process.env, NODE_ENV: "production", PORT: String(port), CLAUDE_CWD: cwd },
      stdio: ["inherit", "inherit", "pipe"],
    });
    let stderrTail = "";
    server.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX_BYTES);
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

    // `close`, not `exit`: it fires only once the piped stderr has fully drained, so the
    // whole crash output — including a trailing `_npx/<hash>` line that can arrive after
    // `exit` — is in `stderrTail` before we inspect it.
    server.on("close", (code) => {
      cancelReady();
      // Exit code 75 means this child failed to bind (EADDRINUSE) and never
      // served — always retriable, regardless of what a probe to the port saw
      // (another process could have answered it). Other exits are terminal.
      if (code === PORT_IN_USE_EXIT_CODE) {
        resolveExit();
        return;
      }
      if (code !== 0) {
        const cacheDir = detectNpxCacheDir(stderrTail);
        if (cacheDir) npxCacheHintLines(cacheDir, process.platform).forEach((line) => error(line));
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
