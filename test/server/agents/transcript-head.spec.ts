// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFirstLine, cleanTitle, parseJsonRecord } from "../../../server/agents/transcript-head.js";

describe("readFirstLine", () => {
  let dir: string;
  const write = (name: string, body: string): string => {
    const file = path.join(dir, name);
    writeFileSync(file, body);
    return file;
  };
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-first-line-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the first line without its newline", async () => {
    expect(await readFirstLine(write("a.jsonl", "one\ntwo\nthree\n"), 1024, 4096)).toEqual({ text: "one", terminated: true });
  });

  // The reason this helper exists: codex writes ~20KB of session_meta on line 1, and a probe sized
  // for the common case must not answer null for a longer one (#1777).
  it("grows past the probe when the line is longer than it", async () => {
    const long = "x".repeat(5000);
    expect(await readFirstLine(write("b.jsonl", `${long}\nnext\n`), 64, 64 * 1024)).toEqual({ text: long, terminated: true });
  });

  // Both review bots caught this on #1782: `head.length` counts UTF-16 code units, so a filled
  // 32KB buffer of Japanese looks like a short complete file. The truncated line parses as nothing
  // and the caller memoises that null, so the session leaves the listing until the process restarts.
  it("grows past the probe for a multibyte line, rather than reading a filled buffer as EOF", async () => {
    const line = "\u3042".repeat(20000); // 60000 bytes, 20000 UTF-16 units
    expect(Buffer.byteLength(line, "utf8")).toBeGreaterThan(32 * 1024);
    expect(line.length).toBeLessThan(32 * 1024);
    expect(await readFirstLine(write("mb.jsonl", `${line}\nnext\n`), 32 * 1024, 1024 * 1024)).toEqual({ text: line, terminated: true });
  });

  it("returns null for a multibyte line that exceeds the ceiling too", async () => {
    const line = "\u3042".repeat(20000);
    expect(await readFirstLine(write("mb-over.jsonl", `${line}\n`), 1024, 4096)).toBeNull();
  });

  it("returns a multibyte whole file that has no trailing newline", async () => {
    const body = "\u3042".repeat(20000);
    expect(await readFirstLine(write("mb-eof.jsonl", body), 32 * 1024, 1024 * 1024)).toEqual({ text: body, terminated: false });
  });

  it("returns null when the first line exceeds the ceiling too", async () => {
    expect(await readFirstLine(write("c.jsonl", `${"x".repeat(5000)}\n`), 64, 128)).toBeNull();
  });

  // Codex on #1782: a complete unterminated line whose byte size is EXACTLY the ceiling fills the
  // buffer without a short read, so a `bytesRead < size` test called it absent.
  it("returns a whole unterminated file whose size is exactly maxBytes", async () => {
    const body = "y".repeat(128);
    expect(await readFirstLine(write("exact.jsonl", body), 64, 128)).toEqual({ text: body, terminated: false });
  });

  it("returns a whole unterminated file whose size is exactly the probe", async () => {
    const body = "z".repeat(64);
    expect(await readFirstLine(write("exact-probe.jsonl", body), 64, 4096)).toEqual({ text: body, terminated: false });
  });

  // One byte past the ceiling is genuinely unreadable, and must stay null rather than truncate.
  it("returns null for an unterminated file one byte past maxBytes", async () => {
    expect(await readFirstLine(write("over.jsonl", "y".repeat(129)), 64, 128)).toBeNull();
  });

  it("returns a whole file that has no trailing newline", async () => {
    expect(await readFirstLine(write("d.jsonl", "only"), 1024, 4096)).toEqual({ text: "only", terminated: false });
  });

  // The caller memoises, and must not memoise a line the writer may still be extending.
  it("reports whether a newline actually ended the line", async () => {
    expect(await readFirstLine(write("term.jsonl", "done\nrest\n"), 1024, 4096)).toEqual({ text: "done", terminated: true });
    expect(await readFirstLine(write("open.jsonl", '{"half":'), 1024, 4096)).toEqual({ text: '{"half":', terminated: false });
  });

  it("returns null for an empty file", async () => {
    expect(await readFirstLine(write("e.jsonl", ""), 1024, 4096)).toBeNull();
  });

  it("returns an empty string for a file that starts with a newline", async () => {
    expect(await readFirstLine(write("f.jsonl", "\nsecond\n"), 1024, 4096)).toEqual({ text: "", terminated: true });
  });

  it("returns null for a missing file", async () => {
    expect(await readFirstLine(path.join(dir, "nope.jsonl"), 1024, 4096)).toBeNull();
  });

  it("returns null for a directory", async () => {
    expect(await readFirstLine(dir, 1024, 4096)).toBeNull();
  });

  it("still reads when the ceiling is below the probe", async () => {
    expect(await readFirstLine(write("g.jsonl", "short\nrest\n"), 4096, 16)).toEqual({ text: "short", terminated: true });
  });
});

describe("cleanTitle", () => {
  it("collapses whitespace, trims, and caps at 60 characters", () => {
    expect(cleanTitle("  a\n\tb  ", "fb")).toBe("a b");
    expect(cleanTitle("z".repeat(100), "fb")).toHaveLength(60);
  });
  it.each([null, "", "   ", "\n\t"])("falls back for %j", (raw) => {
    expect(cleanTitle(raw, "fb")).toBe("fb");
  });
});

describe("parseJsonRecord", () => {
  it("parses an object row", () => {
    expect(parseJsonRecord('{"a":1}')).toEqual({ a: 1 });
  });
  it.each(["", "not json", "{trunc", "[1,2]", '"str"', "42", "null"])("returns null for %j", (line) => {
    expect(parseJsonRecord(line)).toBeNull();
  });
});
