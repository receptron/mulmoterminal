// @vitest-environment node
// The HOST BINDING for presentDocument's `path` form: markdownHostApp.loadDoc /
// saveDoc go through @mulmoclaude/core/files' by-path ops (backends/openPath.ts)
// rather than the old artifacts/documents-only gate. The rules themselves (which
// values resolve, why write never creates) are core's and are tested in MulmoClaude —
// what's asserted here is that MulmoTerminal reaches them, with its workspace.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetFileChangePublisher } from "@mulmoclaude/core/file-change";
import { initFileChangePublisher } from "../../../server/backends/fileChange.js";
import { initMarkdownBackend, markdownHostApp } from "../../../server/backends/markdown.js";
import { initOpenPathBackend, resetOpenPathBackend } from "../../../server/backends/openPath.js";
import { absolutizePresentPath } from "../../../server/backends/presentPathRoot.js";

let ws: string;
let published: { channel: string; data: unknown }[] = [];
const tempDirs: string[] = [];

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), "mt-openpath-"));
  tempDirs.push(ws);
  published = [];
  resetOpenPathBackend();
  initOpenPathBackend({ workspace: ws });
  initMarkdownBackend({ workspace: ws });
  initFileChangePublisher({ workspace: ws, pubsub: { publish: (channel, data) => published.push({ channel, data }) } });
});

afterEach(() => {
  resetFileChangePublisher();
  resetOpenPathBackend();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seed(rel: string, body: string): string {
  const abs = path.join(ws, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

describe("markdownHostApp over by-path files", () => {
  it("loads a repo document outside artifacts/documents", async () => {
    seed("README.md", "# Hello");
    expect((await markdownHostApp.loadDoc("README.md")).content).toBe("# Hello");
  });

  it("saves back to that same file — no copy under artifacts/", async () => {
    seed("README.md", "# Hello");
    const result = await markdownHostApp.saveDoc("README.md", "# Edited");
    expect(result.path).toBe("README.md");
    expect(readFileSync(path.join(ws, "README.md"), "utf8")).toBe("# Edited");
    expect(existsSync(path.join(ws, "artifacts"))).toBe(false);
  });

  it("publishes the save on the channel the View subscribes to", async () => {
    seed("docs/design.md", "x");
    await markdownHostApp.saveDoc("docs/design.md", "y");
    expect(published.map((p) => p.channel)).toContain("plugin:markdown:file:docs/design.md");
  });

  it("loads and saves an ABSOLUTE path", async () => {
    const abs = seed("notes/todo.md", "a");
    expect((await markdownHostApp.loadDoc(abs)).content).toBe("a");
    await markdownHostApp.saveDoc(abs, "b");
    expect(readFileSync(abs, "utf8")).toBe("b");
  });

  it("refuses to CREATE — a save to a path that doesn't exist is a bug, not a save", async () => {
    await expect(markdownHostApp.saveDoc("brand-new.md", "x")).rejects.toThrow();
    expect(existsSync(path.join(ws, "brand-new.md"))).toBe(false);
  });

  it("refuses a non-markdown path", async () => {
    seed("secrets.env", "TOKEN=1");
    await expect(markdownHostApp.loadDoc("secrets.env")).rejects.toThrow();
  });

  it("refuses a traversal segment", async () => {
    await expect(markdownHostApp.loadDoc("../outside.md")).rejects.toThrow();
  });

  // The point of the whole boundary rewrite: `README.md` from a cell running in another
  // project must reach THAT project's file, and the user's edit must go back to it —
  // not to the same-named file sitting in the workspace.
  it("opens the SESSION's README, not the workspace's, once the path is absolutized", async () => {
    seed("README.md", "# workspace");
    const project = mkdtempSync(path.join(tmpdir(), "mt-project-"));
    tempDirs.push(project);
    writeFileSync(path.join(project, "README.md"), "# project");

    const args = absolutizePresentPath({ title: "R", path: "README.md" }, project, [".md"]) as { path: string };
    expect((await markdownHostApp.loadDoc(args.path)).content).toBe("# project");
    await markdownHostApp.saveDoc(args.path, "# edited");
    expect(readFileSync(path.join(project, "README.md"), "utf8")).toBe("# edited");
    expect(readFileSync(path.join(ws, "README.md"), "utf8")).toBe("# workspace");
  });

  it("still writes NEW documents under artifacts/documents", async () => {
    const { path: rel } = await markdownHostApp.saveNewDoc("Design Review", "# New");
    expect(rel).toMatch(/^artifacts\/documents\/\d{4}\/\d{2}\/design-review-[a-f0-9]{8}\.md$/);
    expect(readFileSync(path.join(ws, rel), "utf8")).toBe("# New");
  });
});
