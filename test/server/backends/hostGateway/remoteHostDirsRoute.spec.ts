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

const requestOn = (configFile: string, fetchJson: FetchJson) => {
  const app = express();
  mountRemoteHostsRoutes(app, { configFile, localVersion: () => "7.1.0", fetchJson });
  return appRequest(app);
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

  const request = (fetchJson: FetchJson) => requestOn(configFile, fetchJson);

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

describe("GET /api/remote-hosts/:id/activity", () => {
  const A = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
  const B = "1c8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
  let dir: string;
  let configFile: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "remote-activity-"));
    configFile = path.join(dir, "config.json");
    await writeFile(configFile, JSON.stringify({ remoteHosts: [{ id: "lx", label: "Linux", url: "http://127.0.0.1:34622" }] }));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const request = (fetchJson: FetchJson) => requestOn(configFile, fetchJson);

  it("asks the remote for valid ids only and answers three fields per asked id", async () => {
    const asked: string[] = [];
    const res = await request(async (url) => {
      asked.push(url);
      return { [A]: { working: true, waiting: false, event: "UserPromptSubmit", lastPrompt: "secret" }, other: { working: true } };
    })(`/api/remote-hosts/lx/activity?ids=${A},${B},../x,not-a-uuid`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      [A]: { working: true, waiting: false, event: "UserPromptSubmit" },
      [B]: { working: false, waiting: false, event: null },
    });
    expect(asked).toEqual([`http://127.0.0.1:34622/api/activity?ids=${A},${B}`]);
  });

  it("asks nothing for an unknown host or no valid id, and answers 502 when the remote fails", async () => {
    const asked: string[] = [];
    const record: FetchJson = async (url) => {
      asked.push(url);
      throw new Error("ECONNREFUSED");
    };
    expect((await request(record)(`/api/remote-hosts/nope/activity?ids=${A}`)).status).toBe(404);
    expect(await (await request(record)("/api/remote-hosts/lx/activity?ids=bad")).json()).toEqual({});
    expect(asked).toEqual([]);
    const failed = await request(record)(`/api/remote-hosts/lx/activity?ids=${A}`);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: expect.stringContaining("Linux did not answer") });
  });
});

describe("GET /api/remote-hosts/:id/session/:sid", () => {
  const SID = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
  let dir: string;
  let configFile: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "remote-detail-"));
    configFile = path.join(dir, "config.json");
    await writeFile(configFile, JSON.stringify({ remoteHosts: [{ id: "lx", label: "Linux", url: "http://127.0.0.1:34622" }] }));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const recording = (answer: unknown) => {
    const asked: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      asked.push(url);
      return answer;
    };
    return { asked, request: (url: string) => requestOn(configFile, fetchJson)(url) };
  };

  it("forwards the agent and the remote directory, and answers only the fields a cell shows", async () => {
    const { asked, request } = recording({ usage: { inputTokens: 1 }, aiTitle: "t", peerName: "peer", collection: { slug: "x" }, cwd: "/srv" });
    const res = await request(`/api/remote-hosts/lx/session/${SID}?agent=codex&cwd=%2Fsrv%2Fp&extra=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usage: { inputTokens: 1 }, aiTitle: "t" });
    expect(asked).toEqual([`http://127.0.0.1:34622/api/session/${SID}?agent=codex&cwd=%2Fsrv%2Fp`]);
  });

  it("falls back to claude for an unknown agent and drops a directory that is not absolute", async () => {
    const { asked, request } = recording({});
    await request(`/api/remote-hosts/lx/session/${SID}?agent=../x&cwd=srv`);
    expect(asked).toEqual([`http://127.0.0.1:34622/api/session/${SID}?agent=claude`]);
  });

  it("refuses an id that is not a session's, and an unknown host, without asking the remote", async () => {
    const { asked, request } = recording({});
    expect((await request("/api/remote-hosts/lx/session/not-a-uuid")).status).toBe(400);
    expect((await request(`/api/remote-hosts/nope/session/${SID}`)).status).toBe(404);
    expect(asked).toEqual([]);
  });

  it("answers 502 when the remote fails", async () => {
    const res = await requestOn(configFile, async () => {
      throw new Error("ECONNREFUSED");
    })(`/api/remote-hosts/lx/session/${SID}`);
    expect(res.status).toBe(502);
  });
});
