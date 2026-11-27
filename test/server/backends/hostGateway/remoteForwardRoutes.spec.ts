// @vitest-environment node
// The forwarding routes on real sockets: a stub remote that records what reached it, and a gateway
// with this server's own gates and body parser in front, mounted as mountAppRoutes mounts them.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mountRequestGates } from "../../../../server/routes/request-gates.js";
import { createIsAllowedHost, createIsAllowedOrigin } from "../../../../server/infra/http/allowed-origin.js";
import {
  FORWARD_RESPONSE_MAX_BYTES,
  FORWARD_TIMEOUT_MS,
  RAW_FORWARD_TIMEOUT_MS,
  SLOW_FORWARD_TIMEOUT_MS,
  mountRemoteForwardRoutes,
  mountRemoteRawForwardRoutes,
  timeoutFor,
} from "../../../../server/backends/hostGateway/remoteForwardRoutes.js";
import type { RemoteHost } from "../../../../server/backends/hostGateway/remoteHostsConfig.js";
import type { RemoteRoute } from "../../../../common/remoteRoutes.js";

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const ROUTES: Record<string, RemoteRoute> = {
  status: { method: "GET", path: "/api/git-status", key: "cwd", access: "read", query: ["cwd"] },
  page: { method: "GET", path: "/api/page", key: "none", access: "read", query: [] },
  big: { method: "GET", path: "/api/big", key: "none", access: "read", query: [] },
  moved: { method: "GET", path: "/api/moved", key: "none", access: "read", query: [] },
  hang: { method: "GET", path: "/api/hang", key: "none", access: "read", query: [] },
  push: { method: "POST", path: "/api/worktrees/push", key: "cwd", access: "write", query: ["cwd"], bodyWithin: ["cwd"] },
  memo: { method: "POST", path: "/api/session/:sid/memo", key: "session", access: "write", query: [] },
  drop: {
    method: "POST",
    path: "/api/session/:sid/drop",
    key: "session",
    access: "write",
    query: [],
    body: "raw",
    headers: ["content-type", "x-drop-filename"],
  },
};

interface Reached {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}
let reached: Reached[] = [];
// Whether the remote saw the gateway's request to /api/hang go away before it answered.
let hangAbandoned: Promise<void> = Promise.resolve();

const listen = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return address && typeof address === "object" ? (address satisfies AddressInfo).port : 0;
};

const remote = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    reached.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    if (req.url === "/api/page") return void res.writeHead(200, { "content-type": "text/html" }).end("<script>alert(1)</script>");
    if (req.url === "/api/big") return void res.writeHead(200, { "content-type": "application/json" }).end(`"${"x".repeat(FORWARD_RESPONSE_MAX_BYTES)}"`);
    if (req.url === "/api/moved") return void res.writeHead(302, { location: "http://example.com/" }).end();
    if (req.url === "/api/hang") {
      hangAbandoned = new Promise((resolve) => res.on("close", () => resolve()));
      return;
    }
    res
      .writeHead(req.url?.startsWith("/api/session/") ? 201 : 200, { "content-type": "application/json", "set-cookie": "remote=1" })
      .end(JSON.stringify({ ok: true, url: req.url }));
  });
});

let gateway: Server;
let gatewayPort = 0;
let remoteOrigin = "";
const deadOrigin = "http://127.0.0.1:9";

beforeAll(async () => {
  remoteOrigin = `http://127.0.0.1:${await listen(remote)}`;
  const hosts: RemoteHost[] = [
    { id: "lx", label: "Linux", origin: remoteOrigin },
    { id: "gone", label: "Gone", origin: deadOrigin },
  ];
  const app = express();
  mountRequestGates(app, { isAllowedHost: createIsAllowedHost(new Set()), isAllowedOrigin: createIsAllowedOrigin(new Set()) });
  // As mountAppRoutes orders them: the raw routes before the JSON parser, the rest after it.
  mountRemoteRawForwardRoutes(app, { remoteHosts: () => hosts, routes: ROUTES });
  app.use(express.json());
  mountRemoteForwardRoutes(app, { remoteHosts: () => hosts, routes: ROUTES });
  gateway = createServer(app);
  gatewayPort = await listen(gateway);
});

afterAll(async () => {
  await Promise.all([gateway, remote].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

beforeEach(() => {
  reached = [];
});

// Express's own 404 for a path nothing mounts is HTML.
const jsonOrText = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const call = (method: string, path: string, headers: Record<string, string> = {}, body?: string) =>
  new Promise<{ status: number; headers: IncomingHttpHeaders; json: unknown }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: gatewayPort,
        path,
        method,
        headers: { host: `localhost:${gatewayPort}`, ...(body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) }), ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, json: jsonOrText(Buffer.concat(chunks).toString("utf8")) }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });

const pageOrigin = () => ({ origin: `http://localhost:${gatewayPort}` });

describe("/remote/<id>/api/…", () => {
  it("replays a table route to the host, with the host's own origin and nothing else of the browser's", async () => {
    const answer = await call("GET", "/remote/lx/api/git-status?cwd=%2Fsrv%2Fp&extra=1", { cookie: "mac=secret", ...pageOrigin(), "x-custom": "1" });
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ ok: true, url: "/api/git-status?cwd=%2Fsrv%2Fp" });
    expect(answer.headers["set-cookie"]).toBeUndefined();
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(reached).toHaveLength(1);
    expect(reached[0]?.headers.origin).toBe(remoteOrigin);
    expect(reached[0]?.headers.host).toBe(remoteOrigin.replace("http://", ""));
    expect(reached[0]?.headers.cookie).toBeUndefined();
    expect(reached[0]?.headers["x-custom"]).toBeUndefined();
  });

  it("carries a write's JSON body and the remote's status", async () => {
    const answer = await call(
      "POST",
      `/remote/lx/api/session/${SESSION}/memo`,
      { ...pageOrigin(), "content-type": "application/json" },
      JSON.stringify({ memo: "hi" }),
    );
    expect(answer.status).toBe(201);
    expect(reached.map((r) => [r.method, r.url, r.body])).toEqual([["POST", `/api/session/${SESSION}/memo`, '{"memo":"hi"}']]);
  });

  // The body is read by the JSON parser before the decision, so a path in it is held to the query's cwd.
  it("refuses a body naming a path outside the cell before anything reaches the remote, and carries one inside", async () => {
    const post = (cwd: string) =>
      call("POST", "/remote/lx/api/worktrees/push?cwd=%2Fsrv%2Fp", { ...pageOrigin(), "content-type": "application/json" }, JSON.stringify({ cwd }));
    expect((await post("/srv/other")).status).toBe(400);
    expect(reached).toEqual([]);
    expect((await post("/srv/p")).status).toBe(200);
    expect(reached.map((r) => [r.url, r.body])).toEqual([["/api/worktrees/push?cwd=%2Fsrv%2Fp", '{"cwd":"/srv/p"}']]);
  });

  it("carries no body on a read, whatever the browser sent", async () => {
    const answer = await call("GET", "/remote/lx/api/git-status?cwd=%2Fsrv", { "content-type": "application/json" }, JSON.stringify({ cwd: "/etc" }));
    expect(answer.status).toBe(200);
    expect(reached.map((r) => [r.url, r.body])).toEqual([["/api/git-status?cwd=%2Fsrv", ""]]);
  });

  // A dropped file is bytes, whatever its type says: a dropped .json must not be parsed and re-encoded.
  it("carries a dropped file's bytes, type and name exactly, and nothing else of the browser's", async () => {
    const bytes = '{ "a": 1,\n  "b": [2] }\n';
    const answer = await call(
      "POST",
      `/remote/lx/api/session/${SESSION}/drop`,
      { ...pageOrigin(), "content-type": "application/json", "x-drop-filename": "data%20file.json", cookie: "mac=secret", "x-custom": "1" },
      bytes,
    );
    expect(answer.status).toBe(201);
    expect(reached).toHaveLength(1);
    expect(reached[0]?.body).toBe(bytes);
    expect(reached[0]?.headers["content-type"]).toBe("application/json");
    expect(reached[0]?.headers["x-drop-filename"]).toBe("data%20file.json");
    expect(reached[0]?.headers.origin).toBe(remoteOrigin);
    expect(reached[0]?.headers.cookie).toBeUndefined();
    expect(reached[0]?.headers["x-custom"]).toBeUndefined();
  });

  it("refuses a foreign page's drop before any byte reaches the remote", async () => {
    const answer = await call("POST", `/remote/lx/api/session/${SESSION}/drop`, { origin: "http://evil.example", "content-type": "image/png" }, "png");
    expect(answer.status).toBe(403);
    expect(reached).toEqual([]);
  });

  it("refuses a foreign page's write before anything reaches the remote", async () => {
    const answer = await call("POST", `/remote/lx/api/session/${SESSION}/memo`, { origin: "http://evil.example", "content-type": "application/json" }, "{}");
    expect(answer.status).toBe(403);
    expect(reached).toEqual([]);
  });

  it.each([
    ["GET", "/remote/lx/api/config"],
    ["POST", "/remote/lx/api/git-status?cwd=%2Fsrv"],
    ["GET", `/remote/lx/api/session/${SESSION}/memo`],
    ["GET", "/remote/nope/api/git-status?cwd=%2Fsrv"],
    ["GET", "/remote/LX/api/git-status?cwd=%2Fsrv"],
  ])("answers 404 for %s %s without asking the remote", async (method, path) => {
    const answer = await call(method, path, pageOrigin());
    expect(answer.status).toBe(404);
    expect(answer.json).toMatchObject({ error: expect.any(String) });
    expect(reached).toEqual([]);
  });

  it.each([
    "/remote/lx/api/git-status?cwd=%2Fsrv%2F..%2Fetc",
    "/remote/lx/api/git-status?cwd=relative",
    "/remote/lx/api/git-status",
    "/remote/lx/api/git-status?cwd=%2Fa&cwd=%2Fb",
  ])("answers 400 for %s without asking the remote", async (path) => {
    expect((await call("GET", path)).status).toBe(400);
    expect(reached).toEqual([]);
  });

  it("refuses a session id that is not one", async () => {
    expect((await call("POST", "/remote/lx/api/session/..%2F..%2Fshutdown/memo", { ...pageOrigin(), "content-type": "application/json" }, "{}")).status).toBe(
      404,
    );
    expect(reached).toEqual([]);
  });

  it("names the host and URL when the remote cannot be reached", async () => {
    const answer = await call("GET", "/remote/gone/api/git-status?cwd=%2Fsrv");
    expect(answer.status).toBe(502);
    expect(answer.json).toMatchObject({ error: expect.stringContaining(`Gone did not answer ${deadOrigin}/api/git-status?cwd=%2Fsrv`) });
  });

  it.each([
    ["/remote/lx/api/page", "something other than JSON"],
    ["/remote/lx/api/big", "more than"],
    ["/remote/lx/api/moved", "redirected"],
  ])("answers 502 rather than pass on %s", async (path, why) => {
    const answer = await call("GET", path);
    expect(answer.status).toBe(502);
    expect(answer.headers["content-type"]).toContain("application/json");
    expect(answer.json).toMatchObject({ error: expect.stringContaining(why) });
  });

  // A search the browser has dropped for the next keystroke must not run on at the remote.
  it("stops the remote's work when the browser walks away", async () => {
    const req = request({ host: "127.0.0.1", port: gatewayPort, path: "/remote/lx/api/hang", headers: { host: `localhost:${gatewayPort}` } });
    req.on("error", () => {});
    req.end();
    await expect.poll(() => reached.some((r) => r.url === "/api/hang")).toBe(true);
    req.destroy();
    await hangAbandoned;
  });

  it("leaves every path outside /remote/<id>/api/ alone", async () => {
    expect((await call("GET", "/remote/lx/ws")).status).toBe(404);
    expect((await call("GET", "/api/git-status?cwd=%2Fsrv")).status).toBe(404);
    expect(reached).toEqual([]);
  });
});

describe("timeoutFor", () => {
  const read: RemoteRoute = { method: "GET", path: "/api/x", key: "none", access: "read", query: [] };
  it("gives a route as long as the browser waits for it", () => {
    expect(timeoutFor(read)).toBe(FORWARD_TIMEOUT_MS);
    expect(timeoutFor({ ...read, wait: "slow" })).toBe(SLOW_FORWARD_TIMEOUT_MS);
    expect(timeoutFor({ ...read, method: "POST", access: "write", body: "raw" })).toBe(RAW_FORWARD_TIMEOUT_MS);
  });
});
