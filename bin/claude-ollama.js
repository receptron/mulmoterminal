#!/usr/bin/env node

// `claude-ollama <model> [claude args…]` — run Claude Code fully locally against an
// Ollama-served model. Ollama 0.31+ serves a native Anthropic-compatible `/v1/messages`, so
// Claude Code connects directly; this launcher just sets up the three things that make it
// actually work with a small local model:
//   1. a dedicated large-context `ollama serve` (the 4096 default overflows Claude's prompt),
//   2. `--bare --disable-slash-commands` so the system prompt is small enough for the model,
//   3. the env recipe (unset ANTHROPIC_API_KEY, point ANTHROPIC_BASE_URL at the local server).

import { execSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { get as httpGet } from "node:http";
import { parseClaudeOllamaArgs, buildClaudeEnv, buildOllamaServeEnv, buildClaudeArgs, modelIsInstalled, OLLAMA_CONTEXT_LENGTH } from "./ollama-launch.js";

const log = (msg) => console.log(`\x1b[36m[claude-ollama]\x1b[0m ${msg}`);
const error = (msg) => console.error(`\x1b[31m[claude-ollama]\x1b[0m ${msg}`);

const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 400;

function printHelp() {
  console.log(
    [
      "Usage: claude-ollama <model> [claude args…]",
      "",
      "Run Claude Code against a local Ollama model — no cloud, no API key.",
      "Starts a dedicated large-context Ollama server on a private port and launches",
      "Claude Code with a minimal system prompt (--bare) so small models aren't drowned.",
      "",
      "Examples:",
      "  claude-ollama qwen3:4b",
      '  claude-ollama qwen3:30b-a3b "refactor this module"',
      "",
      "Notes:",
      "  - The model must be pulled first:  ollama pull <model>",
      "  - Validate a model through a real multi-turn tool run; small ones vary.",
    ].join("\n"),
  );
}

function hasCommand(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A free TCP port for the private ollama server, so an Ollama the user already runs (11434)
// is left alone.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// GET a small JSON endpoint on the local server, best-effort (null on any failure).
function getJson(port, path, timeout_ms = 2000) {
  return new Promise((resolve) => {
    const req = httpGet({ host: "127.0.0.1", port, path, timeout: timeout_ms }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitUntilReady(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    if (await getJson(port, "/api/version")) return true;
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  return false;
}

function requireCommands() {
  if (!hasCommand("ollama")) {
    error("`ollama` not found on PATH. Install it: https://ollama.com/download");
    process.exit(1);
  }
  if (!hasCommand("claude")) {
    error("`claude` (Claude Code) not found. Install it: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }
}

// Start the private ollama server and return a `stop` that kills it. The stop is wired to
// this process's own exit and signals so the server never outlives the launcher.
function startPrivateOllama(host) {
  const serve = spawn("ollama", ["serve"], {
    stdio: "ignore",
    env: buildOllamaServeEnv(process.env, host, OLLAMA_CONTEXT_LENGTH),
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      serve.kill("SIGTERM");
    } catch {
      // already gone
    }
  };
  process.on("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stop();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
  serve.on("error", (e) => {
    error(`failed to start ollama serve: ${e.message}`);
    process.exit(1);
  });
  return stop;
}

// Hand off to interactive Claude Code; exit with its code and stop our server behind it.
function runClaude(model, baseUrl, claudeArgs, stopServe) {
  log(`launching Claude Code on ${model} (minimal prompt: --bare --disable-slash-commands)`);
  const claude = spawn("claude", buildClaudeArgs(claudeArgs), {
    stdio: "inherit",
    env: buildClaudeEnv(process.env, model, baseUrl),
  });
  claude.on("error", (e) => {
    error(`failed to launch claude: ${e.message}`);
    stopServe();
    process.exit(1);
  });
  claude.on("exit", (code) => {
    stopServe();
    process.exit(code ?? 0);
  });
}

async function main() {
  const { help, model, claudeArgs } = parseClaudeOllamaArgs(process.argv.slice(2));
  if (help || !model) {
    printHelp();
    process.exit(help ? 0 : 1);
  }
  requireCommands();
  const port = await findFreePort();
  const host = `127.0.0.1:${port}`;
  log(`starting a private Ollama server on ${host} (context ${OLLAMA_CONTEXT_LENGTH})…`);
  const stopServe = startPrivateOllama(host);
  if (!(await waitUntilReady(port))) {
    error("the Ollama server did not become ready in time");
    stopServe();
    process.exit(1);
  }
  const tags = await getJson(port, "/api/tags");
  if (tags && !modelIsInstalled(tags, model)) {
    error(`model '${model}' is not installed. Pull it first:  ollama pull ${model}`);
    stopServe();
    process.exit(1);
  }
  runClaude(model, `http://${host}`, claudeArgs, stopServe);
}

main().catch((e) => {
  error(e?.message || String(e));
  process.exit(1);
});
