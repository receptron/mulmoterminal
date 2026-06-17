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
const MAX_PORT_PROBES = 20;

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

// Resolve with true if nothing is listening on `port`, false otherwise.
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(start) {
  for (let port = start; port < start + MAX_PORT_PROBES; port++) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

// Poll the server until it answers, then call onReady; give up after the timeout
// so the launcher never hangs on a crash loop.
function waitUntilReady(port, onReady) {
  const startedAt = Date.now();
  const attempt = () => {
    const req = httpGet({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (res) => {
      res.resume();
      onReady();
    });
    req.on("error", retry);
    req.on("timeout", () => {
      req.destroy();
      retry();
    });
  };
  const retry = () => {
    if (Date.now() - startedAt > READY_TIMEOUT_MS) return;
    setTimeout(attempt, 300);
  };
  attempt();
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
  const fallback = await findAvailablePort(requested + 1);
  if (fallback === null) {
    error(`Port ${requested} is in use and no free port found nearby.`);
    process.exit(1);
  }
  log(`Port ${requested} busy → using ${fallback} instead. (Pass --port <N> to pin.)`);
  return fallback;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npx mulmoterminal [options]

Options:
  --port <number>   Server port (default: ${DEFAULT_PORT})
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
  const port = await choosePort(requestedPort, portExplicit);

  log(`Starting MulmoTerminal on port ${port}...`);
  const server = spawn(process.execPath, ["--import", "tsx", SERVER_ENTRY], {
    cwd: PKG_DIR,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
    stdio: "inherit",
  });

  const url = `http://localhost:${port}`;
  const noOpen = args.includes("--no-open");
  waitUntilReady(port, () => {
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

  const shutdown = () => {
    server.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  server.on("exit", (code) => process.exit(code ?? 1));
}

main();
