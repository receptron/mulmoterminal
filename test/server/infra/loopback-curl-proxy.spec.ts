// @vitest-environment node
// Every curl this server hands an agent posts back to itself, and curl sends even a loopback URL to
// an `http_proxy` / `ALL_PROXY` the agent's pane inherited (#2253). Each command is run here the way
// the agent runs it — through a shell, under those variables — and must reach the server, not the
// proxy. One file for the whole class, so a fifth curl added without `--noproxy` has a place to fail.
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { hookSettingsJson } from "../../../server/session/hook-settings.js";
import { statusLineCommand } from "../../../server/agents/statusline.js";
import { copilotHooksJson } from "../../../server/agents/copilot-hooks-file.js";
import { CODEX_PERMISSION_HOOK_COMMAND } from "../../../server/agents/codex-hook.js";

interface Landing {
  target: number;
  proxy: number;
}

const listenCounting = async (counts: Landing, key: keyof Landing): Promise<{ server: Server; port: number }> => {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      counts[key] += 1;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  return { server, port: address.port };
};

/** Run the command a builder makes for the target's port, under a proxy that counts what reaches it. */
const whereItLands = async (commandFor: (port: number) => string, envFor: (port: number) => Record<string, string> = () => ({})): Promise<Landing> => {
  const counts: Landing = { target: 0, proxy: 0 };
  const target = await listenCounting(counts, "target");
  const proxy = await listenCounting(counts, "proxy");
  const proxyUrl = `http://127.0.0.1:${proxy.port}`;
  try {
    const child = spawn("/bin/sh", ["-c", commandFor(target.port)], {
      env: { PATH: process.env.PATH ?? "", http_proxy: proxyUrl, ALL_PROXY: proxyUrl, all_proxy: proxyUrl, ...envFor(target.port) },
    });
    child.stdin.end("{}");
    await new Promise((resolve) => child.on("close", resolve));
    return counts;
  } finally {
    target.server.close();
    proxy.server.close();
  }
};

const SESSION = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const DIRECT: Landing = { target: 1, proxy: 0 };

describe.skipIf(process.platform === "win32")("a loopback curl ignores an inherited proxy", () => {
  it("claude's hook, as spawn-claude builds it (localhost)", async () => {
    const claudeHook = (port: number): string => JSON.parse(hookSettingsJson({ host: "localhost", port, sessionId: SESSION })).hooks.Stop[0].hooks[0].command;
    expect(await whereItLands(claudeHook)).toEqual(DIRECT);
  });

  it("claude's hook on a literal loopback address", async () => {
    const claudeHook = (port: number): string => JSON.parse(hookSettingsJson({ host: "127.0.0.1", port, sessionId: SESSION })).hooks.Stop[0].hooks[0].command;
    expect(await whereItLands(claudeHook)).toEqual(DIRECT);
  });

  it("the rate-limit status line", async () => {
    expect(await whereItLands((port) => statusLineCommand("localhost", port))).toEqual(DIRECT);
  });

  it("copilot's hook (the bash command)", async () => {
    const copilotHook = (port: number): string => JSON.parse(copilotHooksJson("127.0.0.1", port)).hooks.agentStop[0].bash;
    expect(await whereItLands(copilotHook)).toEqual(DIRECT);
  });

  it("codex's permission hook", async () => {
    const env = (port: number) => ({ MULMOTERMINAL_PORT: String(port), MULMOTERMINAL_SESSION_ID: SESSION });
    expect(await whereItLands(() => CODEX_PERMISSION_HOOK_COMMAND, env)).toEqual(DIRECT);
  });
});

// The bundled skills hand agents curl lines to run against this server. They cannot be executed
// here (they read a live server), so they are held to the flag by text instead.
const SKILLS_DIR = path.resolve(__dirname, "../../../server/skills");
const LOOPBACK_CURL = /\bcurl\b[^\n]*http:\/\/(localhost|127\.0\.0\.1)[:/]/;
const lacksBypass = (line: string): boolean => LOOPBACK_CURL.test(line) && !/--noproxy\s+(localhost|127\.0\.0\.1)\b/.test(line);

describe("the loopback curl matcher", () => {
  it("flags a loopback curl without the bypass, and passes one with it", () => {
    expect(lacksBypass('curl -s "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/config"')).toBe(true);
    expect(lacksBypass("`curl -s http://127.0.0.1:34567/api/sessions`")).toBe(true);
    expect(lacksBypass('curl --noproxy localhost -s "http://localhost:34567/api/config"')).toBe(false);
  });

  it("ignores a curl to anywhere else", () => {
    expect(lacksBypass("curl -s https://example.com/api/config")).toBe(false);
    expect(lacksBypass("curl -s http://localhostile.example/api")).toBe(false);
  });
});

describe("bundled skills", () => {
  it("bypass the proxy on every curl back to this server", () => {
    const offending = readdirSync(SKILLS_DIR, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".md"))
      .flatMap((file) =>
        readFileSync(path.join(SKILLS_DIR, file), "utf8")
          .split("\n")
          .filter(lacksBypass)
          .map((line) => `${file}: ${line.trim()}`),
      );
    expect(offending).toEqual([]);
  });
});
