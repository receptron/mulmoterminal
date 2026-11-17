// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import fs, { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { swappableProject } from "../../support/swappableProject.js";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";

// #3306 for the reads that have no descriptor to compare: a folder listing, a file as HEAD has it, and
// the content search. `docs` is swapped for a link out while the route reads, after its check answered.
const SECRET = "outside-secret";

// `git` is wrapped so a swap can land just before the route's git runs.
const gitHook = vi.hoisted(() => ({ before: (): void => {}, after: (): void => {} }));
vi.mock("../../../server/git/worktrees.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../server/git/worktrees.js")>();
  return {
    ...real,
    git: async (...args: Parameters<typeof real.git>) => {
      gitHook.before();
      const result = await real.git(...args);
      gitHook.after();
      return result;
    },
  };
});

const GIT = "/usr/bin/git";
const commitAll = (dir: string) => {
  execFileSync(GIT, ["init", "-q"], { cwd: dir });
  execFileSync(GIT, ["add", "-A"], { cwd: dir });
  execFileSync(GIT, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: dir });
};

const layout = () => {
  const project = swappableProject();
  writeFileSync(path.join(project.outside, "a.md"), SECRET);
  writeFileSync(path.join(project.outside, `${SECRET}.md`), SECRET);
  const app = express();
  mountFilesBrowseRoutes(app, { defaultCwd: project.root, backupRoot: path.join(project.root, ".backups") });
  const get = (route: string, query: string) => routeCall(app)(`/api/files/browse/${route}?cwd=${encodeURIComponent(project.root)}&${query}`);
  return { ...project, get };
};

afterEach(() => {
  vi.restoreAllMocks();
  gitHook.before = () => {};
  gitHook.after = () => {};
});

describe("a folder swapped for a link out while the route reads it", () => {
  it("/browse/list answers 403 and none of the outside names", async () => {
    const { swapOut, get, cleanup } = layout();
    const readdir = fs.readdirSync;
    vi.spyOn(fs, "readdirSync").mockImplementationOnce((...args: Parameters<typeof fs.readdirSync>) => {
      swapOut();
      return readdir(...args);
    });
    const res = await get("list", "path=docs");
    expect(res.status).toBe(403);
    expect(res.text).not.toContain(SECRET);
    cleanup();
  });

  it.skipIf(process.platform === "win32")("/browse/head answers 403 and none of the other repository's file", async () => {
    const { root, outside, swapOut, get, cleanup } = layout();
    commitAll(root);
    commitAll(outside);
    gitHook.before = swapOut;
    const res = await get("head", "path=docs/a.md");
    expect(res.status).toBe(403);
    expect(res.text).not.toContain(SECRET);
    cleanup();
  });

  // The known limit, pinned so a stronger check shows up as a change here: a swap undone right after the
  // read is not seen. Identifying the folder first would not see it either — renaming it back brings
  // back the very same folder.
  it("/browse/list is passed by a swap undone before the check is asked again (documented limit)", async () => {
    const { swapOut, swapBack, get, cleanup } = layout();
    const readdir = fs.readdirSync;
    vi.spyOn(fs, "readdirSync").mockImplementationOnce((...args: Parameters<typeof fs.readdirSync>) => {
      swapOut();
      const listed = readdir(...args);
      swapBack();
      return listed;
    });
    expect((await get("list", "path=docs")).text).toContain(SECRET);
    cleanup();
  });

  it.skipIf(process.platform === "win32")("/browse/head is passed by a swap undone before the check is asked again (documented limit)", async () => {
    const { root, outside, swapOut, swapBack, get, cleanup } = layout();
    commitAll(root);
    commitAll(outside);
    gitHook.before = swapOut;
    gitHook.after = swapBack;
    expect((await get("head", "path=docs/a.md")).text).toContain(SECRET);
    cleanup();
  });

  it.skipIf(process.platform === "win32")("list and head still answer when nothing moves", async () => {
    const { root, get, cleanup } = layout();
    commitAll(root);
    expect((await get("list", "path=docs")).body).toMatchObject({ entries: [{ name: "a.md" }] });
    expect((await get("head", "path=docs/a.md")).body).toEqual({ text: "inside" });
    cleanup();
  });
});

// git never follows a link in a search, in either mode, so a link inside the project — or a folder
// swapped for one while git walks — does not bring an outside file into the results. Pinned here
// because the search has no check of its own to fall back on.
describe("/browse/search does not follow links out", () => {
  it.skipIf(process.platform === "win32").each(["plain folder", "repository"])("in a %s", async (kind) => {
    const { root, outside, get, cleanup } = layout();
    mkdirSync(path.join(outside, "sub"));
    writeFileSync(path.join(outside, "sub", "deep.md"), SECRET);
    writeFileSync(path.join(root, "docs", "in.md"), SECRET);
    symlinkSync(path.join(outside, "a.md"), path.join(root, "filelink.md"));
    symlinkSync(path.join(outside, "sub"), path.join(root, "dirlink"));
    if (kind === "repository") commitAll(root);
    const res = await get("search", `q=${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("docs/in.md");
    expect(res.text).not.toContain("filelink");
    expect(res.text).not.toContain("dirlink");
    cleanup();
  });
});
