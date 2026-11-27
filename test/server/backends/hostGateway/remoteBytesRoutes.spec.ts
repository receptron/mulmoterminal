// @vitest-environment node
// #3506. The byte proxy against a real remote on loopback: a picture and a seek pass through, a rendered
// document's pictures are kept on the host, a response without the remote's policy is refused, and a
// path outside the cell's directory or a route outside the byte table never reaches the remote.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mountRemoteBytesRoutes } from "../../../../server/backends/hostGateway/remoteBytesRoutes";
import type { RemoteHost } from "../../../../server/backends/hostGateway/remoteHostsConfig";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SANDBOXED = { "content-security-policy": "sandbox", "x-content-type-options": "nosniff" };

let reached: { url: string; headers: IncomingHttpHeaders }[] = [];
let hangAbandoned: Promise<void> = Promise.resolve();
const remote = createServer((req, res) => {
  reached.push({ url: req.url ?? "", headers: req.headers });
  const url = new URL(req.url ?? "", "https://x");
  const path = url.searchParams.get("path") ?? "";
  if (url.pathname === "/api/files/raw" && path === "pic.png") {
    if (req.headers.range === "bytes=0-2")
      return void res.writeHead(206, { "content-type": "image/png", "content-range": "bytes 0-2/11", ...SANDBOXED }).end(PNG.subarray(0, 3));
    return void res.writeHead(200, { "content-type": "image/png", "content-length": String(PNG.length), "set-cookie": "remote=1", ...SANDBOXED }).end(PNG);
  }
  if (url.pathname === "/api/files/raw" && path === "slow.mp4") {
    hangAbandoned = new Promise((resolve) => res.on("close", () => resolve()));
    return void res.writeHead(200, { "content-type": "video/mp4", "x-content-type-options": "nosniff" }).write(PNG);
  }
  if (url.pathname === "/api/files/raw" && path === "bare.html")
    return void res.writeHead(200, { "content-type": "text/html", "x-content-type-options": "nosniff" }).end("<script>1</script>");
  if (url.pathname === "/api/files/browse/md")
    return void res
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "sandbox allow-scripts; script-src 'nonce-n'",
        "x-content-type-options": "nosniff",
      })
      .end(`<img src="/api/files/raw?cwd=%2Fsrv%2Fp&amp;path=pic.png">`);
  res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
});

let gateway: Server;
let gatewayPort = 0;
const portOf = (address: string | AddressInfo | null): number => (address !== null && typeof address === "object" ? address.port : 0);
const listen = (server: Server): Promise<number> => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(portOf(server.address()))));

beforeAll(async () => {
  const hosts: RemoteHost[] = [{ id: "lx", label: "Linux", origin: `http://127.0.0.1:${await listen(remote)}` }];
  const app = express();
  mountRemoteBytesRoutes(app, { remoteHosts: () => hosts });
  gateway = createServer(app);
  gatewayPort = await listen(gateway);
});
afterAll(async () => {
  await Promise.all([gateway, remote].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});
beforeEach(() => {
  reached = [];
});

const get = (path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: gatewayPort, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });

const RAW = "/remote/lx/bytes/api/files/raw?cwd=%2Fsrv%2Fp";

describe("/remote/<id>/bytes/api/…", () => {
  it("passes a picture through with the remote's policy and nothing else of its headers", async () => {
    const answer = await get(`${RAW}&path=pic.png&extra=1`, { cookie: "mac=1" });
    expect(answer.status).toBe(200);
    expect(answer.body.equals(PNG)).toBe(true);
    expect(answer.headers["content-security-policy"]).toBe("sandbox");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.headers["set-cookie"]).toBeUndefined();
    expect(reached.map((r) => r.url)).toEqual(["/api/files/raw?cwd=%2Fsrv%2Fp&path=pic.png"]);
    expect(reached[0]?.headers.cookie).toBeUndefined();
    expect(reached[0]?.headers.origin).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it("carries a seek's range there and its partial answer back", async () => {
    const answer = await get(`${RAW}&path=pic.png`, { range: "bytes=0-2" });
    expect(answer.status).toBe(206);
    expect(answer.headers["content-range"]).toBe("bytes 0-2/11");
    expect(answer.body.equals(PNG.subarray(0, 3))).toBe(true);
  });

  it("keeps a rendered document's pictures on the host", async () => {
    const answer = await get("/remote/lx/bytes/api/files/browse/md?cwd=%2Fsrv%2Fp&path=README.md&embed=1");
    expect(answer.status).toBe(200);
    expect(answer.headers["content-security-policy"]).toBe("sandbox allow-scripts; script-src 'nonce-n'");
    expect(answer.body.toString("utf8")).toBe(`<img src="/remote/lx/bytes/api/files/raw?cwd=%2Fsrv%2Fp&amp;path=pic.png">`);
  });

  it("refuses a response the remote did not sandbox", async () => {
    const answer = await get(`${RAW}&path=bare.html`);
    expect(answer.status).toBe(502);
    expect(answer.body.toString("utf8")).not.toContain("<script>");
  });

  it.each([
    ["a path out of the cell", `${RAW}&path=..%2F..%2Fetc%2Fpasswd`, 400],
    ["a document out of the cell", "/remote/lx/bytes/api/files/browse/md?cwd=%2Fsrv%2Fp&path=..%2Fsecret.md", 400],
    ["an absolute path out of the cell", `${RAW}&path=%2Fetc%2Fpasswd`, 400],
    ["no cwd", "/remote/lx/bytes/api/files/raw?path=pic.png", 400],
    ["a route outside the byte table", "/remote/lx/bytes/api/git-status?cwd=%2Fsrv%2Fp", 404],
    ["a page by path", "/remote/lx/bytes/api/files/page/x", 404],
    ["an unknown host", "/remote/nope/bytes/api/files/raw?cwd=%2Fsrv%2Fp&path=pic.png", 404],
  ])("refuses %s before anything reaches the remote", async (_name, path, status) => {
    expect((await get(path)).status).toBe(status);
    expect(reached).toEqual([]);
  });

  // A stream left by the browser — a video closed, a seek elsewhere — stops on the remote too.
  it("stops the remote's stream when the browser walks away", async () => {
    await new Promise<void>((resolve) => {
      const req = request({ host: "127.0.0.1", port: gatewayPort, path: `${RAW}&path=slow.mp4` }, (res) => {
        res.once("data", () => {
          req.destroy();
          resolve();
        });
      });
      req.on("error", () => {});
      req.end();
    });
    await hangAbandoned;
    expect(reached.map((r) => r.url)).toEqual(["/api/files/raw?cwd=%2Fsrv%2Fp&path=slow.mp4"]);
  });

  it("answers the remote's own refusal with its status", async () => {
    expect((await get(`${RAW}&path=missing.png`)).status).toBe(404);
  });
});
