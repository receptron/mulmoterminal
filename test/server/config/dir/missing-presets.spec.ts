// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyMissingPresets } from "../../../../server/config/dir/missing-presets";
import { isAbsentDir } from "../../../../server/config/dir/cwd-presets";

const at = (posixPath: string) => path.resolve(posixPath);
const absentIn = (missing: readonly string[]) => (dir: string) => missing.includes(dir);

describe("classifyMissingPresets", () => {
  it("calls a directory gone when its parent is still there", () => {
    const dir = at("/work/old-worktree");
    expect(classifyMissingPresets([dir], absentIn([dir]))).toEqual({ gone: [dir], unreachable: [] });
  });

  it("calls it unreachable when the parent is missing too", () => {
    const dir = at("/Volumes/usb/project");
    expect(classifyMissingPresets([dir], absentIn([dir, at("/Volumes/usb")]))).toEqual({ gone: [], unreachable: [dir] });
  });

  it("leaves present directories out of both lists, keeping the saved order for the rest", () => {
    const [a, b, c, d] = ["/w/a", "/w/b", "/v/x/c", "/w/d"].map(at);
    const result = classifyMissingPresets([a, b, c, d], absentIn([b, c, at("/v/x"), d]));
    expect(result).toEqual({ gone: [b, d], unreachable: [c] });
  });

  it("never asks about a relative path or a filesystem root", () => {
    const asked: string[] = [];
    const root = path.parse(process.cwd()).root;
    const result = classifyMissingPresets(["relative/dir", "", root], (dir) => {
      asked.push(dir);
      return true;
    });
    expect(result).toEqual({ gone: [], unreachable: [] });
    expect(asked).toEqual([]);
  });

  it("answers empty lists for an empty input", () => {
    expect(classifyMissingPresets([], () => true)).toEqual({ gone: [], unreachable: [] });
  });
});

describe("isAbsentDir", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-absent-")));
  const file = path.join(root, "file.txt");
  writeFileSync(file, "x");
  afterAll(() => {
    if (existsSync(path.join(root, "locked"))) chmodSync(path.join(root, "locked"), 0o755);
    rmSync(root, { recursive: true, force: true });
  });

  it("is false for a directory and a file that exist", () => {
    expect(isAbsentDir(root)).toBe(false);
    expect(isAbsentDir(file)).toBe(false);
  });

  it("is true for a missing path and for a path through a file (ENOTDIR)", () => {
    expect(isAbsentDir(path.join(root, "missing"))).toBe(true);
    expect(isAbsentDir(path.join(file, "child"))).toBe(true);
  });

  // The caller deletes saved entries on `true`, so a permission error must read as present.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("is false when the path cannot be read (EACCES)", () => {
    const locked = path.join(root, "locked");
    mkdirSync(path.join(locked, "inner"), { recursive: true });
    chmodSync(locked, 0o000);
    expect(isAbsentDir(path.join(locked, "inner"))).toBe(false);
  });
});
