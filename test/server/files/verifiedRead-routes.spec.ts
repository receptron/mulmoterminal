// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import fs, { readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { swappableProject } from "../../support/swappableProject.js";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";
import { mountFilesRoutes } from "../../../server/backends/files/files";
import { mountFilesPageRoute } from "../../../server/backends/files/filesPage";
import { filesPageUrl } from "../../../common/filesPage";
import { createThumbnailResolver } from "../../../server/backends/collections/thumbnailStore";

// #3306, the read side. `docs` is swapped for a link out at the last moment — just before the route
// opens the file to READ it, after its containment check has answered. None of the outside bytes may
// come back, by any route.
const SECRET = "outside secret";
// A fenced block, so `/code-block` has one to answer with.
const fenced = (text: string) => ["```", text, "```", ""].join("\n");

const layout = () => {
  const project = swappableProject();
  writeFileSync(path.join(project.root, "docs", "a.md"), fenced("inside"));
  writeFileSync(path.join(project.root, "docs", "a.html"), "<p>inside</p>");
  writeFileSync(path.join(project.outside, "a.md"), fenced(SECRET));
  writeFileSync(path.join(project.outside, "a.html"), `<p>${SECRET}</p>`);
  return project;
};

// Numeric flags as the verified read passes them, and "r" / none as `readFileSync` and a read stream
// do, so the same swap lands on the code before the fix too.
const opensForReading = (flags: unknown): boolean =>
  flags === undefined || flags === "r" || (typeof flags === "number" && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0);

const swapOutOnFirstReadOpen = (root: string, outside: string) => {
  const swapOut = () => {
    renameSync(path.join(root, "docs"), path.join(root, "docs-aside"));
    symlinkSync(outside, path.join(root, "docs"));
  };
  const swapped = { done: false };
  const swapOnce = (flags: unknown) => {
    if (swapped.done || !opensForReading(flags)) return;
    swapped.done = true;
    swapOut();
  };
  const open = fs.openSync;
  vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => {
    swapOnce(args[1]);
    return open(...args);
  });
  const openWithCallback = fs.open;
  vi.spyOn(fs, "open").mockImplementation((...args: Parameters<typeof fs.open>) => {
    swapOnce(typeof args[1] === "function" ? undefined : args[1]);
    return openWithCallback(...args);
  });
  const openHandle = fs.promises.open;
  vi.spyOn(fs.promises, "open").mockImplementation((...args: Parameters<typeof fs.promises.open>) => {
    swapOnce(args[1]);
    return openHandle(...args);
  });
};

const serve = (root: string) => {
  const app = express();
  app.use(express.json());
  mountFilesBrowseRoutes(app, { defaultCwd: root, backupRoot: path.join(root, ".backups") });
  mountFilesRoutes(app, { workspace: root, sessionCwds: () => [] });
  mountFilesPageRoute(app, { workspace: root, sessionCwds: () => [] });
  return app;
};

const filesUnder = (dir: string): string[] =>
  fs.existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => path.join(d.parentPath, d.name))
    : [];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a folder swapped for a link out between the check and the read", () => {
  const browse = (route: string) => (root: string) => `/api/files/${route}?cwd=${encodeURIComponent(root)}&path=docs/a.md&line=1&index=0`;
  const readRoutes = [
    ...["browse/text", "browse/md", "browse/json", "browse/table", "browse/lines", "browse/code-block", "raw"].map((route) => ({
      route,
      url: browse(route),
      shows: "inside",
    })),
    // The version is a hash of the bytes, so it is the hash that would leak.
    { route: "browse/version", url: browse("browse/version"), shows: createHash("sha256").update(fenced("inside")).digest("hex").slice(0, 16) },
    { route: "page", url: (root: string) => filesPageUrl(root, "docs/a.html"), shows: "inside" },
  ];

  it.each(readRoutes)("$route answers 403 and none of the outside file", async ({ url }) => {
    const { root, outside, cleanup } = layout();
    swapOutOnFirstReadOpen(root, outside);
    const res = await routeCall(serve(root))(url(root));
    expect(res.status).toBe(403);
    expect(res.text).not.toContain(SECRET);
    cleanup();
  });

  it.each(readRoutes)("$route still reads the file when nothing moves", async ({ url, shows }) => {
    const { root, cleanup } = layout();
    const res = await routeCall(serve(root))(url(root));
    expect(res.status).toBe(200);
    expect(res.text).toContain(shows);
    cleanup();
  });

  // The write route reads the file before writing it, for its text check, its version and its backup.
  // A backup of the outside file would be served back by `GET /browse/backup` under the inside name.
  it("/browse/write answers 403 and banks no backup of the outside file", async () => {
    const { root, outside, cleanup } = layout();
    const version = (await routeCall(serve(root))(`/api/files/browse/version?cwd=${encodeURIComponent(root)}&path=docs/a.md`)).body.version;
    swapOutOnFirstReadOpen(root, outside);
    const res = await routeCall(serve(root))(`/api/files/browse/write?cwd=${encodeURIComponent(root)}&path=docs/a.md`, {
      ...jsonPost({ text: "redirected", baseVersion: version }),
      method: "PUT",
    });
    expect(res.status).toBe(403);
    expect(readFileSync(path.join(outside, "a.md"), "utf8")).toBe(fenced(SECRET));
    expect(filesUnder(path.join(root, ".backups")).map((file) => readFileSync(file, "utf8"))).not.toContain(SECRET);
    cleanup();
  });

  it("a thumbnail is not made from the outside file", async () => {
    const { root, outside, cleanup } = layout();
    const echo = async (input: Buffer) => input;
    const resolve = createThumbnailResolver(echo, () => root);
    swapOutOnFirstReadOpen(root, outside);
    expect(await resolve("docs/a.md", 64)).toBeNull();
    expect(await createThumbnailResolver(echo, () => root)("docs-aside/a.md", 64)).toMatch(/^data:image\/jpeg;base64,/);
    cleanup();
  });
});
