// @vitest-environment node
//
// #2622. The global header chips are changed one entry at a time against the file, and a remove or
// move that names a chip no longer at that index is refused with the list as it now is.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import express from "express";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall, jsonPost } from "../../../helpers/routeCall";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function mountWith(initial: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-chips-"));
  dirs.push(dir);
  vi.stubEnv("HOME", dir);
  vi.stubEnv("USERPROFILE", dir);
  mkdirSync(path.join(dir, ".mulmoterminal"), { recursive: true });
  const file = path.join(dir, ".mulmoterminal", "config.json");
  writeFileSync(file, JSON.stringify(initial));
  vi.resetModules();
  const routes = await import("../../../../server/config/config-routes.js");
  expect(routes.APP_CONFIG_FILE, "config path must be inside the temp HOME").toBe(file);
  const app = express();
  app.use(express.json());
  routes.mountConfigRoutes(app, dir);
  const onDisk = () => JSON.parse(readFileSync(file, "utf8"));
  const writeOnDisk = (config: Record<string, unknown>) => writeFileSync(file, JSON.stringify(config));
  return { post: (route: string, body: unknown) => routeCall(app)(route, jsonPost(body)), onDisk, writeOnDisk };
}

describe("header chips, one entry at a time", () => {
  it("adds to the list ON DISK, keeping a chip written there since boot", async () => {
    const { post, onDisk, writeOnDisk } = await mountWith({ chips: ["git"] });
    writeOnDisk({ chips: ["git", "usage"], prRepos: ["acme/app"] });
    const res = await post("/api/config/chips/add", { label: "env", text: "${branch}" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ chips: ["git", "usage", { label: "env", text: "${branch}" }] });
    expect(onDisk().chips).toEqual(["git", "usage", { label: "env", text: "${branch}" }]);
    expect(onDisk().prRepos).toEqual(["acme/app"]);
  });

  it("starts an unconfigured list from the default set", async () => {
    const { post, onDisk } = await mountWith({});
    const res = await post("/api/config/chips/remove", { index: 0, chip: "git" });
    expect(res.status).toBe(200);
    expect(onDisk().chips).toEqual(["work", "diff", "ctx", "usage", "env", "peer"]);
  });

  it("refuses a stale remove with the list as it now is, and writes nothing", async () => {
    const { post, onDisk, writeOnDisk } = await mountWith({ chips: ["git", "ctx"] });
    writeOnDisk({ chips: ["ctx", "git"] });
    const res = await post("/api/config/chips/remove", { index: 0, chip: "git" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "stale", chips: ["ctx", "git"] });
    expect(onDisk().chips).toEqual(["ctx", "git"]);
  });

  it("moves a chip, and names the problem of an incomplete add", async () => {
    const { post, onDisk } = await mountWith({ chips: ["git", "ctx"] });
    expect((await post("/api/config/chips/move", { index: 1, chip: "ctx", delta: -1 })).status).toBe(200);
    expect(onDisk().chips).toEqual(["ctx", "git"]);
    const refused = await post("/api/config/chips/add", { label: "x" });
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: "text", chips: ["ctx", "git"] });
  });

  it("rejects a malformed remove or move before touching the file", async () => {
    const { post } = await mountWith({ chips: ["git"] });
    expect((await post("/api/config/chips/remove", { index: "0", chip: "git" })).status).toBe(400);
    expect((await post("/api/config/chips/remove", { index: 0, chip: 1 })).status).toBe(400);
    expect((await post("/api/config/chips/move", { index: 0, chip: "git", delta: 2 })).status).toBe(400);
  });

  it("reset removes the key, so the default set applies again", async () => {
    const { post, onDisk } = await mountWith({ chips: ["git"], prRepos: ["acme/app"] });
    const res = await post("/api/config/chips/reset", {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ chips: null });
    expect(onDisk().chips ?? null).toBeNull();
    expect(onDisk().prRepos).toEqual(["acme/app"]);
  });
});
