import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { containedPath, realContainedWithin, resolveBase, listEntries, mdToHtmlDoc } from "../../server/../server/files-browse";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-files-"));

describe("containedPath (write/read containment)", () => {
  const base = "/proj/root";
  it("resolves a relative path within the base", () => {
    expect(containedPath(base, "docs/a.md")).toBe(path.resolve(base, "docs/a.md"));
    expect(containedPath(base, "")).toBe(path.resolve(base)); // the root itself
  });
  it("rejects traversal and absolute escapes", () => {
    expect(containedPath(base, "../secret")).toBeNull();
    expect(containedPath(base, "docs/../../etc/passwd")).toBeNull();
    expect(containedPath(base, "/etc/passwd")).toBeNull();
  });
  it("does not treat a sibling with the same prefix as contained", () => {
    expect(containedPath("/proj/root", "../root-evil/x")).toBeNull();
  });
});

describe("realContainedWithin (symlink-safe containment)", () => {
  it("accepts a real path inside the project (existing and new)", () => {
    const root = realpathSync(tmp());
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "docs", "a.md"), "x");
    expect(realContainedWithin(root, path.join(root, "docs", "a.md"))).toBe(path.join(root, "docs", "a.md")); // existing
    expect(realContainedWithin(root, path.join(root, "docs", "new.md"))).toBe(path.join(root, "docs", "new.md")); // not-yet-created write target
    rmSync(root, { recursive: true, force: true });
  });
  it("rejects a symlink inside the project that points outside it (read AND write escape)", () => {
    const root = realpathSync(tmp());
    const outside = realpathSync(tmp());
    writeFileSync(path.join(outside, "secret.txt"), "s");
    symlinkSync(outside, path.join(root, "link")); // link -> outside dir
    // lexical containment passes (no `..`), but the real path escapes:
    expect(containedPath(root, "link/secret.txt")).not.toBeNull();
    expect(realContainedWithin(root, path.join(root, "link", "secret.txt"))).toBeNull(); // read escape blocked
    expect(realContainedWithin(root, path.join(root, "link", "new.txt"))).toBeNull(); // write escape blocked
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("resolveBase", () => {
  it("uses an absolute existing dir, else the default", () => {
    const dir = tmp();
    expect(resolveBase(dir, "/default")).toBe(dir);
    expect(resolveBase("relative/x", "/default")).toBe("/default");
    expect(resolveBase(null, "/default")).toBe("/default");
    expect(resolveBase(path.join(dir, "missing"), "/default")).toBe("/default");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("listEntries", () => {
  it("lists directories first, then files, each alphabetical, with sizes", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "zsub"));
    mkdirSync(path.join(dir, "asub"));
    writeFileSync(path.join(dir, "b.txt"), "hello");
    writeFileSync(path.join(dir, "a.md"), "# hi");
    const entries = listEntries(dir);
    expect(entries.map((e) => e.name)).toEqual(["asub", "zsub", "a.md", "b.txt"]);
    expect(entries.find((e) => e.name === "b.txt")).toMatchObject({ dir: false, size: 5 });
    expect(entries.find((e) => e.name === "asub")).toMatchObject({ dir: true });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mdToHtmlDoc", () => {
  it("wraps body HTML and escapes the title", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a<b>.md");
    expect(doc).toContain("<p>x</p>");
    expect(doc).toContain("<title>a&lt;b&gt;.md</title>");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
  });
});
