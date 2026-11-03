// @vitest-environment node
// The json route as the Files pane's Preview uses it (#3137). Its own file: files-browse.spec.ts is at
// the line limit.
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";

const tmp = () => makeTempDir("mt-files-json-");

const serveProject = (dir: string) => {
  const app = express();
  mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
  return app;
};

describe("GET /api/files/browse/json — the app's theme", () => {
  const THEME = "bg=%231a1a2e&fg=%23e6e6f0&muted=%23a0a0b8&subtle=%23232342&border=%2333335a&link=%234a8cff";
  const serve = async (extra: string) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.json"), '{"a":1}');
    try {
      return await routeCall(serveProject(dir))(`/api/files/browse/json?cwd=${encodeURIComponent(dir)}&path=a.json${extra}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // The pane says `embed=1` (#3238): its document stays the bare one under the bare sandbox.
  it("paints the indented JSON in the theme it was given, still under the sandbox", async () => {
    const res = await serve(`&embed=1&${THEME}`);
    expect(res.text).toContain("background:#1a1a2e");
    expect(res.text).toContain("{\n  &quot;a&quot;: 1\n}");
    expect(res.headers["content-security-policy"]).toBe("sandbox");
    expect(res.text).not.toContain("<script");
  });

  it("leaves JSON with no theme on the system colours", async () => {
    expect((await serve("&embed=1")).text).not.toContain("background:#1a1a2e");
  });
});

// The tab a clicked `.json` opens (#3238): the same indented rendering, the file as it is beside it,
// and the toolbar that switches between them and copies either — under the nonce'd policy.
describe("GET /api/files/browse/json — the tab", () => {
  const serve = async (headers: Record<string, string> = {}) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.json"), '{"a":1}');
    try {
      return await routeCall(serveProject(dir))(`/api/files/browse/json?cwd=${encodeURIComponent(dir)}&path=a.json`, { headers });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("carries the toolbar, the rendering and the source under the policy that runs the toolbar", async () => {
    const res = await serve();
    const csp = res.headers["content-security-policy"] ?? "";
    expect(csp).toMatch(/^sandbox allow-scripts; script-src 'nonce-[A-Za-z0-9_-]+'$/);
    const nonce = /nonce-([A-Za-z0-9_-]+)/.exec(csp)?.[1] ?? "";
    expect(res.text).toContain(`<script nonce="${nonce}">`);
    expect(res.text.split('<script nonce="')).toHaveLength(2);
    expect(res.text.split('<script type="application/json"')).toHaveLength(2);
    expect(res.text).toContain('<div id="tab-rendered"><pre><code>{\n  &quot;a&quot;: 1\n}</code></pre></div>');
    expect(res.text).toContain('<pre id="tab-source" hidden><code>{&quot;a&quot;:1}</code></pre>');
    expect(res.text).toContain('<button type="button" data-show="rendered" aria-pressed="true">Formatted</button>');
    expect(res.text).toContain('<button type="button" data-copy="rendered">Copy formatted</button>');
  });

  it("labels the toolbar in the language the request asks for", async () => {
    expect((await serve({ "Accept-Language": "zh-TW" })).text).toContain(">複製原始文字</button>");
  });
});
