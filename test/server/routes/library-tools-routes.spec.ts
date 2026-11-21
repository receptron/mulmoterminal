// @vitest-environment node
// The Library's tools routes (#3332): a directory only when a conversation ran there, a file only when
// that directory's listing names it.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall } from "../../helpers/routeCall";
import { mountLibraryRoutes } from "../../../server/routes/library-routes";
import { isLibraryInstructions } from "../../../common/libraryTools";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "mt-tools-routes-"));
  dirs.push(root);
  const app = path.join(root, "w", "app");
  mkdirSync(path.join(app, ".claude"), { recursive: true });
  writeFileSync(path.join(app, "CLAUDE.md"), "project rules\n@notes.md\n");
  writeFileSync(path.join(app, "notes.md"), "imported\n");
  writeFileSync(path.join(app, "secret.txt"), "not an instruction");
  const known = [app, path.join(root, "w", "other")];
  const server = express();
  mountLibraryRoutes(server, {
    call: (method) => Promise.resolve(method === "directories" ? known : null),
    tools: { configDir: path.join(root, "h", ".claude"), home: path.join(root, "h") },
  });
  return { call: routeCall(server), app, root };
}

const q = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

describe("library tools routes", () => {
  it("lists the directories conversations ran in, in name order", async () => {
    const { call, app, root } = setup();
    expect((await call("/api/library/tools/directories")).body).toEqual({
      directories: [app, path.join(root, "w", "other")].sort((a, b) => a.localeCompare(b)),
    });
  });

  it("lists a known directory's instruction files and reads one of them", async () => {
    const { call, app } = setup();
    writeFileSync(path.join(app, "CLAUDE.local.md"), "imported\n");
    const listed = await call(`/api/library/tools/instructions${q({ cwd: app })}`);
    expect(listed.status).toBe(200);
    if (!isLibraryInstructions(listed.body)) throw new Error("not instructions");
    const mine = listed.body.files.filter((file) => file.path.startsWith(app)).map((file) => `${file.scope} ${path.basename(file.path)}`);
    expect(mine).toEqual(["directory CLAUDE.md", "import notes.md", "local CLAUDE.local.md"]);
    expect((await call(`/api/library/tools/instruction${q({ cwd: app, path: path.join(app, "CLAUDE.local.md") })}`)).body).toEqual({ text: "imported\n" });
  });

  it.skipIf(process.platform === "win32")("reads an instruction file through a link, as Claude Code does", async () => {
    const { call, app } = setup();
    symlinkSync(path.join(app, "notes.md"), path.join(app, "CLAUDE.local.md"));
    expect((await call(`/api/library/tools/instruction${q({ cwd: app, path: path.join(app, "CLAUDE.local.md") })}`)).body).toEqual({ text: "imported\n" });
  });

  it("refuses a directory no conversation ran in, and a file the listing does not name", async () => {
    const { call, app, root } = setup();
    expect((await call(`/api/library/tools/instructions${q({ cwd: root })}`)).status).toBe(404);
    expect((await call("/api/library/tools/instructions")).status).toBe(400);
    expect((await call(`/api/library/tools/instruction${q({ cwd: app, path: path.join(app, "secret.txt") })}`)).status).toBe(404);
    expect((await call(`/api/library/tools/instruction${q({ cwd: root, path: path.join(app, "CLAUDE.md") })}`)).status).toBe(404);
  });
});
