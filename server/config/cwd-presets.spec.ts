import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizePresets, loadPresets, savePresets } from "./cwd-presets";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-presets-"));

describe("sanitizePresets", () => {
  it("keeps valid {label,path}, trims, and drops incomplete/junk rows", () => {
    expect(sanitizePresets([{ label: " a ", path: " /a " }, { label: "", path: "/b" }, { label: "c", path: "" }, { nope: 1 }, "x"])).toEqual([
      { label: "a", path: "/a" },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(sanitizePresets(null)).toEqual([]);
    expect(sanitizePresets({ cwdPresets: [] })).toEqual([]);
  });

  it("caps the count", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ label: `l${i}`, path: `/p${i}` }));
    expect(sanitizePresets(many, 50)).toHaveLength(50);
  });
});

describe("savePresets / loadPresets", () => {
  it("round-trips through a file", () => {
    const dir = tmp();
    const file = path.join(dir, "nested", "config.json"); // nested → mkdir is exercised
    expect(savePresets(file, [{ label: "x", path: "/x" }])).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ cwdPresets: [{ label: "x", path: "/x" }] });
    expect(loadPresets(file)).toEqual([{ label: "x", path: "/x" }]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("loadPresets returns [] for a missing or invalid file", () => {
    const dir = tmp();
    expect(loadPresets(path.join(dir, "none.json"))).toEqual([]);
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "not json{");
    expect(loadPresets(bad)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("savePresets returns false when the path can't be written (regression for the 500 path)", () => {
    const dir = tmp();
    const asFile = path.join(dir, "afile");
    writeFileSync(asFile, "x"); // a file where a directory is needed
    // mkdir(`<file>/sub`) fails because the parent is a file → save reports false.
    expect(savePresets(path.join(asFile, "sub", "config.json"), [{ label: "x", path: "/x" }])).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
