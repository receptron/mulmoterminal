// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveBase, containedPath, mdToHtmlDoc } from "./files-browse";

const EXISTING_DIR = process.cwd(); // an absolute, existing directory
const DEFAULT = "/default-workspace-fallback";

describe("resolveBase", () => {
  it("returns an absolute, existing directory as-is", () => {
    expect(resolveBase(EXISTING_DIR, DEFAULT)).toBe(EXISTING_DIR);
  });
  it("falls back to the default for null / relative / missing dirs", () => {
    expect(resolveBase(null, DEFAULT)).toBe(DEFAULT);
    expect(resolveBase("relative/path", DEFAULT)).toBe(DEFAULT);
    expect(resolveBase("/no/such/dir/xyz-123", DEFAULT)).toBe(DEFAULT);
  });
});

describe("containedPath", () => {
  const base = "/home/me/proj";
  it("resolves a relative path under the base", () => {
    expect(containedPath(base, "src/App.vue")).toBe(path.resolve(base, "src/App.vue"));
  });
  it("returns the root itself for an empty path", () => {
    expect(containedPath(base, "")).toBe(path.resolve(base));
  });
  it("rejects traversal and absolute escapes", () => {
    expect(containedPath(base, "../secret")).toBeNull();
    expect(containedPath(base, "/etc/passwd")).toBeNull();
  });
  it("does not treat a sibling prefix as contained", () => {
    expect(containedPath("/home/me/proj", "../proj-evil/x")).toBeNull();
  });
});

describe("mdToHtmlDoc", () => {
  it("wraps the body and escapes the title", () => {
    const doc = mdToHtmlDoc("<h1>Hi</h1>", "a<b>&c");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("<h1>Hi</h1>");
    expect(doc).toContain("<title>a&lt;b&gt;&amp;c</title>");
  });
});
