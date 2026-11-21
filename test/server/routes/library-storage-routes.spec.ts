// @vitest-environment node
// The Storage view's routes (#3333): GET only reads, the POST starts a measurement, the projects are
// matched to the index's directories, and `cleanupPeriodDays` is read from the settings file.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall } from "../../helpers/routeCall";
import { mountLibraryRoutes } from "../../../server/routes/library-routes";
import type { StorageState } from "../../../server/backends/library/storage-measurer";
import type { HomeMeasure } from "../../../server/backends/library/storage-home";
import { encodeProjectDirName } from "../../../server/session/project-dir";
import { isLibraryStorageAnswer } from "../../../common/libraryStorage";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const size = (bytes: number) => ({ bytes, files: 1, unreadable: 0 });
const MEASURE: HomeMeasure = {
  measuredAt: 1000,
  total: size(30),
  entries: [{ name: "projects", directory: true, ...size(30) }],
  projects: [
    { slug: encodeProjectDirName("/work/app"), ...size(20) },
    { slug: "-tmp-probe", ...size(10) },
  ],
};

function setup(options: { state?: StorageState; directories?: () => Promise<unknown> } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "mt-storage-routes-"));
  dirs.push(home);
  let measured = 0;
  const state = options.state ?? { measure: MEASURE, measuring: null };
  const app = express();
  app.use(express.json());
  mountLibraryRoutes(app, {
    call: (method) => (method === "directories" ? (options.directories?.() ?? Promise.resolve(["/work/app"])) : Promise.resolve(null)),
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
      cleanup: { state: "default", days: 30 },
      measure: {
        measuredAt: 1000,
        projects: [
          { slug: encodeProjectDirName("/work/app"), cwd: "/work/app", temporary: false },
          { slug: "-tmp-probe", cwd: null, temporary: true },
        ],
        otherProjects: { count: 0 },
      },
    });
    expect(measured()).toBe(0);
  });

  it("narrows the projects to the query", async () => {
    const { request } = setup();
    const answer = await request("/api/library/storage?q=probe");
    expect(answer.body).toMatchObject({ measure: { projects: [{ slug: "-tmp-probe" }] } });
  });

  it("answers null before the first measurement, with how far the running one is", async () => {
    const { request } = setup({ state: { measure: null, measuring: { done: 3, of: 9 } } });
    expect((await request("/api/library/storage")).body).toMatchObject({ measure: null, measuring: { done: 3, of: 9 } });
  });

  it("still answers the sizes when the index does not", async () => {
    const { request } = setup({ directories: () => Promise.reject(new Error("index down")) });
    const answer = await request("/api/library/storage");
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ measure: { projects: [{ cwd: null }, { cwd: null }] } });
  });

  it("reads cleanupPeriodDays from the settings file, and says when it cannot", async () => {
    const set = setup();
    writeFileSync(path.join(set.home, "settings.json"), JSON.stringify({ cleanupPeriodDays: 9 }));
    expect((await set.request("/api/library/storage")).body).toMatchObject({ cleanup: { state: "set", days: 9 } });
    const broken = setup();
    writeFileSync(path.join(broken.home, "settings.json"), "{ not json");
    expect((await broken.request("/api/library/storage")).body).toMatchObject({ cleanup: { state: "unreadable" } });
  });
});

describe("POST /api/library/storage/measure", () => {
  it("starts a measurement", async () => {
    const { request, measured } = setup({ state: { measure: null, measuring: { done: 0, of: 0 } } });
    const answer = await request("/api/library/storage/measure", { method: "POST" });
    expect(answer.status).toBe(202);
    expect(measured()).toBe(1);
  });
});
