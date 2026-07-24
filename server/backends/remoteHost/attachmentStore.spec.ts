// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSaveAttachment } from "./attachmentStore.js";

describe("createSaveAttachment", () => {
  let ws = "";
  afterEach(() => ws && rmSync(ws, { recursive: true, force: true }));

  it("saves base64 bytes under data/attachments/YYYY/MM and returns the workspace-relative path", async () => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-att-"));
    const fixed = new Date(Date.UTC(2026, 6, 5)); // → 2026/07
    const save = createSaveAttachment(ws, () => fixed);
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

    const saved = await save(bytes.toString("base64"), "image/png");

    expect(saved.mimeType).toBe("image/png");
    // Regression (#746): a full UUID (8-4-4-4-12 hex), not an 8-hex prefix — rename()
    // overwrites on a name clash, and 32 bits collides at realistic upload counts.
    expect(saved.relativePath).toMatch(/^data\/attachments\/2026\/07\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/);
    const abs = path.join(ws, saved.relativePath);
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs).equals(bytes)).toBe(true);
  });

  it("gives two saves in the same partition distinct filenames (no silent overwrite)", async () => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-att-"));
    const fixed = new Date(Date.UTC(2026, 6, 5));
    const save = createSaveAttachment(ws, () => fixed);
    const a = await save(Buffer.from("aaa").toString("base64"), "image/png");
    const b = await save(Buffer.from("bbb").toString("base64"), "image/png");
    expect(a.relativePath).not.toBe(b.relativePath);
    expect(readFileSync(path.join(ws, a.relativePath)).toString()).toBe("aaa");
    expect(readFileSync(path.join(ws, b.relativePath)).toString()).toBe("bbb");
  });

  it("falls back to .bin for an unmapped mime", async () => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-att-"));
    const save = createSaveAttachment(ws);
    const saved = await save(Buffer.from("x").toString("base64"), "application/x-unknown");
    expect(saved.relativePath.endsWith(".bin")).toBe(true);
  });
});
