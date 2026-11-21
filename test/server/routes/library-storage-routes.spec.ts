// @vitest-environment node
// The Storage view's routes (#3333): GET only reads, the POST starts a measurement, the projects are
// matched to the index's directories, and `cleanupPeriodDays` is read from the settings file.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall } from "../../helpers/routeCall";
import { mountLibraryRoutes } from "../../../server/routes/library-routes";
import type { StorageState } from "../../../server/backends/library/storage-measurer";
import type { HomeMeasure } from "../../../server/backends/library/storage-home";
import { claudeProjectPath, encodeProjectDirName } from "../../../server/session/project-dir";
import { isLibraryStorageAnswer } from "../../../common/libraryStorage";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const size = (bytes: number) => ({ bytes, files: 1, unreadable: 0 });
/** A temp project's folder as Claude Code names it on this platform (macOS's /tmp is /private/tmp). */
const TEMP_SLUG = `${encodeProjectDirName(claudeProjectPath("/tmp"))}-probe`;
const MEASURE: HomeMeasure = {
  measuredAt: 1000,
  total: size(30),
  entries: [{ name: "projects", directory: true, ...size(30) }],
  projects: [
    { slug: encodeProjectDirName("/work/app"), ...size(20) },
    { slug: TEMP_SLUG, ...size(10) },
  ],
};

function setup(options: { state?: StorageState; directories?: () => Promise<unknown>; asked?: string[] } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "mt-storage-routes-"));
  dirs.push(home);
  let measured = 0;
  const state: StorageState = options.state ?? { measure: MEASURE, measuring: null, failed: false };
  const app = express();
  app.use(express.json());
  mountLibraryRoutes(app, {
    call: (method) => {
      options.asked?.push(method);
      return method === "directories" ? (options.directories?.() ?? Promise.resolve(["/work/app"])) : Promise.resolve(null);
    },
    storage: { home, measurer: { measure: () => (measured += 1), state: () => state } },
  });
  const request = routeCall(app);
  return { home, request, measured: () => measured };
}

describe("GET /api/library/storage", () => {
  it("answers the last measurement with its projects matched, and starts nothing", async () => {
    const { home, request, measured } = setup();
    const answer = await request("/api/library/storage");
    expect(answer.status).toBe(200);
    expect(isLibraryStorageAnswer(answer.body)).toBe(true);
    expect(answer.body).toMatchObject({
      root: home,
      measuring: null,
      measureFailed: false,
      cleanup: { state: "default", days: 30 },
      measure: {
        measuredAt: 1000,
        projects: [
          { slug: encodeProjectDirName("/work/app"), cwd: "/work/app", temporary: false },
          { slug: TEMP_SLUG, cwd: null, temporary: true },
        ],
        otherProjects: { count: 0 },
      },
    });
    expect(measured()).toBe(0);
  });

  it("narrows the projects to the query", async () => {
    const { request } = setup();
    const answer = await request("/api/library/storage?q=probe");
    expect(answer.body).toMatchObject({ measure: { projects: [{ slug: TEMP_SLUG }] } });
  });

  it("answers null before the first measurement, with how far the running one is", async () => {
    const { request } = setup({ state: { measure: null, measuring: { done: 3, of: 9 }, failed: false } });
    expect((await request("/api/library/storage")).body).toMatchObject({ measure: null, measuring: { done: 3, of: 9 } });
  });

  it("says the last measurement failed, keeping the older one", async () => {
    const { request } = setup({ state: { measure: MEASURE, measuring: null, failed: true } });
    expect((await request("/api/library/storage")).body).toMatchObject({ measureFailed: true, measure: { measuredAt: 1000 } });
  });

  it("still answers the sizes when the index does not", async () => {
    const { request } = setup({ directories: () => Promise.reject(new Error("index down")) });
    const answer = await request("/api/library/storage");
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ measure: { projects: [{ cwd: null }, { cwd: null }] } });
  });

  it("matches a directory reached through a link by its real path, as Claude Code names the folder", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "mt-storage-real-"));
    dirs.push(outside);
    const real = path.join(outside, "real");
    mkdirSync(real);
    const link = path.join(outside, "link");
    symlinkSync(real, link);
    const measure: HomeMeasure = { ...MEASURE, measuredAt: 2000, projects: [{ slug: encodeProjectDirName(realpathSync.native(real)), ...size(5) }] };
    const { request } = setup({ state: { measure, measuring: null, failed: false }, directories: () => Promise.resolve([link]) });
    expect(encodeProjectDirName(link)).not.toBe(encodeProjectDirName(claudeProjectPath(link)));
    expect((await request("/api/library/storage")).body).toMatchObject({ measure: { projects: [{ cwd: link }] } });
  });

  it("asks the index once per measurement, and again after one it could not answer", async () => {
    const asked: string[] = [];
    let state: StorageState = { measure: MEASURE, measuring: null, failed: false };
    let fail = true;
    const home = mkdtempSync(path.join(tmpdir(), "mt-storage-cache-"));
    dirs.push(home);
    const app = express();
    mountLibraryRoutes(app, {
      call: (method) => (asked.push(method), fail ? Promise.reject(new Error("down")) : Promise.resolve(["/work/app"])),
      storage: { home, measurer: { measure: () => {}, state: () => state } },
    });
    const request = routeCall(app);
    expect((await request("/api/library/storage")).body).toMatchObject({ measure: { projects: [{ cwd: null }, { cwd: null }] } });
    fail = false;
    await request("/api/library/storage");
    await request("/api/library/storage?q=app");
    expect(asked).toEqual(["directories", "directories"]);
    state = { ...state, measure: { ...MEASURE, measuredAt: 3000 } };
    await request("/api/library/storage");
    expect(asked).toHaveLength(3);
  });

  it("reads cleanupPeriodDays from the settings file, and says when it cannot", async () => {
    const set = setup();
    writeFileSync(path.join(set.home, "settings.json"), JSON.stringify({ cleanupPeriodDays: 9 }));
    expect((await set.request("/api/library/storage")).body).toMatchObject({ cleanup: { state: "set", days: 9 } });
    const broken = setup();
    writeFileSync(path.join(broken.home, "settings.json"), "{ not json");
    expect((await broken.request("/api/library/storage")).body).toMatchObject({ cleanup: { state: "unreadable" } });
    const folder = setup();
    mkdirSync(path.join(folder.home, "settings.json"));
    expect((await folder.request("/api/library/storage")).body).toMatchObject({ cleanup: { state: "unreadable" } });
  });

  it("reads a settings file up to the bound and not a byte past it", async () => {
    const BOUND = 1024 * 1024;
    const json = '{"cleanupPeriodDays":5}';
    const atBound = setup();
    writeFileSync(path.join(atBound.home, "settings.json"), json + " ".repeat(BOUND - json.length));
    expect((await atBound.request("/api/library/storage")).body).toMatchObject({ cleanup: { state: "set", days: 5 } });
    const past = setup();
    writeFileSync(path.join(past.home, "settings.json"), json + " ".repeat(BOUND - json.length + 1));
    expect((await past.request("/api/library/storage")).body).toMatchObject({ cleanup: { state: "unreadable" } });
  });

  it("follows a settings file that is a link, as Claude Code does", async () => {
    const linked = setup();
    const target = path.join(linked.home, "dotfiles-settings.json");
    writeFileSync(target, JSON.stringify({ cleanupPeriodDays: 21 }));
    symlinkSync(target, path.join(linked.home, "settings.json"));
    expect((await linked.request("/api/library/storage")).body).toMatchObject({ cleanup: { state: "set", days: 21 } });
  });
});

describe("POST /api/library/storage/measure", () => {
  it("starts a measurement", async () => {
    const { request, measured } = setup({ state: { measure: null, measuring: { done: 0, of: 0 }, failed: false } });
    const answer = await request("/api/library/storage/measure", { method: "POST" });
    expect(answer.status).toBe(202);
    expect(measured()).toBe(1);
  });
});
