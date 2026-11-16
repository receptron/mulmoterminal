// @vitest-environment node
import { describe, it, expect } from "vitest";
import { realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { makeTempDir } from "../../support/tempDir.js";
import { routeCall } from "../../helpers/routeCall";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";

const tmp = () => makeTempDir("mt-files-");

const serveProject = (dir: string) => {
  const app = express();
  app.use(express.json());
  mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
  return app;
};

// #3301. The pane shows media behind a symlink out of the project through a one-file grant, and
// decides that from this field — so the route must set it for that refusal and for no other.
describe("a 403 says when a symlink is what leads out", () => {
  const project = () => {
    const dir = realpathSync(tmp());
    const outside = realpathSync(tmp());
    writeFileSync(path.join(outside, "clip.mp4"), "v");
    symlinkSync(outside, path.join(dir, "media"));
    return dir;
  };

  it.each(["version", "text"])("on /browse/%s for a file behind the link", async (route) => {
    const dir = project();
    const res = await routeCall(serveProject(dir))(`/api/files/browse/${route}?cwd=${encodeURIComponent(dir)}&path=media/clip.mp4`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "path escapes the project root", escape: "symlink", absolutePath: path.join(dir, "media", "clip.mp4") });
  });

  it("not for a climb out by spelling", async () => {
    const dir = project();
    const res = await routeCall(serveProject(dir))(`/api/files/browse/version?cwd=${encodeURIComponent(dir)}&path=../clip.mp4`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "path escapes the project root" });
  });
});
