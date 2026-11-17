// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import fs, { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { makeTempDir } from "../../support/tempDir.js";
import { swappableProject } from "../../support/swappableProject.js";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountFilesTreeRoutes } from "../../../server/files/files-tree-routes";

// #3306 for a rename and a move to the Trash: `docs` is swapped for a link out just before the move,
// after the containment check has answered. The move then acts on the OUTSIDE entry of the same name;
// it cannot be stopped, but it must not be reported as done.
const layout = () => {
  const project = swappableProject();
  writeFileSync(path.join(project.outside, "a.md"), "outside");
  const trash = realpathSync(makeTempDir("mt-move-trash-"));
  const app = express();
  app.use(express.json());
  mountFilesTreeRoutes(app, { base: () => project.root, trash: () => ({ kind: "mac", files: trash }) });
  const post = (route: string, body: unknown) =>
    routeCall(app)(`/api/files/browse/${route}?cwd=${encodeURIComponent(project.root)}&path=docs/a.md`, jsonPost(body));
  return { ...project, trash, post };
};

const swapAtFirstRename = (swap: () => void) => {
  const rename = fs.renameSync;
  const swapped = { done: false };
  vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
    if (!swapped.done) {
      swapped.done = true;
      swap();
    }
    return rename(...args);
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a folder swapped for a link out between the check and the move", () => {
  it("rename answers 403 when what it renamed was the outside entry", async () => {
    const { outside, swapOut, post, cleanup } = layout();
    swapAtFirstRename(swapOut);
    expect((await post("rename", { name: "b.md" })).status).toBe(403);
    expect(readFileSync(path.join(outside, "b.md"), "utf8")).toBe("outside");
    cleanup();
  });

  // The entry is identified before the move, so a swap undone right after it, before the re-check, is
  // caught too: the check then names the inside folder, which does not hold the entry that moved.
  it.each(["rename", "trash"])("%s answers 403 even when the swap is undone before the check is asked again", async (route) => {
    const { swapOut, swapBack, post, cleanup } = layout();
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementationOnce((...args: Parameters<typeof fs.renameSync>) => {
      swapOut();
      rename(...args);
      swapBack();
    });
    expect((await post(route, { name: "b.md" })).status).toBe(403);
    cleanup();
  });

  it("the Trash answers 403 when what it moved was the outside entry", async () => {
    const { trash, swapOut, post, cleanup } = layout();
    swapAtFirstRename(swapOut);
    expect((await post("trash", {})).status).toBe(403);
    expect(readFileSync(path.join(trash, "a.md"), "utf8")).toBe("outside");
    cleanup();
  });

  // Swapped before the entry is identified, so what is identified is the outside entry: only the check
  // asked again after the move, while the swap is still in place, can tell.
  it("the Trash answers 403 when the swap came before the entry was identified", async () => {
    const { swapOut, post, cleanup } = layout();
    const mkdir = fs.mkdirSync;
    vi.spyOn(fs, "mkdirSync").mockImplementationOnce((...args: Parameters<typeof fs.mkdirSync>) => {
      swapOut();
      return mkdir(...args);
    });
    expect((await post("trash", {})).status).toBe(403);
    cleanup();
  });

  it("rename and the Trash still work when nothing moves", async () => {
    const { root, trash, post, cleanup } = layout();
    mkdirSync(path.join(root, "docs", "sub"));
    expect((await post("rename", { name: "b.md" })).body).toEqual({ ok: true, path: "docs/b.md" });
    expect(readFileSync(path.join(root, "docs", "b.md"), "utf8")).toBe("inside");
    writeFileSync(path.join(root, "docs", "a.md"), "again");
    expect((await post("trash", {})).status).toBe(200);
    expect(readFileSync(path.join(trash, "a.md"), "utf8")).toBe("again");
    cleanup();
  });
});
