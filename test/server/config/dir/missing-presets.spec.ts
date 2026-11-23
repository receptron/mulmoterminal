// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyMissingPresets, type DirPresence } from "../../../../server/config/dir/missing-presets";
import { probeDir } from "../../../../server/config/dir/cwd-presets";

const at = (posixPath: string) => path.resolve(posixPath);
/** A probe over a fixed picture of the filesystem: listed paths answer as given, the rest are present. */
const fsWith =
  (entries: Record<string, DirPresence>) =>
  (dir: string): DirPresence =>
    entries[dir] ?? "present";

describe("classifyMissingPresets", () => {
  it("calls a directory gone when its parent is still there", () => {
    const dir = at("/work/old-worktree");
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent" }))).toEqual({ gone: [dir], unreachable: [] });
  });

  it("calls it unreachable when the parent is missing too", () => {
    const dir = at("/srv/share/project");
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent", [at("/srv/share")]: "absent" }))).toEqual({ gone: [], unreachable: [dir] });
  });

  it("never forgets a symlink whose target is missing, wherever its parent is", () => {
    const dir = at("/work/usb-link");
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "dangling" }))).toEqual({ gone: [], unreachable: [dir] });
  });

  it("treats a parent that is a dangling symlink as out of reach", () => {
    const dir = at("/work/usb-link/project");
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent", [at("/work/usb-link")]: "dangling" }))).toEqual({ gone: [], unreachable: [dir] });
  });

  // An unplugged drive removes its own mount directory while the mount root stays.
  it.skipIf(process.platform === "win32").each(["/Volumes/USB", "/media/USB", "/mnt/share", "/media/me/USB", "/run/media/me/USB"])(
    "never forgets a volume root such as %s",
    (dir) => {
      expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent" }))).toEqual({ gone: [], unreachable: [dir] });
    },
  );

  it.skipIf(process.platform === "win32")("still forgets a folder deleted INSIDE a mounted volume", () => {
    const dir = "/Volumes/USB/old-project";
    expect(classifyMissingPresets([dir], fsWith({ [dir]: "absent" }))).toEqual({ gone: [dir], unreachable: [] });
  });

  it("leaves present directories out of both lists, keeping the saved order for the rest", () => {
    const [a, b, c, d] = ["/w/a", "/w/b", "/v/x/c", "/w/d"].map(at);
    const result = classifyMissingPresets([a, b, c, d], fsWith({ [b]: "absent", [c]: "absent", [at("/v/x")]: "absent", [d]: "absent" }));
    expect(result).toEqual({ gone: [b, d], unreachable: [c] });
  });

  it("never asks about a relative path or a filesystem root", () => {
    const asked: string[] = [];
    const root = path.parse(process.cwd()).root;
    const result = classifyMissingPresets(["relative/dir", "", root], (dir) => {
      asked.push(dir);
      return "absent";
    });
    expect(result).toEqual({ gone: [], unreachable: [] });
    expect(asked).toEqual([]);
  });

  it("answers empty lists for an empty input", () => {
    expect(classifyMissingPresets([], () => "absent")).toEqual({ gone: [], unreachable: [] });
  });
});

describe("probeDir", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-absent-")));
  const file = path.join(root, "file.txt");
  writeFileSync(file, "x");
  afterAll(() => {
    if (existsSync(path.join(root, "locked"))) chmodSync(path.join(root, "locked"), 0o755);
    rmSync(root, { recursive: true, force: true });
  });

  it("answers present for a directory and a file that exist", () => {
    expect(probeDir(root)).toBe("present");
    expect(probeDir(file)).toBe("present");
  });

  it("answers absent for a missing path and for a path through a file (ENOTDIR)", () => {
    expect(probeDir(path.join(root, "missing"))).toBe("absent");
    expect(probeDir(path.join(file, "child"))).toBe("absent");
  });

  it.skipIf(process.platform === "win32")("answers dangling for a symlink whose target is missing", () => {
    const link = path.join(root, "link");
    symlinkSync(path.join(root, "nowhere"), link);
    expect(probeDir(link)).toBe("dangling");
  });

  // The caller deletes saved entries on `true`, so a permission error must read as present.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("answers present when the path cannot be read (EACCES)", () => {
    const locked = path.join(root, "locked");
    mkdirSync(path.join(locked, "inner"), { recursive: true });
    chmodSync(locked, 0o000);
    expect(probeDir(path.join(locked, "inner"))).toBe("present");
  });
});
