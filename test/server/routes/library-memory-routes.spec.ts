// @vitest-environment node
// The Library's memory routes (#3331): what the folders read as, and that a request reaches only a
// memory file in a memory folder.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall } from "../../helpers/routeCall";
import { mountLibraryRoutes } from "../../../server/routes/library-routes";
import { MEMORY_EDIT_MAX_BYTES } from "../../../common/libraryMemory";
import { memoryVersion } from "../../../server/backends/library/memory-write";
import {
  inBatches,
  isSameFile,
  listMemoryProjects,
  openRegularFile,
  MEMORY_FOLDERS_REUSE_MS,
  MEMORY_HEAD_MAX_BYTES,
  MEMORY_HEAD_STEP_BYTES,
} from "../../../server/backends/library/memory-folders";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const json = (body: unknown) => ({ method: "PUT" as const, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const INDEX = "- [A](a.md) — one\n- [B](b.md) — two\n";

function setup(directories: string[] = ["/w/app"]) {
  const root = mkdtempSync(path.join(tmpdir(), "mt-memory-routes-"));
  dirs.push(root);
  const write = (relative: string, text: string, mtime_s = 1_700_000_000): void => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    utimesSync(file, mtime_s, mtime_s);
  };
  write("-w-app/memory/MEMORY.md", INDEX);
  write("-w-app/memory/a.md", "---\nname: alpha\ndescription: first\nmetadata:\n  type: feedback\n---\nBody [[beta]].", 1_700_000_050);
  write("-w-app/memory/b.md", "plain, no frontmatter", 1_700_000_100); // newer, though listed second on disk
  write("-w-app/memory/notes.txt", "not a memory");
  write("-w-other/memory/top.md", "---\nname: top\ntype: reference\n---\nits type at the top level", 1_699_000_000);
  write("-w-other/memory/MEMORY.md", "");
  mkdirSync(path.join(root, "-w-empty", "memory"), { recursive: true });
  write("-w-app/secret.md", "outside the memory folder");
  const app = express();
  app.use(express.json({ limit: "25mb" })); // as the server's app does
  mountLibraryRoutes(app, { call: () => Promise.resolve(directories), projectsRoot: root });
  return { call: routeCall(app), root };
}

describe("/api/library/memory", () => {
  it("lists the folders that hold memory, named by their directory, the newest written first", async () => {
    const { call } = setup();
    const projects = (await call("/api/library/memory")).body.projects;
    expect(projects).toEqual([
      {
        slug: "-w-app",
        cwd: "/w/app",
        index: { lines: 2, bytes: Buffer.byteLength(INDEX) },
        files: [
          { file: "b.md", name: null, description: null, type: null, updatedAt: 1_700_000_100_000 },
          { file: "a.md", name: "alpha", description: "first", type: "feedback", updatedAt: 1_700_000_050_000 },
        ],
      },
      {
        slug: "-w-other",
        cwd: null,
        index: { lines: 0, bytes: 0 },
        files: [{ file: "top.md", name: "top", description: null, type: "reference", updatedAt: 1_699_000_000_000 }],
      },
    ]);
  });

  it.skipIf(process.platform === "win32")("follows a linked project folder, as the routes and Claude Code do", async () => {
    const { call, root } = setup();
    const elsewhere = path.join(root, "..", `${path.basename(root)}-shared`);
    mkdirSync(path.join(elsewhere, "memory"), { recursive: true });
    dirs.push(elsewhere);
    writeFileSync(path.join(elsewhere, "memory", "shared.md"), "---\nname: shared\n---\nkept in a linked folder");
    symlinkSync(elsewhere, path.join(root, "-w-linked"));
    const projects = (await call("/api/library/memory")).body.projects;
    expect(projects).toEqual(expect.arrayContaining([expect.objectContaining({ slug: "-w-linked", files: [expect.objectContaining({ name: "shared" })] })]));
    expect((await call("/api/library/memory/-w-linked/shared.md")).body.text).toContain("kept in a linked folder");
  });

  it.skipIf(process.platform === "win32")("leaves out a memory file that is a link", async () => {
    const { call, root } = setup();
    symlinkSync(path.join(root, "-w-app", "secret.md"), path.join(root, "-w-app", "memory", "linked.md"));
    expect((await call("/api/library/memory")).body.projects).toEqual([
      expect.objectContaining({ slug: "-w-app", files: [expect.objectContaining({ file: "b.md" }), expect.objectContaining({ file: "a.md" })] }),
      expect.objectContaining({ slug: "-w-other" }),
    ]);
  });
});

describe("the index gauge", () => {
  it("counts an index far past what is read whole, and one with no final newline", async () => {
    const { call, root } = setup();
    const huge = "- [x](x.md) — a line well past the cap\n".repeat(30_000);
    writeFileSync(path.join(root, "-w-app", "memory", "MEMORY.md"), huge);
    writeFileSync(path.join(root, "-w-other", "memory", "MEMORY.md"), "one\ntwo");
    const projects = (await call("/api/library/memory")).body.projects;
    expect(projects).toEqual([
      expect.objectContaining({ slug: "-w-app", index: { lines: 30_000, bytes: Buffer.byteLength(huge) } }),
      expect.objectContaining({ slug: "-w-other", index: { lines: 2, bytes: 7 } }),
    ]);
  });
});

describe("a memory that cannot be read", () => {
  it("is listed by its file name, and its read says why", async () => {
    const { call, root } = setup();
    writeFileSync(path.join(root, "-w-other", "memory", "huge.md"), "x".repeat(1_000_001));
    const other = (await call("/api/library/memory")).body.projects;
    expect(other).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "-w-other", files: expect.arrayContaining([expect.objectContaining({ file: "huge.md", name: null })]) }),
      ]),
    );
    expect((await call("/api/library/memory/-w-other/huge.md")).body).toEqual({ text: null, reason: "too-large" });
  });
});

describe("what the list reads of a memory", () => {
  it("reads the frontmatter from the start of a large memory, not the whole of it", async () => {
    const { root } = setup();
    const head = "---\nname: large\ndescription: big body\n---\n";
    writeFileSync(path.join(root, "-w-other", "memory", "large.md"), head + "x".repeat(MEMORY_HEAD_MAX_BYTES * 50) + "\nname: not-frontmatter\n");
    const other = (await listMemoryProjects(root, [], 0)).find((project) => project.slug === "-w-other");
    expect(other?.files.find((file) => file.file === "large.md")).toEqual(expect.objectContaining({ name: "large", description: "big body" }));
  });
});

describe("a frontmatter longer than one read", () => {
  it("is read on to its closing line, and up to the bound only", async () => {
    const { root } = setup();
    const long = (filler: number): string => `---\nnotes: ${"n".repeat(filler)}\nname: found\nmetadata:\n  type: project\n---\nbody`;
    writeFileSync(path.join(root, "-w-other", "memory", "long.md"), long(MEMORY_HEAD_STEP_BYTES * 3));
    writeFileSync(path.join(root, "-w-other", "memory", "too-long.md"), long(MEMORY_HEAD_MAX_BYTES));
    writeFileSync(path.join(root, "-w-other", "memory", "marked.md"), `\uFEFF${long(MEMORY_HEAD_STEP_BYTES * 2)}`);
    const files = (await listMemoryProjects(root, [], 0)).find((project) => project.slug === "-w-other")?.files ?? [];
    expect(files.find((file) => file.file === "long.md")).toEqual(expect.objectContaining({ name: "found", type: "project" }));
    expect(files.find((file) => file.file === "too-long.md")).toEqual(expect.objectContaining({ name: null }));
    expect(files.find((file) => file.file === "marked.md")).toEqual(expect.objectContaining({ name: "found" })); // behind a byte-order mark
  });
});

describe("inBatches", () => {
  it("never has more than the batch size running, and keeps the order", async () => {
    let running = 0;
    let most = 0;
    const results = await inBatches([...Array(40).keys()], 16, async (item) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return item * 2;
    });
    expect(most).toBe(16);
    expect(results).toEqual([...Array(40).keys()].map((item) => item * 2));
  });
});

describe("opening a memory file", () => {
  it.skipIf(process.platform === "win32")("opens a regular file, and refuses a link or a folder", async () => {
    const { root } = setup();
    const folder = path.join(root, "-w-app", "memory");
    symlinkSync(path.join(folder, "a.md"), path.join(folder, "via-link.md"));
    const opened = await openRegularFile(path.join(folder, "a.md"));
    expect(opened).not.toBeNull();
    await opened?.handle.close();
    expect(await openRegularFile(path.join(folder, "via-link.md"))).toBeNull();
    expect(await openRegularFile(folder)).toBeNull();
    expect(await openRegularFile(path.join(folder, "missing.md"))).toBeNull();
  });

  it("takes the file opened as the one checked only when device and inode both agree", () => {
    expect(isSameFile({ dev: 1, ino: 2 }, { dev: 1, ino: 2 })).toBe(true);
    expect(isSameFile({ dev: 1, ino: 2 }, { dev: 1, ino: 3 })).toBe(false); // swapped in between
    expect(isSameFile({ dev: 1, ino: 2 }, { dev: 9, ino: 2 })).toBe(false);
  });

  it.skipIf(process.platform === "win32")("leaves out an index that is a link", async () => {
    const { root } = setup();
    const index = path.join(root, "-w-other", "memory", "MEMORY.md");
    rmSync(index);
    symlinkSync(path.join(root, "-w-app", "memory", "MEMORY.md"), index);
    const other = (await listMemoryProjects(root, [], 0)).find((project) => project.slug === "-w-other");
    expect(other?.index ?? null).toBeNull();
  });
});

describe("the index under another spelling", () => {
  it("is not listed as a memory when it is the file Claude Code opens as MEMORY.md, and is one when it is not", async () => {
    const { root } = setup();
    const folder = path.join(root, "-w-other", "memory");
    rmSync(path.join(folder, "MEMORY.md"));
    writeFileSync(path.join(folder, "memory.md"), "- lower-case\n");
    writeFileSync(path.join(folder, "api..cache.md"), "two dots inside a name");
    const sameFile = existsSync(path.join(folder, "MEMORY.md")); // a case-insensitive disk opens memory.md by that name
    const files = (await listMemoryProjects(root, [], 0)).find((project) => project.slug === "-w-other")?.files.map((file) => file.file) ?? [];
    expect(files.includes("memory.md")).toBe(!sameFile);
    expect(files).toContain("api..cache.md");
  });
});

describe("finding the folders that hold memory", () => {
  it("looks for them again only after the reuse time, while reading the memory in them fresh", async () => {
    const { root } = setup();
    const slugs = async (now_ms: number) => (await listMemoryProjects(root, [], now_ms)).map((project) => project.slug);
    expect(await slugs(1_000)).toEqual(["-w-app", "-w-other"]);
    mkdirSync(path.join(root, "-w-new", "memory"), { recursive: true });
    writeFileSync(path.join(root, "-w-new", "memory", "n.md"), "new");
    writeFileSync(path.join(root, "-w-app", "memory", "c.md"), "added to a known folder");
    expect(await slugs(1_000 + MEMORY_FOLDERS_REUSE_MS - 1)).toEqual(["-w-app", "-w-other"]);
    const app = (await listMemoryProjects(root, [], 1_000 + MEMORY_FOLDERS_REUSE_MS - 1)).find((project) => project.slug === "-w-app");
    expect(app?.files.map((file) => file.file)).toContain("c.md");
    expect(await slugs(1_000 + MEMORY_FOLDERS_REUSE_MS)).toContain("-w-new");
  });
});

describe("/api/library/memory/:slug/:file", () => {
  it("answers a memory file and the index", async () => {
    const { call } = setup();
    expect((await call("/api/library/memory/-w-app/b.md")).body).toEqual({ text: "plain, no frontmatter", version: memoryVersion("plain, no frontmatter") });
    expect((await call("/api/library/memory/-w-app/MEMORY.md")).body.text).toContain("[A](a.md)");
  });

  it("reaches nothing outside a memory folder", async () => {
    const { call } = setup();
    const status = async (url: string) => (await call(url)).status;
    expect(await status("/api/library/memory/-w-app/missing.md")).toBe(404);
    expect(await status("/api/library/memory/-w-app/notes.txt")).toBe(400);
    expect(await status("/api/library/memory/-w-app/..%2Fsecret.md")).toBe(400);
    expect(await status("/api/library/memory/..%2F-w-app/a.md")).toBe(400);
    expect(await status("/api/library/memory/-w-app/.hidden.md")).toBe(400);
  });
});

describe("editing a memory", () => {
  it("answers the version with the text, and writes only over that version", async () => {
    const { call, root } = setup();
    const opened = (await call("/api/library/memory/-w-app/b.md")).body;
    expect(opened.version).toMatch(/^[0-9a-f]{64}$/);
    const put = (version: unknown, text: unknown = "edited") => call("/api/library/memory/-w-app/b.md", json({ text, version }));
    const saved = await put(opened.version);
    expect(saved.status).toBe(200);
    expect(readFileSync(path.join(root, "-w-app", "memory", "b.md"), "utf8")).toBe("edited");
    const stale = await put(opened.version, "over a change");
    expect(stale.status).toBe(409);
    expect(stale.body.version).toBe(saved.body.version);
  });

  it("refuses a malformed edit, an oversized one, and a name that is not a memory file", async () => {
    const { call } = setup();
    const version = "0".repeat(64);
    const status = async (url: string, body: unknown) => (await call(url, json(body))).status;
    expect(await status("/api/library/memory/-w-app/b.md", { text: "x" })).toBe(400);
    expect(await status("/api/library/memory/-w-app/b.md", { text: 1, version })).toBe(400);
    expect(await status("/api/library/memory/-w-app/b.md", { text: "x".repeat(MEMORY_EDIT_MAX_BYTES + 1), version })).toBe(400);
    expect(await status("/api/library/memory/-w-app/notes.txt", { text: "x", version })).toBe(400);
    expect(await status("/api/library/memory/-w-app/MEMORY.md", { text: "x", version })).toBe(400); // the index is not edited by hand
    expect(await status("/api/library/memory/..%2F-w-app/b.md", { text: "x", version })).toBe(400);
  });

  it("gives no version to a file whose bytes are not text it could write back unchanged", async () => {
    const { call, root } = setup();
    writeFileSync(path.join(root, "-w-app", "memory", "latin1.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9])); // "café" in Latin-1
    const read = (await call("/api/library/memory/-w-app/latin1.md")).body;
    expect(read.text).toContain("\uFFFD");
    expect(read.version).toBeUndefined();
  });
});
