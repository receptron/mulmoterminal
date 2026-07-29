// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridgeScript = path.resolve(__dirname, "../../../server/mcp/stdio-bridge.ts");

describe("stdio-bridge", () => {
  let server: http.Server;
  let serverPort: number;
  let receivedRequests: any[] = [];
  let lastHeaders: http.IncomingHttpHeaders = {};

  beforeEach(async () => {
    receivedRequests = [];
    server = http.createServer((req, res) => {
      lastHeaders = req.headers;
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const json = JSON.parse(body || "{}");
        receivedRequests.push(json);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const responseData = JSON.stringify({ jsonrpc: "2.0", id: json.id, result: { status: "ok" } });
        res.end(`event: message\ndata: ${responseData}\n\n`);
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        serverPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("proxies stdin JSON-RPC line to HTTP MCP server and outputs SSE json payload", async () => {
    const proc = spawn("node", ["--import", "tsx", bridgeScript], {
      env: {
        ...process.env,
        MULMOTERMINAL_PORT: String(serverPort),
        MULMOTERMINAL_SESSION_ID: "test-session-123",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    const requestObj = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    proc.stdin.write(JSON.stringify(requestObj) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 400));
    proc.kill();

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0]).toEqual(requestObj);
    expect(lastHeaders.accept).toContain("application/json");
    expect(output.trim()).toBe(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: "ok" } }));
  });
});
