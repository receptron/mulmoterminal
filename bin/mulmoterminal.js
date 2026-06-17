#!/usr/bin/env node

// MulmoTerminal launcher — `npx mulmoterminal` entry point.
//
// Ships the server source (TypeScript) + a pre-built client (Vite dist/), and
// runs the server via tsx. Mirrors the mulmoclaude launcher.

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { get as httpGet } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");
const SERVER_ENTRY = join(PKG_DIR, "server", "index.ts");
const DEFAULT_PORT = 3456;
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

function claudeInstalled() {
  try {
    // Intentionally resolves `claude` from the user's PATH — detecting their
    // Claude Code CLI install is the whole point of this pre-flight check.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execSync("claude --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
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
function runServer(port, noOpen, onChild) {
  return new Promise((resolve) => {
    log(`Starting MulmoTerminal on port ${port}...`);
    const server = spawn(process.execPath, ["--import", "tsx", SERVER_ENTRY], {
      cwd: PKG_DIR,
      env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
      stdio: "inherit",
    });
    onChild(server);

    const url = `http://localhost:${port}`;
    const cancelReady = waitUntilReady(port, () => {
      printReadyBanner(url);
      if (noOpen) return;
      try {
        // The command is a hardcoded literal; url is http://localhost:<numeric port>.
        // eslint-disable-next-line sonarjs/os-command
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
        resolve();
        return;
      }
      process.exit(code ?? 1);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npx mulmoterminal [options]

Options:
  --port <number>   Server port (default: ${DEFAULT_PORT}; a free port is chosen if it's busy)
  --no-open         Don't open the browser automatically
  --version         Show version
  --help            Show this help
`);
    return;
  }
  if (args.includes("--version")) {
    console.log(`mulmoterminal ${VERSION}`);
    return;
  }

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
    await runServer(port, noOpen, (c) => {
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
