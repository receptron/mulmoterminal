// @vitest-environment node
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";

const serveProject = (dir: string) => {
  const app = express();
  app.use(express.json());
  mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
  return app;
};

// #3017. Both Markdown documents carry the typeset maths: it is SVG, so even the plain one (a new tab,
// running nothing) shows it. Nothing about the sandbox changes.
describe("GET /api/files/browse/md with maths", () => {
  const DOC = "# m\n\nInline $a^2+b^2$.\n\n```ts\nconst x = 1;\n```\n";
  const withMd = async (run: (call: ReturnType<typeof routeCall>, query: string) => Promise<void>) => {
    const dir = makeTempDir("mt-files-math-");
    writeFileSync(path.join(dir, "a.md"), DOC);
    try {
      await run(routeCall(serveProject(dir)), `cwd=${encodeURIComponent(dir)}&path=a.md`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it.each([
    ["the embeddable document", "&embed=1"],
    ["the plain document", ""],
  ])("typesets the formula in %s, with the style that hides its MathML copy", async (_doc, extra) => {
    await withMd(async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}${extra}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<span class="math"><mjx-container');
      expect(res.text).toContain("mjx-assistive-mml{position:absolute");
      // The tab shows the source as it is beside the rendering (#3238), so only the rendering is judged.
      expect(res.text.split('<div id="tab-rendered">').pop()).not.toContain("$a^2+b^2$");
    });
  });

  it("keeps the code block numbered for the copy button, and the sandbox as it was", async () => {
    await withMd(async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}&embed=1`);
      expect(res.text).toMatch(/data-code-block="0"/);
      expect(res.headers["content-security-policy"]).toMatch(/^sandbox allow-scripts; script-src 'nonce-[A-Za-z0-9_-]+'$/);
    });
  });
});
