// @vitest-environment node
//
// The bridge is spawned for real (it is a plain .mjs run by node, which is the point — the
// version before it needed `tsx` resolved from the CHILD's cwd and died in every project but
// this one), and answered by a stub HTTP server standing in for the GUI MCP route.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/mcp/bridge.mjs");
const SESSION = "11111111-2222-3333-4444-555555555555";

describe("mcp bridge", () => {
  let server: http.Server;
  let port: number;
  let requests: { url: string; body: string }[];
  let status = 200;

  beforeEach(async () => {
    requests = [];
    status = 200;
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({ url: req.url ?? "", body });
        if (status !== 200) return res.writeHead(status).end();
        const id = JSON.parse(body || "{}").id;
        if (id === undefined) return res.writeHead(202).end(); // a notification
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } })}\n\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  // Runs from a directory that is NOT this package, so a bridge needing anything resolved from
  // its cwd would fail here the way it failed for a user.
  async function run(lines: string[], env: Record<string, string> = {}): Promise<string> {
    const proc = spawn(process.execPath, [bridge], {
      cwd: path.parse(process.cwd()).root,
      env: { ...process.env, MULMOTERMINAL_PORT: String(port), MULMOTERMINAL_SESSION_ID: SESSION, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    for (const line of lines) proc.stdin.write(line + "\n");
    proc.stdin.end();
    await new Promise((resolve) => proc.on("exit", resolve));
    return out;
  }

  it("forwards a request to the session's group URL and returns the SSE payload", async () => {
    const out = await run([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })], { MULMOTERMINAL_TOOL_GROUP: "render" });
    expect(requests[0].url).toBe(`/api/mcp/render/${SESSION}`);
    expect(JSON.parse(out.trim())).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("says nothing back for a notification", async () => {
    expect(await run([JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })])).toBe("");
  });

  // An unanswered request leaves the agent reporting "still connecting" for the life of the
  // session instead of an error, which is how the first version of this failed.
  it("answers an HTTP failure with a JSON-RPC error", async () => {
    status = 500;
    const out = await run([JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })]);
    expect(JSON.parse(out.trim())).toMatchObject({ id: 7, error: { code: -32603 } });
  });

  it("answers with an error rather than hanging when there is no session", async () => {
    const out = await run([JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" })], { MULMOTERMINAL_SESSION_ID: "" });
    expect(JSON.parse(out.trim())).toMatchObject({ id: 9, error: { code: -32603 } });
    expect(requests).toHaveLength(0);
  });
});
