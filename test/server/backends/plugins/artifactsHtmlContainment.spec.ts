// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import fs, { mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appRequest } from "../../../helpers/appRequest.js";
import { mountHtmlPreviewRoute } from "../../../../server/backends/plugins/html.js";
import { makeTempDir } from "../../../support/tempDir";

// #3310: /artifacts/html is contained to that folder through links too. A link out — to a file of any
// type, or to a folder — answers as a missing page, and so does a folder swapped for one after the check.
const SECRET = "outside secret";

const layout = () => {
  const top = realpathSync(makeTempDir("mt-artifacts-html-"));
  const ws = path.join(top, "ws");
  const pages = path.join(ws, "artifacts", "html");
  const outside = path.join(top, "outside");
  mkdirSync(path.join(pages, "sub"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(pages, "sub", "page.html"), "<p>inside</p>");
  writeFileSync(path.join(outside, "notes.txt"), SECRET);
  writeFileSync(path.join(outside, "page.html"), `<p>${SECRET}</p>`);
  const app = express();
  mountHtmlPreviewRoute(app, { workspace: ws });
  return { pages, outside, request: appRequest(app), cleanup: () => rmSync(top, { recursive: true, force: true }) };
};

const bodyOf = async (res: Response) => ({ status: res.status, text: await res.text() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/artifacts/html containment", () => {
  it("serves a page inside, and a link inside that stays inside", async () => {
    const { pages, request, cleanup } = layout();
    symlinkSync(path.join(pages, "sub", "page.html"), path.join(pages, "alias.html"));
    expect(await bodyOf(await request("/artifacts/html/sub/page.html"))).toEqual({ status: 200, text: "<p>inside</p>" });
    expect(await bodyOf(await request("/artifacts/html/alias.html"))).toEqual({ status: 200, text: "<p>inside</p>" });
    cleanup();
  });

  it("answers 404 for a link named .html to an outside file of another type", async () => {
    const { pages, outside, request, cleanup } = layout();
    symlinkSync(path.join(outside, "notes.txt"), path.join(pages, "link.html"));
    const res = await bodyOf(await request("/artifacts/html/link.html"));
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(SECRET);
    cleanup();
  });

  it("answers 404 for a page reached through a folder link out", async () => {
    const { pages, outside, request, cleanup } = layout();
    symlinkSync(outside, path.join(pages, "out"));
    const res = await bodyOf(await request("/artifacts/html/out/page.html"));
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(SECRET);
    cleanup();
  });

  it("answers 404 for a folder named like a page", async () => {
    const { pages, request, cleanup } = layout();
    mkdirSync(path.join(pages, "folder.html"));
    expect((await request("/artifacts/html/folder.html")).status).toBe(404);
    cleanup();
  });

  // Before the open, the open lands outside; after it, the open file is inside but the folder no longer
  // holds it. Both are refused by the check made once the handle is open.
  it.each(["before", "after"] as const)("answers 404 when the folder is swapped for a link out %s the open", async (when) => {
    const { pages, outside, request, cleanup } = layout();
    const swapOut = () => {
      renameSync(path.join(pages, "sub"), path.join(pages, "sub-aside"));
      symlinkSync(outside, path.join(pages, "sub"));
    };
    const open = fs.promises.open;
    const swapped = { done: false };
    vi.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof open>) => {
      if (swapped.done) return open(...args);
      swapped.done = true;
      if (when === "before") swapOut();
      const handle = await open(...args);
      if (when === "after") swapOut();
      return handle;
    });
    const res = await bodyOf(await request("/artifacts/html/sub/page.html"));
    expect(swapped.done).toBe(true);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(SECRET);
    cleanup();
  });
});
