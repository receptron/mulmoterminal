// @vitest-environment node
// POST /api/library/memory/:slug/tidy (#3334): a Claude session in plan mode, in the project's
// directory from the index, running the skill on that memory folder — refused from another origin,
// for a name that is not a folder name, a project with no memory, or a directory not on this machine.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall } from "../../helpers/routeCall";
import { mountLibraryRoutes } from "../../../server/routes/library-routes";
import { encodeProjectDirName } from "../../../server/session/project-dir";
import { forgetResolvedFolders } from "../../../server/backends/library/project-folders";

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  forgetResolvedFolders();
});

function setup(options: { allowed?: boolean; withMemory?: boolean; projectHere?: boolean; name?: string; alsoIndexed?: string[] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mt-tidy-"));
  dirs.push(root);
  const project = path.join(root, "work", options.name ?? "app");
  if (options.projectHere !== false) mkdirSync(project, { recursive: true });
  (options.alsoIndexed ?? []).forEach((name) => mkdirSync(path.join(root, "work", name), { recursive: true }));
  const projectsRoot = path.join(root, "projects");
  const slug = encodeProjectDirName(existsSync(project) ? realpathSync.native(project) : project);
  if (options.withMemory !== false) mkdirSync(path.join(projectsRoot, slug, "memory"), { recursive: true });
  const spawned: unknown[][] = [];
  const app = express();
  app.use(express.json());
  mountLibraryRoutes(app, {
    projectsRoot,
    call: (method) =>
      Promise.resolve(
        method === "directories" ? ["/somewhere/else", project, ...(options.alsoIndexed ?? []).map((name) => path.join(root, "work", name))] : null,
      ),
    promote: {
      spawnSession: (...args) => (spawned.push(args), Promise.resolve({ sessionId: "new-session", agent: "claude", seedRuns: true })),
      isAllowedOrigin: () => options.allowed !== false,
    },
  });
  const post = (name: string) =>
    routeCall(app)(`/api/library/memory/${encodeURIComponent(name)}/tidy`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return { post, spawned, slug, project };
}

describe("POST /api/library/memory/:slug/tidy", () => {
  it("starts the skill on the folder in plan mode, in the project's directory", async () => {
    const { post, spawned, slug, project } = setup();
    const answer = await post(slug);
    expect([answer.status, answer.body]).toEqual([200, { chatId: "new-session", agent: "claude" }]);
    expect(spawned).toEqual([["claude", project, `/mulmoterminal-library tidy ${slug}`, true, null, { claudePermissionMode: "plan" }]]);
  });

  it("refuses another origin, a name that is not a folder name, and a project with no memory", async () => {
    const refused = setup({ allowed: false });
    expect((await refused.post(refused.slug)).status).toBe(403);
    const { post, spawned } = setup();
    expect((await post("a b")).status).toBe(400);
    expect((await post("a.b")).status).toBe(400);
    const none = setup({ withMemory: false });
    expect((await none.post(none.slug)).status).toBe(404);
    expect([...spawned, ...refused.spawned, ...none.spawned]).toEqual([]);
  });

  it("finds a directory whose name has a character Claude Code's folder name folds", async () => {
    const { post, spawned, slug, project } = setup({ name: "my_app" });
    expect(slug.endsWith("my-app")).toBe(true);
    expect((await post(slug)).status).toBe(200);
    expect(spawned[0]?.[1]).toBe(project);
  });

  it("refuses when two directories the index knows share the folder's name", async () => {
    const { post, spawned, slug } = setup({ name: "a_b", alsoIndexed: ["a-b"] });
    expect((await post(slug)).status).toBe(409);
    expect(spawned).toEqual([]);
  });

  it("refuses when the project's directory is not on this machine", async () => {
    const { post, spawned, slug } = setup({ projectHere: false });
    expect((await post(slug)).status).toBe(409);
    expect(spawned).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("refuses a link repointed elsewhere while its last answer is still kept", async () => {
    const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "mt-tidy-link-")));
    dirs.push(root);
    const [app, other, link] = ["app", "other", "current"].map((name) => path.join(root, name));
    [app, other].forEach((dir) => mkdirSync(dir));
    symlinkSync(app, link);
    const slug = encodeProjectDirName(app);
    const projectsRoot = path.join(root, "projects");
    mkdirSync(path.join(projectsRoot, slug, "memory"), { recursive: true });
    const spawned: unknown[][] = [];
    const server = express();
    server.use(express.json());
    mountLibraryRoutes(server, {
      projectsRoot,
      call: (method) => Promise.resolve(method === "directories" ? [link] : null),
      promote: {
        spawnSession: (...args) => (spawned.push(args), Promise.resolve({ sessionId: "s", agent: "claude", seedRuns: true })),
        isAllowedOrigin: () => true,
      },
    });
    const post = () => routeCall(server)(`/api/library/memory/${slug}/tidy`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await post()).status).toBe(200);
    unlinkSync(link);
    symlinkSync(other, link);
    expect((await post()).status).toBe(409);
    expect(spawned.map((args) => args[1])).toEqual([link]);
  });
});
