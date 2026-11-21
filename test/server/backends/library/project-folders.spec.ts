// @vitest-environment node
// A project folder's directory (#3334): the one the index knows whose name, by Claude Code's rule from
// its real path, is the folder's — for the Memory view, the health check and the tidy-up route alike.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { directoriesByFolder, forgetResolvedFolders, uniqueByFolder } from "../../../../server/backends/library/project-folders.js";
import { encodeProjectDirName, REALPATH_MEMO_MS } from "../../../../server/session/project-dir.js";

const dirs: string[] = [];
beforeEach(() => forgetResolvedFolders());
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("uniqueByFolder", () => {
  const at = (cwd: string, real: string = cwd) => ({ cwd, real, folder: real.replace(/[^a-zA-Z0-9]/g, "-") });

  it("names the one checkout a folder has, and none for a folder two checkouts share", () => {
    expect([...uniqueByFolder([at("/w/a.b"), at("/w/a_b"), at("/w/app"), at("/w/app")])]).toEqual([["-w-app", "/w/app"]]);
    expect([...uniqueByFolder([])]).toEqual([]);
  });

  it("counts a link to a checkout and the checkout as one, naming the real path when the index has it", () => {
    expect([...uniqueByFolder([at("/w/link", "/w/app"), at("/w/app")])]).toEqual([["-w-app", "/w/app"]]);
    expect([...uniqueByFolder([at("/w/link", "/w/app"), at("/w/other-link", "/w/app")])]).toEqual([["-w-app", "/w/link"]]);
  });
});

describe("directoriesByFolder", () => {
  it("names a folder by the directory's real path, so a directory reached through a link is found", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-folders-"));
    dirs.push(root);
    const real = path.join(root, "real_app");
    mkdirSync(real);
    const link = path.join(root, "linked");
    symlinkSync(real, link);
    const found = await directoriesByFolder([link]);
    expect([...found]).toEqual([[encodeProjectDirName(realpathSync.native(real)), link]]);
    expect([...found.keys()][0]).not.toContain("_");
  });

  it("finds a checkout the index knows both by its path and through a link", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-folders-"));
    dirs.push(root);
    const real = path.join(root, "app");
    mkdirSync(real);
    const link = path.join(root, "alias");
    symlinkSync(real, link);
    const realPath = realpathSync.native(real);
    expect([...(await directoriesByFolder([link, realPath]))]).toEqual([[encodeProjectDirName(realPath), realPath]]);
  });

  it("names a directory that is gone by its absolute path, as it was named while it was there", async () => {
    const gone = path.join(tmpdir(), "mt-folders-gone", "my_app");
    expect([...(await directoriesByFolder([gone]))]).toEqual([[encodeProjectDirName(gone), gone]]);
  });

  it("leaves a folder unknown when two checkouts with different real paths share its name", async () => {
    const resolve = (absolute: string) => Promise.resolve(absolute.replace("first", "x.one").replace("second", "x_one"));
    expect([...(await directoriesByFolder(["/w/first", "/w/second"], resolve))]).toEqual([]);
  });

  it("resolves a directory once while the last answer is fresh, and again after", async () => {
    const asked: string[] = [];
    const resolve = (absolute: string) => (asked.push(absolute), Promise.resolve(absolute));
    await directoriesByFolder(["/w/app", "/w/app"], resolve, 1000);
    await directoriesByFolder(["/w/app"], resolve, 1000 + REALPATH_MEMO_MS - 1);
    expect(asked).toEqual(["/w/app"]);
    await directoriesByFolder(["/w/app"], resolve, 1000 + REALPATH_MEMO_MS);
    expect(asked).toEqual(["/w/app", "/w/app"]);
  });
});
