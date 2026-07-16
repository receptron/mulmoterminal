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
import { fetchLatestVersion, isNewerVersion } from "./update-check.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");
const SERVER_ENTRY = join(PKG_DIR, "server", "index.ts");
const DEFAULT_PORT = 34567;
const READY_TIMEOUT_MS = 15_000;
const MAX_BIND_RETRIES = 5;
// Server exit code meaning "port taken at bind time" — keep in sync with
// server/index.ts (PORT_IN_USE_EXIT_CODE).
const PORT_IN_USE_EXIT_CODE = 75;

// Single source of truth: read the version from the shipped package.json so
// `--version` never drifts from the published version.
const { version: VERSION } = createRequire(import.meta.url)("../package.json");

const log = (msg) => console.log(`\x1b[36m[mulmoterminal]\x1b[0m ${msg}`);
const error = (msg) => console.error(`\x1b[31m[mulmoterminal]\x1b[0m ${msg}`);

// Non-blocking notice when a newer version is published — `npm i -g` never
// auto-updates. Opt out via MULMOTERMINAL_NO_UPDATE_CHECK / NO_UPDATE_NOTIFIER.
function checkForUpdate() {
  if (process.env.MULMOTERMINAL_NO_UPDATE_CHECK || process.env.NO_UPDATE_NOTIFIER) return;
  fetchLatestVersion()
    .then((latest) => {
      if (latest && isNewerVersion(latest, VERSION)) {
        log(`\x1b[33mUpdate available: ${VERSION} → ${latest}  ·  run: npm i -g mulmoterminal\x1b[0m`);
      }
    })
    .catch(() => {
      // best-effort; never disrupt startup
    });
}

// Detect a CLI on the user's PATH by asking for its version. Intentionally resolves from
// PATH — detecting the user's installed tools is the whole point of the pre-flight /
// `init` checks.
function hasCommand(cmd, versionArg = "--version") {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
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
      res(/^y(es)?$/i.test(answer.trim()));
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
  await new Promise((res) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(PKG_DIR, "server", "cli-init.ts"), ...initArgs], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code) process.exitCode = code;
      res();
    });
  });

  if (hasClaude) {
    if (await promptYesNo("\nConfigure interactively now with the /mulmoterminal-config skill? [y/N] ")) {
      log("Launching Claude — use  /mulmoterminal-config  (or just ask it to configure MulmoTerminal).");
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      spawn("claude", ["Use the mulmoterminal-config skill to configure MulmoTerminal."], { stdio: "inherit" });
      return;
    }
    log("Later: run `claude` in any project and use  /mulmoterminal-config");
  }
  log("Setup done. Start MulmoTerminal:  npx mulmoterminal");
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

// Ask the OS for a free port (listen on 0) and return the one it assigned, or
// null. An effectively-random fallback when the preferred port is taken; the
// bind-retry in main() closes the small probe-to-bind race so concurrent starts
// don't clash.
function findEphemeralPort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(null));
    probe.once("listening", () => {
      const addr = probe.address();
      const assigned = addr && typeof addr === "object" ? addr.port : null;
      probe.close(() => resolve(assigned));
    });
    probe.listen(0);
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

function parsePortArg(args) {
  const idx = args.indexOf("--port");
  if (idx === -1) return { requestedPort: DEFAULT_PORT, portExplicit: false };
  const raw = args[idx + 1];
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isInteger(parsed) || String(parsed) !== raw || parsed < 1 || parsed > 65535) {
    error(`Invalid --port value: "${raw ?? ""}" (expected integer 1..65535)`);
    process.exit(1);
  }
  return { requestedPort: parsed, portExplicit: true };
}

// Resolve the workspace directory claude runs in (and whose sessions the sidebar
// lists). Precedence: --cwd (relative paths allowed) > CLAUDE_CWD env > the
// directory npx was run from. Always returned absolute. An explicit --cwd that
// isn't an existing directory is a hard error (catches typos before launch).
function resolveCwd(args) {
  const idx = args.indexOf("--cwd");
  let flagValue;
  if (idx !== -1) {
    flagValue = args[idx + 1];
    if (flagValue === undefined || flagValue.startsWith("-")) {
      error("--cwd requires a directory path");
      process.exit(1);
    }
  }
  const chosen = flagValue ?? process.env.CLAUDE_CWD ?? ".";
  const abs = resolve(process.cwd(), chosen);
  if (idx !== -1 && (!existsSync(abs) || !statSync(abs).isDirectory())) {
    error(`--cwd is not a directory: ${abs}`);
    process.exit(1);
  }
  return abs;
}

async function choosePort(requested, explicit) {
  if (await isPortFree(requested)) return requested;
  if (explicit) {
    error(`Port ${requested} is already in use. Stop the other process or pick a different --port.`);
    process.exit(1);
  }
  const fallback = await findEphemeralPort();
  if (fallback === null) {
    error(`Port ${requested} is in use and no free port could be found.`);
    process.exit(1);
  }
  log(`Port ${requested} busy → using ${fallback} instead. (Pass --port <N> to pin.)`);
  return fallback;
}

// Spawn the server on `port` and report the child via `onChild` (so signal
// handlers target the live process). Resolves only when the server exits because
// the port was taken at bind time before it became ready — the caller then
// retries on a fresh port. In every other case (clean shutdown, fatal error,
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

Options:
  --cwd <dir>       Working directory claude runs in (default: current directory; relative paths allowed)
  --port <number>   Server port (default: ${DEFAULT_PORT}; a free port is chosen if it's busy)
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

  const { requestedPort, portExplicit } = parsePortArg(args);
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

  // Start on the chosen port; if the server loses the rare probe-to-bind race,
  // fall back to a fresh OS-assigned port and retry. An explicit --port is not
  // second-guessed. `runServer` only returns when the port was raced.
  let port = await choosePort(requestedPort, portExplicit);
  for (let attempt = 0; attempt <= MAX_BIND_RETRIES; attempt++) {
    await runServer(port, noOpen, cwd, (c) => {
      child = c;
    });
    if (portExplicit) {
      error(`Port ${port} is already in use. Stop the other process or pick a different --port.`);
      process.exit(1);
    }
    const next = await findEphemeralPort();
    if (next === null) {
      error("No free port available to retry on.");
      process.exit(1);
    }
    log(`Port ${port} was taken at bind time → retrying on ${next}.`);
    port = next;
  }
  error(`Could not bind a free port after ${MAX_BIND_RETRIES + 1} attempts.`);
  process.exit(1);
}

main();
