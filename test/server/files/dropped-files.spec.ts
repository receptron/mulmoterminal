// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeDropName, admitDroppedFile, saveDroppedFile, sweepOldDrops, MAX_DROP_BYTES, MAX_DROP_DATAURL_CHARS, DROP_RETENTION_DAYS } from "../../../server/files/dropped-files.js";

const pngUrl = (payload = "aGVsbG8=") => `data:image/png;base64,${payload}`;

describe("safeDropName", () => {
  it("keeps an ordinary name", () => {
    expect(safeDropName("Screenshot-2026.png", "image/png")).toBe("Screenshot-2026.png");
  });

  // The name is joined onto a directory we chose, so anything structural has to go.
  it("cannot climb out of the staging directory", () => {
    expect(safeDropName("../../etc/passwd", "text/plain")).toBe("passwd");
    expect(safeDropName("/etc/passwd", "text/plain")).toBe("passwd");
    expect(safeDropName("..\\..\\win.ini", "text/plain")).toBe("win.ini");
  });

  it("replaces characters that would need quoting in a shell", () => {
    expect(safeDropName("my file 'v2'.png", "image/png")).toBe("my-file--v2-.png");
  });

  it("drops a leading dot so the staged file is not hidden", () => {
    expect(safeDropName(".bashrc", "text/plain")).toBe("bashrc");
  });

  it("drops a leading dash, which would read as a flag", () => {
    expect(safeDropName("-rf.png", "image/png")).toBe("rf.png");
  });

  it("caps the length", () => {
    expect(safeDropName(`${"a".repeat(200)}.png`, "image/png")).toHaveLength(80);
  });

  // A pasted screenshot carries no name at all — the type is the only clue we can give.
  it("synthesizes a name from the mime type when there is none", () => {
    expect(safeDropName("", "image/png")).toBe("pasted.png");
    expect(safeDropName(undefined, "image/jpeg")).toBe("pasted.jpg");
    expect(safeDropName(null, "application/pdf")).toBe("pasted.pdf");
  });

  it("synthesizes a bare name for a type it has no extension for", () => {
    expect(safeDropName("", "application/x-thing")).toBe("pasted");
  });
});

describe("admitDroppedFile", () => {
  it("admits a base64 data URL and derives the name", () => {
    const out = admitDroppedFile(pngUrl(), "shot.png");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.name).toBe("shot.png");
      expect(out.parts.mimeType).toBe("image/png");
    }
  });

  it("refuses a missing or non-string dataUrl", () => {
    for (const bad of [undefined, null, "", 42, {}]) {
      const out = admitDroppedFile(bad, "x.png");
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(400);
    }
  });

  it("refuses something that is not a base64 data URL", () => {
    const out = admitDroppedFile("https://example.com/x.png", "x.png");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(400);
  });

  // Ordering matters: the raw cap runs BEFORE decoding, so an oversized payload is refused
  // without first being expanded into memory.
  it("refuses an oversized payload before decoding it", () => {
    const out = admitDroppedFile(`data:image/png;base64,${"a".repeat(MAX_DROP_DATAURL_CHARS + 1)}`, "x.png");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(413);
  });

  it("refuses a payload whose decoded size exceeds the cap", () => {
    // Under the pre-decode char cap, over the decoded byte cap.
    const chars = Math.ceil(((MAX_DROP_BYTES + 1024) * 4) / 3);
    const out = admitDroppedFile(`data:image/png;base64,${"a".repeat(chars)}`, "x.png");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(413);
  });
});

describe("saveDroppedFile / sweepOldDrops", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mt-drops-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const admit = (name: string, payload = "aGVsbG8=") => {
    const out = admitDroppedFile(pngUrl(payload), name);
    if (!out.ok) throw new Error("fixture should admit");
    return out;
  };

  it("writes the bytes and returns the path", () => {
    const file = saveDroppedFile(admit("shot.png"), new Date("2026-07-26T10:00:00Z"), root);
    expect(fs.readFileSync(file, "utf8")).toBe("hello");
    expect(path.basename(file)).toBe("shot.png");
    expect(file.startsWith(root)).toBe(true);
  });

  it("files it under the date, so the sweep can find it later", () => {
    const file = saveDroppedFile(admit("shot.png"), new Date("2026-07-26T10:00:00Z"), root);
    expect(path.relative(root, file).split(path.sep)[0]).toBe("2026-07-26");
  });

  // The name is preserved for the reader; the random parent is what keeps two same-named
  // screenshots from overwriting each other.
  it("keeps two identically named files apart", () => {
    const now = new Date("2026-07-26T10:00:00Z");
    const a = saveDroppedFile(admit("shot.png", "YQ=="), now, root);
    const b = saveDroppedFile(admit("shot.png", "Yg=="), now, root);
    expect(a).not.toBe(b);
    expect(fs.readFileSync(a, "utf8")).toBe("a");
    expect(fs.readFileSync(b, "utf8")).toBe("b");
  });

  it("deletes staged directories past the retention window and keeps the rest", () => {
    const now = new Date("2026-07-26T10:00:00Z");
    const old = new Date(now.getTime() - (DROP_RETENTION_DAYS + 2) * 24 * 60 * 60 * 1000);
    const stale = saveDroppedFile(admit("old.png"), old, root);
    const fresh = saveDroppedFile(admit("new.png"), now, root);
    sweepOldDrops(now, root);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  // Only names this module creates are subject to the rule — anything else a user put there
  // was never covered by the retention window.
  it("leaves entries that are not date directories alone", () => {
    fs.writeFileSync(path.join(root, "notes.txt"), "keep me");
    fs.mkdirSync(path.join(root, "my-stuff"));
    sweepOldDrops(new Date("2036-01-01T00:00:00Z"), root);
    expect(fs.existsSync(path.join(root, "notes.txt"))).toBe(true);
    expect(fs.existsSync(path.join(root, "my-stuff"))).toBe(true);
  });

  it("does nothing when nothing has been staged yet", () => {
    expect(() => sweepOldDrops(new Date(), path.join(root, "absent"))).not.toThrow();
  });
});
