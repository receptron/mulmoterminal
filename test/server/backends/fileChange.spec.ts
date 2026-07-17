// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs.js";
import { tmpdir } from "node:os.js";
import path from "node:path.js";
import { resetFileChangePublisher } from "@mulmoclaude/core/file-change.js";
import { initFileChangePublisher, publishFileChange } from "../../../server/backends/fileChange.js";

// Capture every pubsub publish the binding makes.
interface Published {
  channel: string;
  data: unknown;
}
let published: Published[] = [];
let workspace: string;
const tempDirs: string[] = [];

function seedFile(rel: string, body = "x"): void {
  const abs = path.join(workspace, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "mt-fc-"));
  tempDirs.push(workspace);
  published = [];
  initFileChangePublisher({
    workspace,
    pubsub: { publish: (channel, data) => published.push({ channel, data }) },
  });
});

afterEach(() => {
  resetFileChangePublisher();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("initFileChangePublisher", () => {
  it("forwards a markdown doc to the markdown plugin channel with its mtime", async () => {
    const rel = "artifacts/documents/2026/06/note-abc123.md";
    seedFile(rel);

    await publishFileChange(rel);

    expect(published).toHaveLength(1);
    expect(published[0].channel).toBe(`plugin:markdown:file:${rel}`);
    const payload = published[0].data as { path: string; mtimeMs: number };
    expect(payload.path).toBe(rel);
    expect(typeof payload.mtimeMs).toBe("number");
  });

  it("forwards an html artifact to the html plugin channel", async () => {
    const rel = "artifacts/html/2026/06/page.html";
    seedFile(rel);

    await publishFileChange(rel);

    expect(published).toHaveLength(1);
    expect(published[0].channel).toBe(`plugin:html:file:${rel}`);
  });

  it("does not publish for a path that matches no scope", async () => {
    const rel = "artifacts/other/data.txt";
    seedFile(rel);

    await publishFileChange(rel);

    expect(published).toHaveLength(0);
  });

  it("drops a path that escapes the workspace", async () => {
    await publishFileChange("../escape.md");

    expect(published).toHaveLength(0);
  });
});
