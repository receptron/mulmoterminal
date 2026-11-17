// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync, rmSync, realpathSync, lstatSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import {
  createEntry,
  entryUnder,
  freeTrashName,
  MAX_TRASH_NAME_TRIES,
  moveToTrash,
  renameEntry,
  trashInfo,
  trashLayout,
  validEntryName,
} from "../../../server/files/tree-ops";

// #2578. The tree's own file operations: every one acts on the entry the tree shows, inside the root.
const dirs: string[] = [];
const tmp = (): string => {
  const dir = realpathSync(makeTempDir("mt-tree-ops-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("validEntryName", () => {
  it.each([["a.md"], ["新しい"], ["a b"], [".env"], ["x".repeat(255)]])("accepts %j", (name) => {
    expect(validEntryName(name)).toBe(true);
  });
  it.each([[""], ["  "], ["."], [".."], ["a/b"], ["a\\b"], ["a\0b"], ["x".repeat(256)], [1], [null]])("refuses %j", (name) => {
    expect(validEntryName(name)).toBe(false);
  });
  // On Windows a colon writes an alternate stream of another file, and CON is a device.
  it.each([["a:b"], ["CON"], ["nul.txt"]])("refuses %j on Windows, and only there", (name) => {
    expect(validEntryName(name, "win32")).toBe(false);
    expect(validEntryName(name, "darwin")).toBe(true);
  });
});

describe("entryUnder", () => {
  it("names an entry inside the root", () => {
    const root = tmp();
    mkdirSync(path.join(root, "src"));
    expect(entryUnder(root, "src/a.ts")).toBe(path.join(root, "src", "a.ts"));
  });

  it.each([["../x"], ["src/../../x"], ["/etc/passwd"], [""], ["."]])("refuses %j (outside, or the root itself)", (rel) => {
    const root = tmp();
    mkdirSync(path.join(root, "src"));
    expect(entryUnder(root, rel)).toBeNull();
  });

  // A folder literally named `~` is an entry like any other; it must not mean the home directory.
  it("reads a leading ~ as a name, not as home", () => {
    const root = tmp();
    expect(entryUnder(root, "~/Documents")).toBe(path.join(root, "~", "Documents"));
    expect(entryUnder(root, "~")).toBe(path.join(root, "~"));
  });

  it("refuses a Windows device name on Windows", () => {
    const root = tmp();
    expect(entryUnder(root, "src/CON", "win32")).toBeNull();
    expect(entryUnder(root, "src/CON", "darwin")).toBe(path.join(root, "src", "CON"));
  });

  // A symlinked FOLDER inside the root that points out: nothing may be made or moved through it.
  it("refuses a path through a link to a folder outside", () => {
    const root = tmp();
    const outside = tmp();
    symlinkSync(outside, path.join(root, "out"));
    expect(entryUnder(root, "out/a.txt")).toBeNull();
  });

  // The link ITSELF is an entry of the tree: it is renamed or trashed as a link, never followed.
  it("names a link as the link, not what it points to", () => {
    const root = tmp();
    const outside = tmp();
    symlinkSync(outside, path.join(root, "out"));
    expect(entryUnder(root, "out")).toBe(path.join(root, "out"));
  });
});

describe("createEntry", () => {
  it("makes an empty file and a folder", () => {
    const root = tmp();
    expect(createEntry(path.join(root, "a.md"), "file", () => entryUnder(root, "a.md"))).toBe("written");
    expect(createEntry(path.join(root, "d"), "dir", () => entryUnder(root, "d"))).toBe("written");
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("");
    expect(lstatSync(path.join(root, "d")).isDirectory()).toBe(true);
  });

  it("never overwrites what is there", () => {
    const root = tmp();
    writeFileSync(path.join(root, "a.md"), "keep");
    expect(() => createEntry(path.join(root, "a.md"), "file", () => entryUnder(root, "a.md"))).toThrow();
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("keep");
  });
});

describe("renameEntry", () => {
  it("renames in place and refuses an existing name", () => {
    const root = tmp();
    writeFileSync(path.join(root, "a.md"), "a");
    writeFileSync(path.join(root, "b.md"), "b");
    expect(renameEntry(path.join(root, "a.md"), path.join(root, "b.md"), () => entryUnder(root, "b.md"))).toBe("exists");
    expect(readFileSync(path.join(root, "b.md"), "utf8")).toBe("b");
    expect(renameEntry(path.join(root, "a.md"), path.join(root, "c.md"), () => entryUnder(root, "c.md"))).toBe("renamed");
    expect(readFileSync(path.join(root, "c.md"), "utf8")).toBe("a");
  });

  it("renames a folder", () => {
    const root = tmp();
    mkdirSync(path.join(root, "d"));
    writeFileSync(path.join(root, "d", "x.md"), "x");
    expect(renameEntry(path.join(root, "d"), path.join(root, "e"), () => entryUnder(root, "e"))).toBe("renamed");
    expect(readFileSync(path.join(root, "e", "x.md"), "utf8")).toBe("x");
  });

  it("renames a link without touching what it points to", () => {
    const root = tmp();
    const outside = tmp();
    symlinkSync(outside, path.join(root, "out"));
    expect(renameEntry(path.join(root, "out"), path.join(root, "gone"), () => entryUnder(root, "gone"))).toBe("renamed");
    expect(lstatSync(path.join(root, "gone")).isSymbolicLink()).toBe(true);
    expect(existsSync(outside)).toBe(true);
  });
});

describe("trashLayout", () => {
  it("is the user's Trash on macOS, the freedesktop one on Linux, and none elsewhere", () => {
    expect(trashLayout("darwin", {}, "/Users/u")).toEqual({ kind: "mac", files: "/Users/u/.Trash" });
    expect(trashLayout("linux", {}, "/home/u")).toEqual({
      kind: "freedesktop",
      files: "/home/u/.local/share/Trash/files",
      info: "/home/u/.local/share/Trash/info",
    });
    expect(trashLayout("linux", { XDG_DATA_HOME: "/data" }, "/home/u")).toMatchObject({ files: "/data/Trash/files" });
    expect(trashLayout("linux", { XDG_DATA_HOME: "relative" }, "/home/u")).toMatchObject({ files: "/home/u/.local/share/Trash/files" });
    expect(trashLayout("win32", {}, "C:\\Users\\u")).toBeNull();
    expect(trashLayout("freebsd", {}, "/home/u")).toBeNull();
  });
});

// An error that repeats for every name (an unreadable Trash) must end the search, not spin the thread.
describe("freeTrashName — bounded", () => {
  it("gives up when every name is taken", () => {
    expect(freeTrashName("a.txt", () => true)).toBeNull();
  });

  // #2694. An extension too long to keep beside a numbered stem: the whole name is cut instead of the
  // entry not being trashed at all.
  it("finds a name for an entry whose extension alone is too long to keep", () => {
    const name = `a.${"e".repeat(250)}`;
    const first = freeTrashName(name, () => false) ?? "";
    const second = freeTrashName(name, (n) => n === first) ?? "";
    [first, second].forEach((candidate) => expect(Buffer.byteLength(`${candidate}.trashinfo`)).toBeLessThanOrEqual(255));
    expect(second).not.toBe(first);
    expect(second.endsWith(" 2")).toBe(true);
  });

  // The stem is never cut below one character, and that character can be four bytes.
  it.each([
    ["a four-byte first character", `\u{1F600}.${"e".repeat(238)}`],
    ["a two-byte first character", `\u00E9.${"e".repeat(239)}`],
    ["a three-byte first character", `\u3042.${"e".repeat(238)}`],
  ])("keeps every numbered name within 255 bytes with its .trashinfo, for %s", (_, name) => {
    const taken = new Set<string>();
    for (let tries = 0; tries < MAX_TRASH_NAME_TRIES; tries++) {
      const next = freeTrashName(name, (n) => taken.has(n));
      expect(next).not.toBeNull();
      if (next === null) return;
      expect(Buffer.byteLength(`${next}.trashinfo`), next).toBeLessThanOrEqual(255);
      taken.add(next);
    }
  });

  it("keeps each name, its number and a .trashinfo within 255 bytes", () => {
    const long = `${"x".repeat(250)}.txt`;
    const taken = new Set([freeTrashName(long, () => false)]);
    const second = freeTrashName(long, (n) => taken.has(n)) ?? "";
    expect(second.endsWith(" 2.txt")).toBe(true);
    expect(Buffer.byteLength(`${second}.trashinfo`)).toBeLessThanOrEqual(255);
  });
});

describe("freeTrashName", () => {
  it("numbers a taken name as a file manager does", () => {
    const taken = new Set(["a.txt", "a 2.txt", "dir", ".env"]);
    expect(freeTrashName("b.txt", (n) => taken.has(n))).toBe("b.txt");
    expect(freeTrashName("a.txt", (n) => taken.has(n))).toBe("a 3.txt");
    expect(freeTrashName("dir", (n) => taken.has(n))).toBe("dir 2");
    expect(freeTrashName(".env", (n) => taken.has(n))).toBe(".env 2");
  });
});

describe("trashInfo", () => {
  it("records where it came from, percent-encoded, and when", () => {
    const info = trashInfo("/home/u/my file#1.md", new Date(2026, 8, 30, 7, 5, 9));
    expect(info).toBe("[Trash Info]\nPath=/home/u/my%20file%231.md\nDeletionDate=2026-09-30T07:05:09\n");
  });
});

describe("moveToTrash", () => {
  it("moves the entry into a macOS-style Trash, numbering a clash", () => {
    const root = tmp();
    const trash = tmp();
    writeFileSync(path.join(trash, "a.md"), "older");
    writeFileSync(path.join(root, "a.md"), "new");
    expect(moveToTrash(path.join(root, "a.md"), { kind: "mac", files: trash }, new Date(), () => entryUnder(root, "a.md"))).toBe("trashed");
    expect(existsSync(path.join(root, "a.md"))).toBe(false);
    expect(readFileSync(path.join(trash, "a 2.md"), "utf8")).toBe("new");
  });

  // The freedesktop Trash is a POSIX layout: its `.trashinfo` records a POSIX path.
  it.skipIf(process.platform === "win32")("trashes an entry whose name leaves no room for .trashinfo", () => {
    const root = tmp();
    const trash = tmp();
    const name = "y".repeat(250);
    writeFileSync(path.join(root, name), "long");
    const layout = { kind: "freedesktop" as const, files: path.join(trash, "files"), info: path.join(trash, "info") };
    expect(moveToTrash(path.join(root, name), layout, new Date(), () => entryUnder(root, name))).toBe("trashed");
    expect(existsSync(path.join(root, name))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("writes the freedesktop info file beside the moved entry", () => {
    const root = tmp();
    const trash = tmp();
    mkdirSync(path.join(root, "d"));
    const layout = { kind: "freedesktop" as const, files: path.join(trash, "files"), info: path.join(trash, "info") };
    expect(moveToTrash(path.join(root, "d"), layout, new Date(2026, 0, 2, 3, 4, 5), () => entryUnder(root, "d"))).toBe("trashed");
    expect(lstatSync(path.join(trash, "files", "d")).isDirectory()).toBe(true);
    expect(readFileSync(path.join(trash, "info", "d.trashinfo"), "utf8")).toContain(`Path=${path.join(root, "d")}`);
  });
});
