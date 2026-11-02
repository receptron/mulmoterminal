// @vitest-environment node
// "junction" makes a directory link Windows creates without admin, and is ignored elsewhere — so
// Windows CI lists a real junction here.
import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { makeTempDir } from "../../support/tempDir.js";
import { routeCall } from "../../helpers/routeCall";
import { listEntries, mountFilesBrowseRoutes } from "../../../server/files/files-browse";

const tmp = () => makeTempDir("mt-files-link-");

const serveProject = (dir: string) => {
  const app = express();
  mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
  return app;
};

describe("listEntries — linked folders", () => {
  it("lists a link to a folder among the folders, and a broken link as an empty file", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "target"));
    writeFileSync(path.join(dir, "b.txt"), "hello");
    symlinkSync(path.join(dir, "target"), path.join(dir, "linked"), "junction");
    symlinkSync(path.join(dir, "nowhere"), path.join(dir, "broken"), "junction");
    expect(listEntries(dir)).toEqual([
      { name: "linked", dir: true, size: 0 },
      { name: "target", dir: true, size: 0 },
      { name: "b.txt", dir: false, size: 5 },
      { name: "broken", dir: false, size: 0 },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("GET /api/files/browse/list — linked folders", () => {
  it("opens a linked folder inside the project, and still refuses one leading outside", async () => {
    const dir = tmp();
    const outside = tmp();
    mkdirSync(path.join(dir, "target"));
    writeFileSync(path.join(dir, "target", "inner.txt"), "x");
    symlinkSync(path.join(dir, "target"), path.join(dir, "linked"), "junction");
    symlinkSync(outside, path.join(dir, "away"), "junction");
    const list = (rel: string) => routeCall(serveProject(dir))(`/api/files/browse/list?cwd=${encodeURIComponent(dir)}&path=${rel}`);
    expect((await list("")).body.entries).toEqual([
      { name: "away", dir: true, size: 0 },
      { name: "linked", dir: true, size: 0 },
      { name: "target", dir: true, size: 0 },
    ]);
    const inside = await list("linked");
    expect(inside.status).toBe(200);
    expect(inside.body.entries).toEqual([{ name: "inner.txt", dir: false, size: 1 }]);
    expect((await list("away")).status).toBe(403);
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});
