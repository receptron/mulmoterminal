import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeScripts, loadScripts, resolveScript } from "../../server/scripts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-scripts-"));
const writeScripts = (dir: string, content: string) => writeFileSync(path.join(dir, "script.json"), content);

describe("sanitizeScripts", () => {
  it("keeps valid rows, trims, and carries optional cwd", () => {
    expect(
      sanitizeScripts([
        { label: " Dev ", command: " yarn dev " },
        { label: "Sub", command: "yarn serve", cwd: " packages/server " },
      ]),
    ).toEqual([
      { label: "Dev", command: "yarn dev" },
      { label: "Sub", command: "yarn serve", cwd: "packages/server" },
    ]);
  });

  it("drops rows missing label or command, and junk", () => {
    expect(sanitizeScripts([{ label: "", command: "x" }, { label: "y", command: "" }, { label: "z" }, { nope: 1 }, "x", 3])).toEqual([]);
  });

  it("rejects a non-string cwd but keeps the rest", () => {
    expect(sanitizeScripts([{ label: "a", command: "b", cwd: 5 }])).toEqual([]);
  });

  it("returns [] for non-array input", () => {
    expect(sanitizeScripts(null)).toEqual([]);
    expect(sanitizeScripts({ scripts: [] })).toEqual([]);
  });

  it("caps the count", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ label: `l${i}`, command: `c${i}` }));
    expect(sanitizeScripts(many, 100)).toHaveLength(100);
  });
});

describe("loadScripts", () => {
  it("reads and validates script.json", () => {
    const dir = tmp();
    writeScripts(dir, JSON.stringify({ scripts: [{ label: "Dev", command: "yarn dev" }] }));
    expect(loadScripts(dir)).toEqual([{ label: "Dev", command: "yarn dev" }]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] for a missing file", () => {
    const dir = tmp();
    expect(loadScripts(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] for invalid JSON", () => {
    const dir = tmp();
    writeScripts(dir, "{ not json");
    expect(loadScripts(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("resolveScript", () => {
  it("resolves a command and defaults cwd to the workspace root", () => {
    const dir = tmp();
    writeScripts(dir, JSON.stringify({ scripts: [{ label: "Dev", command: "yarn dev" }] }));
    expect(resolveScript(dir, 0)).toEqual({ command: "yarn dev", cwd: dir });
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a relative cwd against the workspace root", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "sub"));
    writeScripts(dir, JSON.stringify({ scripts: [{ label: "Sub", command: "yarn serve", cwd: "sub" }] }));
    expect(resolveScript(dir, 0)).toEqual({ command: "yarn serve", cwd: path.join(dir, "sub") });
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for an out-of-range or non-integer index", () => {
    const dir = tmp();
    writeScripts(dir, JSON.stringify({ scripts: [{ label: "Dev", command: "yarn dev" }] }));
    expect(resolveScript(dir, 1)).toBeNull();
    expect(resolveScript(dir, -1)).toBeNull();
    expect(resolveScript(dir, 0.5)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the resolved cwd does not exist", () => {
    const dir = tmp();
    writeScripts(dir, JSON.stringify({ scripts: [{ label: "Gone", command: "x", cwd: "nope" }] }));
    expect(resolveScript(dir, 0)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
