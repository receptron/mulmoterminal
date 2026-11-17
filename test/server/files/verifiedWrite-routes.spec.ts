// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import fs, { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { makeTempDir } from "../../support/tempDir.js";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";
import { mountFilesTreeRoutes } from "../../../server/files/files-tree-routes";

// #3306. `docs` is swapped for a link out at the last moment — just before the route opens the file
// for WRITING, after its containment check and its reads have answered. Nothing may be written outside.
const layout = () => {
  const top = realpathSync(makeTempDir("mt-verified-route-"));
  const root = path.join(top, "root");
  const outside = path.join(top, "outside");
  mkdirSync(path.join(root, "docs"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(outside, "a.md"), "outside, untouched");
  return { root, outside, cleanup: () => rmSync(top, { recursive: true, force: true }) };
};

const opensForWriting = (flags: unknown): boolean => typeof flags === "number" && (flags & fs.constants.O_WRONLY) !== 0;

const swapOutOnFirstWriteOpen = (root: string, outside: string) => {
  const open = fs.openSync;
  const swapped = { done: false };
  vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => {
    if (!swapped.done && opensForWriting(args[1])) {
      swapped.done = true;
      renameSync(path.join(root, "docs"), path.join(root, "docs-aside"));
      symlinkSync(outside, path.join(root, "docs"));
    }
    return open(...args);
  });
};

const serve = (root: string) => {
  const app = express();
  app.use(express.json());
  mountFilesBrowseRoutes(app, { defaultCwd: root, backupRoot: path.join(root, ".backups") });
  mountFilesTreeRoutes(app, { base: () => root });
  return app;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a folder swapped for a link out between the check and the open", () => {
  it("/browse/write answers 403 and leaves the file outside as it was", async () => {
    const { root, outside, cleanup } = layout();
    writeFileSync(path.join(root, "docs", "a.md"), "inside");
    const version = (await routeCall(serve(root))(`/api/files/browse/version?cwd=${encodeURIComponent(root)}&path=docs/a.md`)).body.version;
    swapOutOnFirstWriteOpen(root, outside);
    const res = await routeCall(serve(root))(`/api/files/browse/write?cwd=${encodeURIComponent(root)}&path=docs/a.md`, {
      ...jsonPost({ text: "redirected", baseVersion: version }),
      method: "PUT",
    });
    expect(res.status).toBe(403);
    expect(readFileSync(path.join(outside, "a.md"), "utf8")).toBe("outside, untouched");
    cleanup();
  });

  it("/browse/create answers 403, and what it leaves outside is an empty file", async () => {
    const { root, outside, cleanup } = layout();
    swapOutOnFirstWriteOpen(root, outside);
    const res = await routeCall(serve(root))(`/api/files/browse/create?cwd=${encodeURIComponent(root)}&path=docs`, {
      ...jsonPost({ name: "new.md", kind: "file" }),
    });
    expect(res.status).toBe(403);
    expect(readFileSync(path.join(outside, "new.md"), "utf8")).toBe("");
    cleanup();
  });
});
