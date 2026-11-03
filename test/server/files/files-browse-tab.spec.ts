// @vitest-environment node
// The documents a clicked path opens in a tab of its own (#3238): the rendering with the toolbar that
// switches to the file's source and copies either, under the policy that runs that one script and
// nothing from the file. Its own file: files-browse.spec.ts is at the line limit.
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";

const tmp = () => makeTempDir("mt-files-tab-");

const serveProject = (dir: string) => {
  const app = express();
  mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
  return app;
};

/** The tab's policy: the embeddable document's, since the tab runs one script of its own. */
const TAB_POLICY = /^sandbox allow-scripts; script-src 'nonce-[A-Za-z0-9_-]+'$/;
const nonceOf = (csp: string): string => /nonce-([A-Za-z0-9_-]+)/.exec(csp)?.[1] ?? "";
/** What the tab's document renders, without the toolbar before it and the source after it. */
const renderingOf = (html: string): string => /<div id="tab-rendered">([\s\S]*)<\/div><script nonce=/.exec(html)?.[1] ?? "";

const HOSTILE = '# title\n\n<script>document.title = "ran"</script>\n\n<img src=x onerror="document.title = \'ran\'">\n';
const withMd = async (body: string, run: (call: ReturnType<typeof routeCall>, query: string) => Promise<void>) => {
  const dir = tmp();
  writeFileSync(path.join(dir, "a.md"), body);
  try {
    await run(routeCall(serveProject(dir)), `cwd=${encodeURIComponent(dir)}&path=a.md`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("GET /api/files/browse/md — the tab", () => {
  // The new tab a clicked `.md` in terminal output opens (#3238). Its containment is the sandbox
  // with one script admitted by nonce — the toolbar's — and the file's own still carry none.
  it("serves the tab's document under the policy that runs its toolbar and nothing of the file's", async () => {
    await withMd(HOSTILE, async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}`);
      const csp = res.headers["content-security-policy"] ?? "";
      expect(csp).toMatch(TAB_POLICY);
      expect(csp).not.toContain("allow-same-origin");
      const nonce = nonceOf(csp);
      expect(res.text).toContain(`<script nonce="${nonce}">`);
      expect(res.text.split("<script")).toHaveLength(3); // ours, and the file's in the rendering
      expect(res.text).toContain('<script>document.title = "ran"</script>');
      expect(res.text.split(nonce)).toHaveLength(2);
      expect(res.text).toContain('data-copy="source"');
    });
  });

  // The opt-in has to be the exact value, or the pane's document is handed to a parameter nobody
  // wrote: anything but it is a tab.
  it.each([["embed=0"], ["embed=true"], ["embed="], ["embedded=1"]])("serves the tab's document for ?%s", async (param) => {
    await withMd("# hi\n", async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}&${param}`);
      expect(res.headers["content-security-policy"]).toMatch(TAB_POLICY);
      expect(res.text).toContain('data-copy="source"');
      expect(res.text).not.toContain("mulmoterminal-md-preview");
    });
  });

  it("labels the toolbar in the language the request asks for", async () => {
    await withMd("# hi\n", async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}`, { headers: { "Accept-Language": "ja,en;q=0.5" } });
      expect(res.text).toContain(">ソースをコピー</button>");
      expect((await call(`/api/files/browse/md?${query}`)).text).toContain(">Copy source</button>");
    });
  });

  // Raw HTML can close the rendering's wrapper; the shell's own elements still come first, so the
  // script's positional contract holds (test/src/renderedTabToolsDom.spec.ts has the parsed shape).
  it("puts its own elements before anything the file could plant", async () => {
    await withMd('# t\n\n</div><pre id="tab-source"><code>attacker</code></pre>\n', async (call, query) => {
      const text = (await call(`/api/files/browse/md?${query}`)).text;
      const at = (part: string) => text.indexOf(part);
      expect(at('<div class="tab-tools"')).toBeLessThan(at('<pre id="tab-source" hidden>'));
      expect(at('<pre id="tab-source" hidden>')).toBeLessThan(at('<div id="tab-rendered">'));
      // the file's tag as marked passes it through — the escaped copy in the source comes earlier
      expect(at('<div id="tab-rendered">')).toBeLessThan(at('<pre id="tab-source"><code>attacker'));
    });
  });

  it("shows the file as it is beside the rendering", async () => {
    await withMd(HOSTILE, async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}`);
      expect(res.text).toContain('<pre id="tab-source" hidden><code># title\n\n&lt;script&gt;document.title = &quot;ran&quot;&lt;/script&gt;');
    });
  });

  // The embeddable document and the tab's are one rendering in two shells — not two renderings
  // with their own rules. A difference here is a difference the reader sees between the two views.
  it("renders the same rendering as the tab's", async () => {
    await withMd("# hi\n\n[x](y)\n", async (call, query) => {
      const tab = await call(`/api/files/browse/md?${query}`);
      const embedded = await call(`/api/files/browse/md?${query}&embed=1`);
      const paneBody = /<body>([\s\S]*)<script nonce=/.exec(embedded.text)?.[1];
      expect(paneBody).toBeTruthy();
      expect(renderingOf(tab.text)).toBe(paneBody);
    });
  });
});

describe("GET /api/files/browse/table — the tab", () => {
  const serve = async (extra: string) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "rows.csv"), "a,b\n1,2\n");
    try {
      return await routeCall(serveProject(dir))(`/api/files/browse/table?cwd=${encodeURIComponent(dir)}&path=rows.csv${extra}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("gives a tab the table with the toolbar, calling the rendering a table", async () => {
    const res = await serve("");
    expect(res.headers["content-security-policy"]).toMatch(TAB_POLICY);
    expect(res.text).toContain('<button type="button" data-copy="rendered">Copy table</button>');
    expect(res.text).toContain('<pre id="tab-source" hidden><code>a,b\n1,2\n</code></pre>');
    expect(res.text).toContain("<th>a</th>");
  });
});
