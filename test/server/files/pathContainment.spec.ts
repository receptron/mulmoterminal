import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, mkdirSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  containedPath,
  realContainedWithin,
  resolveBase,
  expandTilde,
  authorizedServingBase,
  resolveContained,
  namesAWindowsDevice,
} from "../../../server/files/pathContainment";

const tmp = () => makeTempDir("mt-files-");

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
  it("accepts an absolute path that lies inside the base", () => {
    expect(containedPath(base, "/proj/root/docs/a.md")).toBe(path.resolve(base, "docs/a.md"));
  });
});

describe("authorizedServingBase", () => {
  const root = "/proj/root";
  const sessions = ["/home/me/repo-a", "/home/me/repo-b"];
  it("returns the workspace root when no cwd is given", () => {
    expect(authorizedServingBase(null, root, sessions)).toBe(path.resolve(root));
    expect(authorizedServingBase("", root, sessions)).toBe(path.resolve(root));
  });
  it("allows the root and any live session cwd", () => {
    expect(authorizedServingBase(root, root, sessions)).toBe(path.resolve(root));
    expect(authorizedServingBase("/home/me/repo-b", root, sessions)).toBe(path.resolve("/home/me/repo-b"));
  });
  it("normalizes before comparing (trailing slash / non-canonical)", () => {
    expect(authorizedServingBase("/home/me/repo-a/", root, sessions)).toBe(path.resolve("/home/me/repo-a"));
    expect(authorizedServingBase("/home/me/repo-a/../repo-a", root, sessions)).toBe(path.resolve("/home/me/repo-a"));
  });
  // The browser sends the cwd back as a query param, so its casing is whatever the URL
  // carried. On Windows that still names one directory, so it is authorized — and served
  // from the spelling that was ASKED for, not the one the session recorded. On POSIX it
  // names a different directory and is refused.
  it("matches a session cwd by the platform's own casing rule", () => {
    const shouted = "/home/me/REPO-A";
    expect(authorizedServingBase(shouted, root, sessions)).toBe(process.platform === "win32" ? path.resolve(shouted) : null);
  });

  it("rejects a cwd that is neither the root nor a live session dir", () => {
    expect(authorizedServingBase("/etc", root, sessions)).toBeNull();
    expect(authorizedServingBase("/home/me", root, sessions)).toBeNull(); // a parent of a session dir is not itself authorized
    expect(authorizedServingBase("/home/me/repo-a", root, [])).toBeNull(); // no live sessions
  });
});

describe("expandTilde", () => {
  const home = "/home/user";
  it("expands a bare tilde and a leading ~/ (and ~\\)", () => {
    expect(expandTilde("~", home)).toBe(home);
    expect(expandTilde("~/a/b.gif", home)).toBe(path.join(home, "a/b.gif"));
    expect(expandTilde("~\\a\\b.gif", home)).toBe(path.join(home, "a\\b.gif"));
  });
  it("leaves ~user and non-leading / non-tilde paths untouched", () => {
    expect(expandTilde("~bob/x", home)).toBe("~bob/x");
    expect(expandTilde("a/~/b", home)).toBe("a/~/b");
    expect(expandTilde("/abs/x.png", home)).toBe("/abs/x.png");
    expect(expandTilde("rel/x.png", home)).toBe("rel/x.png");
  });
});

// The gate both file entry points share. It exists because they had it written out
// separately and drifted: the raw route expanded `~`, the browse routes did not, so a
// clicked `~/proj/a.ts` was served by one and refused by the other (#808).
describe("resolveContained (the shared gate)", () => {
  const HOME = "/home/user";

  it("expands a leading tilde before containing it", () => {
    const root = realpathSync(tmp());
    writeFileSync(path.join(root, "a.ts"), "x");
    expect(resolveContained(root, `~/a.ts`, root)).toBe(path.join(root, "a.ts"));
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts a project-relative and an absolute path inside the base", () => {
    const root = realpathSync(tmp());
    writeFileSync(path.join(root, "a.ts"), "x");
    expect(resolveContained(root, "a.ts", HOME)).toBe(path.join(root, "a.ts"));
    expect(resolveContained(root, path.join(root, "a.ts"), HOME)).toBe(path.join(root, "a.ts"));
    rmSync(root, { recursive: true, force: true });
  });

  it("still refuses an escape — the expansion must not become a way out", () => {
    const root = realpathSync(tmp());
    expect(resolveContained(root, "../secret", HOME)).toBeNull();
    expect(resolveContained(root, "/etc/passwd", HOME)).toBeNull();
    // A tilde path that expands OUTSIDE the base is exactly the case the expansion adds.
    expect(resolveContained(root, "~/elsewhere.ts", HOME)).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it("still refuses a symlink that leaves the base", () => {
    const root = realpathSync(tmp());
    const outside = realpathSync(tmp());
    writeFileSync(path.join(outside, "secret.txt"), "s");
    symlinkSync(outside, path.join(root, "link"));
    expect(resolveContained(root, "link/secret.txt", HOME)).toBeNull();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
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

// Windows resolves the DOS device names in EVERY directory: `C:\\anything\\NUL` is the null
// device, not a missing file. Containment says yes — the path is inside the base — and the
// open lands on a device. NUL reads as empty (merely wrong); CON blocks until the console has
// input, which hangs the request that asked for it.
describe("namesAWindowsDevice", () => {
  it.each(["NUL", "CON", "PRN", "AUX", "COM1", "COM9", "LPT1", "LPT9"])("refuses %s on Windows", (name) => {
    expect(namesAWindowsDevice(name, "win32")).toBe(true);
  });

  // A colon opens an NTFS alternate data stream, and `NUL:` is the legacy device spelling —
  // neither stops the name in front of it being a device. Flagged by Codex on #821.
  it("refuses one behind a colon (alternate data stream / legacy device spelling)", () => {
    for (const name of ["NUL:$DATA", "CON:foo", "docs/NUL:x", "AUX:"]) {
      expect(namesAWindowsDevice(name, "win32"), name).toBe(true);
    }
  });

  it("refuses one whatever its case, extension, or trailing dots and spaces", () => {
    for (const name of ["nul", "Nul", "NUL.txt", "con.log", "NUL.", "NUL. ", "aux .txt"]) {
      expect(namesAWindowsDevice(name, "win32"), name).toBe(true);
    }
  });

  it("refuses one in ANY segment, with either separator", () => {
    expect(namesAWindowsDevice("docs/NUL/readme.md", "win32")).toBe(true);
    expect(namesAWindowsDevice("docs\\CON\\readme.md", "win32")).toBe(true);
  });

  it("allows ordinary names that merely start the same way", () => {
    for (const name of ["console.ts", "contact.md", "nullable.ts", "com10.txt", "auxiliary/notes.md", "printer.log"]) {
      expect(namesAWindowsDevice(name, "win32"), name).toBe(false);
    }
  });

  // `con` is an ordinary filename on POSIX; refusing it there would break a real file.
  it("allows every one of them off Windows", () => {
    for (const name of ["NUL", "con/readme.md", "aux.txt"]) {
      expect(namesAWindowsDevice(name, "linux"), name).toBe(false);
    }
  });

  it("is refused by the shared gate, not just recognised", () => {
    const root = realpathSync(tmp());
    expect(resolveContained(root, "NUL", "/home/user", "win32")).toBeNull();
    expect(resolveContained(root, "docs/CON.txt", "/home/user", "win32")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });
});
