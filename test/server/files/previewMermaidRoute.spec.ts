// @vitest-environment node
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";

/** The browse routes over one directory, as files-browse.spec.ts serves them. */
const serveProject = (dir: string) => {
  const app = express();
  app.use(express.json());
  mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
  return app;
};
const tmp = () => makeTempDir("mt-files-mermaid-");
// #2991. A mermaid fence is drawn by a second nonce'd script — a module, since it imports mermaid
// from this server — in the embeddable document only. The plain one runs nothing and gets nothing.
describe("GET /api/files/browse/md with a mermaid fence", () => {
  const DIAGRAM = "# d\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n```ts\nconst x = 1;\n```\n";
  const DARK = "bg=%231a1a2e&fg=%23e6e6f0&muted=%23aaaaaa&subtle=%23222222&border=%23333333&link=%234a8cff";
  const withMd = async (body: string, run: (call: ReturnType<typeof routeCall>, query: string) => Promise<void>) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.md"), body);
    try {
      await run(routeCall(serveProject(dir)), `cwd=${encodeURIComponent(dir)}&path=a.md`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const nonceOf = (csp: string | undefined): string => /nonce-([A-Za-z0-9_-]+)/.exec(csp ?? "")?.[1] ?? "";

  it("draws the fence beside a placeholder and appends a module script under the document's nonce", async () => {
    await withMd(DIAGRAM, async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}&embed=1`);
      const nonce = nonceOf(res.headers["content-security-policy"]);
      expect(nonce).not.toBe("");
      expect(res.text).toContain('<pre class="mermaid" data-mermaid-pending="1">graph TD\n  A--&gt;B</pre>');
      expect(res.text).toContain('<details class="mermaid-source" open>');
      expect(res.text).toContain(`<script type="module" nonce="${nonce}">`);
      expect(res.text).toContain("pre.mermaid[data-mermaid-pending]{display:none}");
      // The header, the reporter and the module script: the nonce is on both of our elements and nowhere else.
      expect(res.text.split(nonce)).toHaveLength(3);
      expect(res.headers["content-security-policy"]).toBe(`sandbox allow-scripts; script-src 'nonce-${nonce}'`);
    });
  });

  // The URL in the document must be one this app answers, with the header an opaque-origin module
  // fetch needs — or the diagram fails in the browser and nowhere else.
  it("imports mermaid from a route this server serves with a CORS header", async () => {
    await withMd(DIAGRAM, async (call, query) => {
      const doc = await call(`/api/files/browse/md?${query}&embed=1`);
      const entryUrl = /import mermaid from "([^"]+)"/.exec(doc.text)?.[1];
      expect(entryUrl).toMatch(/^\/api\/files\/mermaid\/[^/]+\/mermaid\.esm\.min\.mjs$/);
      const asset = await call(entryUrl ?? "");
      expect(asset.status).toBe(200);
      expect(asset.headers["access-control-allow-origin"]).toBe("*");
      expect(asset.text.startsWith("import")).toBe(true);
    });
  });

  it("tells mermaid the pane's theme, and asks the reader's when the pane sent none", async () => {
    await withMd(DIAGRAM, async (call, query) => {
      expect((await call(`/api/files/browse/md?${query}&embed=1&${DARK}`)).text).toContain('const theme = "dark"');
      expect((await call(`/api/files/browse/md?${query}&embed=1`)).text).toContain("const theme = null ??");
    });
  });

  it("keeps the plain document free of the placeholder, the disclosure and any script", async () => {
    await withMd(DIAGRAM, async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}`);
      expect(res.headers["content-security-policy"]).toBe("sandbox");
      expect(res.text).not.toContain("<script");
      expect(res.text).not.toContain("data-mermaid-pending");
      expect(res.text).not.toContain("mermaid-source");
      expect(res.text).toContain('<pre data-code-block="0"><code class="language-mermaid">graph TD');
    });
  });

  // The script is heavy for a document with nothing to draw, so a document without a fence gets none.
  it("appends no diagram script or style to a document without a mermaid fence", async () => {
    await withMd("# hi\n\n```ts\nconst x = 1;\n```\n", async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}&embed=1`);
      expect(res.text).not.toContain('type="module"');
      expect(res.text).not.toContain("mermaid.esm");
      expect(res.text).not.toContain("data-mermaid-pending");
      expect(res.text.split(nonceOf(res.headers["content-security-policy"]))).toHaveLength(2);
    });
  });
});
