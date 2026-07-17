// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { initCollectionsBackend } from "../../../server/backends/collections";
import { createThumbnailResolver, clearThumbnailCache } from "../../../server/backends/thumbnailStore";

// A stub resize so the test needs no native sharp binary — echoes a marker
// derived from the input so we can assert the pipeline ran.
const stubResize = async (input: Buffer, maxEdge: number) => Buffer.from(`RESIZED:${maxEdge}:${input.length}`);

describe("thumbnail resolver", () => {
  const resolve = createThumbnailResolver(stubResize);
  let ws = "";

  beforeAll(() => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-thumb-"));
    mkdirSync(path.join(ws, "data"), { recursive: true });
    writeFileSync(path.join(ws, "data", "pic.png"), Buffer.from([1, 2, 3, 4]));
    // Sets the workspace root the resolver reads via getWorkspaceRoot().
    initCollectionsBackend({ workspace: ws });
  });

  it("resolves a workspace image to a JPEG data URL", async () => {
    clearThumbnailCache();
    const url = await resolve("data/pic.png", 512);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    const base64 = (url ?? "").split(",")[1];
    expect(Buffer.from(base64, "base64").toString()).toBe("RESIZED:512:4");
  });

  it("returns null for a missing file, an escaping path, and empty input", async () => {
    expect(await resolve("data/nope.png", 512)).toBeNull();
    expect(await resolve("../outside.png", 512)).toBeNull();
    expect(await resolve("", 512)).toBeNull();
  });

  it("refuses a symlink under the workspace that points OUTSIDE it (no exfiltration)", async () => {
    // A file outside the workspace, and a symlink under it that targets the file.
    const outside = mkdtempSync(path.join(tmpdir(), "mt-outside-"));
    const secret = path.join(outside, "secret.png");
    writeFileSync(secret, Buffer.from([9, 9, 9, 9]));
    symlinkSync(secret, path.join(ws, "data", "link.png"));
    // Lexically "data/link.png" is contained; the real target escapes → null.
    expect(await resolve("data/link.png", 512)).toBeNull();
  });

  it("caches by (path, mtime, maxEdge) so a repeated page doesn't re-decode", async () => {
    clearThumbnailCache();
    let calls = 0;
    const counting = createThumbnailResolver(async (_buf, edge) => {
      calls += 1;
      return Buffer.from(`X:${edge}`);
    });
    await counting("data/pic.png", 256);
    await counting("data/pic.png", 256);
    expect(calls).toBe(1);
  });
});
