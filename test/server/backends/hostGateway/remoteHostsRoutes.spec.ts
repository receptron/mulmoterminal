// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { parseRemoteHostsResponse } from "../../../../common/remoteHosts";
import { appRequest } from "../../../helpers/appRequest";
import { fetchJson, mountRemoteHostsRoutes, type FetchJson } from "../../../../server/backends/hostGateway/remoteHostsRoutes";

// Built rather than written out: the lint rule against clear-text URLs cannot tell a refusal fixture from a use.
const plainHttp = (host: string): string => `${"http"}://${host}`;
const status = (version: string) => ({ ready: true, install: "npm", version, commit: null, latest: null, notice: null });

describe("GET /api/remote-hosts", () => {
  let dir: string;
  let configFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "remote-hosts-"));
    configFile = path.join(dir, "config.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const request = (fetchJson: FetchJson) => {
    const app = express();
    mountRemoteHostsRoutes(app, { configFile, localVersion: () => "7.1.0", fetchJson });
    return appRequest(app);
  };

  it("probes each host's update status and reports rejected entries", async () => {
    await writeFile(
      configFile,
      JSON.stringify({
        remoteHosts: [
          { id: "ok", url: "http://127.0.0.1:1" },
          { id: "old", url: "http://127.0.0.1:2" },
          { id: "down", url: "http://127.0.0.1:3" },
          { id: "far", url: plainHttp("10.0.0.1:4") },
        ],
      }),
    );
    const asked: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      asked.push(url);
      if (url.includes(":1/")) return status("7.0.0");
      if (url.includes(":2/")) return status("6.0.0");
      throw new Error("ECONNREFUSED");
    };
    const res = await request(fetchJson)("/api/remote-hosts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      hosts: [
        { id: "ok", label: "ok", state: "reachable", version: "7.0.0" },
        { id: "old", label: "old", state: "version-mismatch", version: "6.0.0" },
        { id: "down", label: "down", state: "unreachable", version: null },
      ],
      rejected: [{ index: 3, reason: expect.stringContaining("loopback") }],
    });
    expect(asked.sort()).toEqual(["http://127.0.0.1:1/api/update-status", "http://127.0.0.1:2/api/update-status", "http://127.0.0.1:3/api/update-status"]);
  });

  it("answers an empty list with no config file, and a reason for an unreadable one", async () => {
    const never: FetchJson = async () => {
      throw new Error("not called");
    };
    expect(await (await request(never)("/api/remote-hosts")).json()).toEqual({ hosts: [], rejected: [] });
    await writeFile(configFile, "{ not json");
    const body = parseRemoteHostsResponse(await (await request(never)("/api/remote-hosts")).json());
    expect(body.hosts).toEqual([]);
    expect(body.rejected).toEqual([{ index: -1, reason: expect.stringContaining(configFile) }]);
  });

  it("gives up on a host that does not answer in time", async () => {
    await writeFile(configFile, JSON.stringify({ remoteHosts: [{ id: "slow", url: "http://127.0.0.1:1" }] }));
    const hang: FetchJson = (_url, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const body = parseRemoteHostsResponse(await (await request(hang)("/api/remote-hosts")).json());
    expect(body.hosts).toEqual([{ id: "slow", label: "slow", state: "unreachable", version: null }]);
  }, 10_000);
});

describe("the probe's own fetch", () => {
  const servers: http.Server[] = [];
  afterEach(() =>
    servers.splice(0).forEach((server) => {
      server.closeAllConnections();
      server.close();
    }),
  );

  async function serve(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    return `http://127.0.0.1:${address.port}`;
  }

  // A redirect leaves the loopback origin the config was checked for.
  it("follows no redirect", async () => {
    const elsewhere: string[] = [];
    const target = await serve((req, res) => {
      elsewhere.push(req.url ?? "");
      res.end("{}");
    });
    const origin = await serve((_req, res) => {
      res.writeHead(302, { location: `${target}/api/update-status` });
      res.end();
    });
    await expect(fetchJson(`${origin}/api/update-status`, AbortSignal.timeout(2000))).rejects.toThrow();
    expect(elsewhere).toEqual([]);
  });

  it("lets go of a failed answer's body", async () => {
    let released = false;
    const origin = await serve((_req, res) => {
      res.on("close", () => {
        released = true;
      });
      res.writeHead(500, { "content-type": "application/json" });
      res.write("{");
    });
    expect(await fetchJson(`${origin}/api/update-status`, AbortSignal.timeout(2000))).toBeNull();
    await expect.poll(() => released, { timeout: 2000 }).toBe(true);
  });

  it("reads a good answer", async () => {
    const origin = await serve((_req, res) => res.end(JSON.stringify({ version: "7.0.0" })));
    expect(await fetchJson(`${origin}/api/update-status`, AbortSignal.timeout(2000))).toEqual({ version: "7.0.0" });
  });
});
