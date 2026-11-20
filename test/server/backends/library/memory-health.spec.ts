// @vitest-environment node
// What can be tidied in memory (#3331): every rule both ways — what it reports, and what it must leave
// alone — then the reader over a real folder, where existence is asked of the disk.
import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  indexEntries,
  linkNames,
  memoryHealth,
  pathReferences,
  resolveReference,
  topFolder,
  type MemoryHealthInput,
} from "../../../../server/backends/library/memory-health";
import { readMemoryHealth } from "../../../../server/backends/library/memory-health-read";
import { MEMORY_INDEX_BYTES_MAX, MEMORY_INDEX_LINES_MAX } from "../../../../common/libraryMemory";

const memory = (name: string, body = "", extra = ""): string =>
  `---\nname: ${name}\ndescription: about ${name}\nmetadata:\n  type: feedback\n${extra}---\n${body}`;
const input = (over: Partial<MemoryHealthInput> = {}): MemoryHealthInput => ({
  slug: "-w-app",
  index: { text: "- [A](a.md) — one\n", lines: 1, bytes: 20 },
  files: [{ file: "a.md", text: memory("a") }],
  ...over,
});

describe("indexEntries, linkNames, pathReferences", () => {
  it("reads the index's links to files here, and nothing else", () => {
    expect(indexEntries("- [A](a.md)\n- [B](sub/b.md) [site](https://x.dev/c.md) [C](c.md) [D](./d.md)")).toEqual(["a.md", "c.md", "d.md"]);
  });

  it("reads [[links]] outside code only", () => {
    expect(linkNames("see [[a]] and `[[inline]]`\n```\n[[fenced]]\n```\n[[ b ]]")).toEqual(["a", "b"]);
  });

  it.each([
    ["`server/foo.ts`", ["server/foo.ts"]],
    ["`~/.codex/config.toml`", ["~/.codex/config.toml"]],
    ["`/Users/me/x.md`", ["/Users/me/x.md"]],
    ["`@scope/name@1.2.3`", []],
    ["`https://example.com/a.md`", []],
    ["`src/*.ts` `docs/<name>.md` `a.ts`", []],
    ["plain server/foo.ts outside a span", []],
    ["```\n`in/a/fence.ts`\n```", []],
    ["`a/b.ts` twice `a/b.ts`", ["a/b.ts"]],
  ])("%s → %j", (body, references) => {
    expect(pathReferences(body)).toEqual(references);
  });

  it("resolves a reference under the home, as given, or under the project — and gives up on a relative one with no project", () => {
    expect(resolveReference("~/.x/y.md", "/w/app", "/home/me", false)).toBe(path.join("/home/me", ".x/y.md"));
    expect(resolveReference("/abs/y.md", null, "/home/me", false)).toBe("/abs/y.md");
    expect(resolveReference("src/y.ts", "/w/app", "/home/me", false)).toBe(path.resolve("/w/app", "src/y.ts"));
    expect(resolveReference("src/y.ts", null, "/home/me", false)).toBeNull();
  });

  it("takes an absolute path's top folder, on either system's paths", () => {
    expect(topFolder("/Users/me/x.md", path.posix)).toBe("/Users");
    expect(topFolder("/sche_b1.cgi", path.posix)).toBe("/sche_b1.cgi");
    expect(topFolder("C:\\work\\src\\gone.ts", path.win32)).toBe("C:\\work");
    expect(topFolder("/", path.posix)).toBeNull();
    expect(topFolder("\\\\server\\share\\gone.ts", path.win32)).toBe("\\\\server\\share\\");
  });

  it("expands ~\\ on Windows only", () => {
    expect(resolveReference("~\\gone.ts", "/w/app", "/home/me", true)).toBe(path.join("/home/me", "gone.ts"));
    expect(resolveReference("~\\gone.ts", "/w/app", "/home/me", false)).toBeNull();
  });

  it("judges a path written the Windows way only on Windows", () => {
    expect(pathReferences("`C:\\work\\src\\app.ts` `src\\b.ts`")).toEqual(["C:\\work\\src\\app.ts", "src\\b.ts"]);
    expect(resolveReference("C:\\work\\src\\app.ts", "/w/app", "/home/me", false)).toBeNull();
    expect(resolveReference("src\\b.ts", "/w/app", "/home/me", false)).toBeNull();
    expect(resolveReference("src\\b.ts", "/w/app", "/home/me", true)).not.toBeNull();
  });
});

describe("memoryHealth", () => {
  it("finds nothing in a tidy folder", () => {
    expect(memoryHealth(input(), new Set())).toEqual({ slug: "-w-app", issues: [], files: {} });
  });

  it("reports an index past either limit, and not one at them", () => {
    const at = memoryHealth(input({ index: { text: "- [A](a.md)\n", lines: MEMORY_INDEX_LINES_MAX, bytes: MEMORY_INDEX_BYTES_MAX } }), new Set());
    expect(at.issues).toEqual([]);
    const over = memoryHealth(input({ index: { text: "- [A](a.md)\n", lines: 1, bytes: MEMORY_INDEX_BYTES_MAX + 1 } }), new Set());
    expect(over.issues).toEqual([{ kind: "index-over-limit" }]);
  });

  it("reports a folder of memories with no index, and an index line whose file is gone", () => {
    expect(memoryHealth(input({ index: null }), new Set()).issues).toEqual([{ kind: "no-index" }]);
    expect(memoryHealth(input({ index: null, files: [] }), new Set()).issues).toEqual([]);
    expect(memoryHealth(input({ index: { text: "- [A](a.md)\n- [G](gone.md)\n", lines: 2, bytes: 30 } }), new Set()).issues).toEqual([
      { kind: "dead-index-entry", files: ["gone.md"] },
    ]);
  });

  it("reports a memory the index does not list — unless there is no index, or it could not be read", () => {
    const files = [
      { file: "a.md", text: memory("a") },
      { file: "b.md", text: memory("b") },
    ];
    expect(memoryHealth(input({ files }), new Set()).files).toEqual({ "b.md": [{ kind: "not-in-index" }] });
    expect(memoryHealth(input({ files, index: null }), new Set()).files).toEqual({});
    expect(memoryHealth(input({ files, index: { text: null, lines: 9999, bytes: 9_999_999 } }), new Set()).files).toEqual({});
  });

  it("reports missing frontmatter fields, taking the type from metadata or the top level", () => {
    const files = [
      { file: "a.md", text: "---\nname: a\n---\nno description, no type" },
      { file: "b.md", text: "---\nname: b\ndescription: d\ntype: user\n---\n" },
      { file: "c.md", text: "no frontmatter at all" },
    ];
    const index = { text: "[a](a.md)[b](b.md)[c](c.md)", lines: 1, bytes: 30 };
    expect(memoryHealth(input({ files, index }), new Set()).files).toEqual({
      "a.md": [{ kind: "no-frontmatter", missing: ["description", "type"] }],
      "c.md": [{ kind: "no-frontmatter", missing: ["name", "description", "type"] }],
    });
  });

  it("takes a top-level type when the metadata's is empty", () => {
    const files = [{ file: "a.md", text: "---\nname: a\ndescription: d\nmetadata:\n  type:\ntype: feedback\n---\n" }];
    expect(memoryHealth(input({ files }), new Set()).files).toEqual({});
  });

  it("reports a link naming no memory here, by frontmatter name or by file", () => {
    const files = [
      { file: "a.md", text: memory("a", "[[b-named]] [[c]] [[nowhere]]") },
      { file: "b.md", text: memory("b-named") },
      { file: "c.md", text: memory("other-name") },
    ];
    const index = { text: "[a](a.md)[b](b.md)[c](c.md)", lines: 1, bytes: 30 };
    expect(memoryHealth(input({ files, index }), new Set()).files).toEqual({ "a.md": [{ kind: "broken-link", names: ["nowhere"] }] });
  });

  it("reports only the named paths found missing, and judges an unreadable file on its listing alone", () => {
    const files = [
      { file: "a.md", text: memory("a", "`src/gone.ts` and `src/here.ts`") },
      { file: "b.md", text: null },
    ];
    expect(memoryHealth(input({ files }), new Set(["src/gone.ts"])).files).toEqual({
      "a.md": [{ kind: "missing-path", paths: ["src/gone.ts"] }],
      "b.md": [{ kind: "not-in-index" }],
    });
  });
});

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("readMemoryHealth", () => {
  it("judges each folder, asking the disk which named paths exist, and lists only projects with something to tidy", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-memory-health-"));
    dirs.push(root);
    const project = path.join(root, "work");
    mkdirSync(path.join(project, "src"), { recursive: true });
    writeFileSync(path.join(project, "src", "here.ts"), "");
    const slug = project.replace(/[^a-zA-Z0-9\-_]/g, "-");
    const write = (relative: string, text: string): void => {
      mkdirSync(path.dirname(path.join(root, "projects", relative)), { recursive: true });
      writeFileSync(path.join(root, "projects", relative), text);
    };
    write(`${slug}/memory/MEMORY.md`, "- [A](a.md)\n");
    write(`${slug}/memory/a.md`, memory("a", "`src/here.ts` `src/gone.ts` `/sche_b1.cgi`"));
    write("-tidy/memory/MEMORY.md", "- [T](t.md)\n");
    // An index that is there but cannot be read (past the read cap) is not "no index", and lists nothing.
    write("-big/memory/MEMORY.md", `${"- [x](x.md) — padding\n".repeat(60_000)}`);
    write("-big/memory/b.md", memory("b"));
    write("-tidy/memory/t.md", memory("t"));
    const health = await readMemoryHealth(path.join(root, "projects"), [project], 0);
    expect(health).toHaveLength(2); // the tidy project is not listed
    expect(health).toEqual(
      expect.arrayContaining([
        { slug, issues: [], files: { "a.md": [{ kind: "missing-path", paths: ["src/gone.ts"] }] } },
        { slug: "-big", issues: [{ kind: "index-over-limit" }], files: {} },
      ]),
    );
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("does not call an index that cannot be opened missing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-memory-health-"));
    dirs.push(root);
    const folder = path.join(root, "projects", "-locked", "memory");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "a.md"), memory("a"));
    writeFileSync(path.join(folder, "MEMORY.md"), "- [A](a.md)\n");
    chmodSync(path.join(folder, "MEMORY.md"), 0o000);
    try {
      expect(await readMemoryHealth(path.join(root, "projects"), [], 0)).toEqual([]);
    } finally {
      chmodSync(path.join(folder, "MEMORY.md"), 0o600);
    }
  });
});
