// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initFileChangePublisher, publishFileChange } from "./fileChange.js";

let ws: string;
const captured: { channel: string; payload: unknown }[] = [];

beforeAll(() => {
  ws = mkdtempSync(path.join(tmpdir(), "mt-fc-"));
  for (const rel of ["artifacts/documents/2026/06/doc.md", "artifacts/html/2026/06/page.html", "artifacts/other/note.txt"]) {
    const abs = path.join(ws, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, "x");
  }
  // Minimal pubsub stub that records what gets published.
  const pubsub = { publish: (channel: string, payload: unknown) => captured.push({ channel, payload }) } as never;
  initFileChangePublisher({ workspace: ws, pubsub });
});

afterAll(() => rmSync(ws, { recursive: true, force: true }));

describe("file-change publisher wiring", () => {
  it("forwards a markdown doc to plugin:markdown:file:<path> with a real mtime", async () => {
    captured.length = 0;
    const rel = "artifacts/documents/2026/06/doc.md";
    await publishFileChange(rel);
    expect(captured).toHaveLength(1);
    expect(captured[0].channel).toBe(`plugin:markdown:file:${rel}`);
    const payload = captured[0].payload as { path: string; mtimeMs: number };
    expect(payload.path).toBe(rel);
    expect(payload.mtimeMs).toBeGreaterThan(0);
  });

  it("forwards an html page to plugin:html:file:<path>", async () => {
    captured.length = 0;
    const rel = "artifacts/html/2026/06/page.html";
    await publishFileChange(rel);
    expect(captured.map((c) => c.channel)).toEqual([`plugin:html:file:${rel}`]);
  });

  it("does not publish for a path matching no plugin scope", async () => {
    captured.length = 0;
    await publishFileChange("artifacts/other/note.txt");
    expect(captured).toHaveLength(0);
  });

  it("drops a path that escapes the workspace (no publish)", async () => {
    captured.length = 0;
    await publishFileChange("../escape.md");
    await publishFileChange("../../etc/passwd");
    expect(captured).toHaveLength(0);
  });
});
