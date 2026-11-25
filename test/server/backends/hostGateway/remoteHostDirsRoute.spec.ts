// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { appRequest } from "../../../helpers/appRequest";
import { mountRemoteHostsRoutes, type FetchJson } from "../../../../server/backends/hostGateway/remoteHostsRoutes";

// What a remote's GET /api/config carries besides its directories, none of which may leave the gateway.
const REMOTE_CONFIG = {
  cwd: "/home/u/ws",
  home: "/home/u",
  cwdPresets: [{ label: "app", path: "/home/u/app" }],
  launchers: [{ label: "deploy", command: "secret-deploy --token abc" }],
  pushEnabled: true,
};

describe("GET /api/remote-hosts/:id/dirs", () => {
  let dir: string;
  let configFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "remote-dirs-"));
    configFile = path.join(dir, "config.json");
    await writeFile(configFile, JSON.stringify({ remoteHosts: [{ id: "lx", label: "Linux", url: "http://127.0.0.1:34622" }] }));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const request = (fetchJson: FetchJson) => {
    const app = express();
    mountRemoteHostsRoutes(app, { configFile, localVersion: () => "7.1.0", fetchJson });
    return appRequest(app);
  };

  it("answers the remote's workspace and saved directories, and nothing else from its config", async () => {
    const asked: string[] = [];
    const res = await request(async (url) => {
      asked.push(url);
      return REMOTE_CONFIG;
    })("/api/remote-hosts/lx/dirs");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cwd: "/home/u/ws", presets: [{ label: "app", path: "/home/u/app" }] });
    expect(asked).toEqual(["http://127.0.0.1:34622/api/config"]);
  });

  it("refuses a host that is not configured, without asking anyone", async () => {
    const asked: string[] = [];
    const res = await request(async (url) => {
      asked.push(url);
      return REMOTE_CONFIG;
    })("/api/remote-hosts/nope/dirs");
    expect(res.status).toBe(404);
    expect(asked).toEqual([]);
  });

  it("answers 502 with the host and URL when the remote fails or sends no config", async () => {
    const refused = await request(async () => {
      throw new Error("ECONNREFUSED");
    })("/api/remote-hosts/lx/dirs");
    expect(refused.status).toBe(502);
    expect(await refused.json()).toEqual({ error: expect.stringContaining("Linux did not answer http://127.0.0.1:34622/api/config") });
    const empty = await request(async () => null)("/api/remote-hosts/lx/dirs");
    expect(empty.status).toBe(502);
  });

  it("gives up on a remote that does not answer in time", async () => {
    const hang: FetchJson = (_url, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect((await request(hang)("/api/remote-hosts/lx/dirs")).status).toBe(502);
  }, 10_000);
});

describe("GET /api/remote-hosts/ids", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "remote-ids-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const never: FetchJson = async () => {
    throw new Error("the id list probes no host");
  };
  const idsFrom = async (configFile: string) => {
    const app = express();
    mountRemoteHostsRoutes(app, { configFile, localVersion: () => "7.1.0", fetchJson: never });
    return (await appRequest(app)("/api/remote-hosts/ids")).json();
  };

  it("lists the loaded hosts without probing them, leaving out refused entries", async () => {
    const configFile = path.join(dir, "config.json");
    await writeFile(
      configFile,
      JSON.stringify({
        remoteHosts: [
          { id: "lx", url: "http://127.0.0.1:1" },
          { id: "Bad id", url: "http://127.0.0.1:2" },
          { id: "b", url: "http://127.0.0.1:3" },
        ],
      }),
    );
    expect(await idsFrom(configFile)).toEqual({ ids: ["lx", "b"] });
  });
  it("lists none with no config file", async () => {
    expect(await idsFrom(path.join(dir, "missing.json"))).toEqual({ ids: [] });
  });
});
