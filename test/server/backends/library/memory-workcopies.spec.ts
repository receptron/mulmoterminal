// @vitest-environment node
// Memory split across the work copies of one repository (#3331): the same file name in another copy
// of the same remote is reported, saying whether its text is the same.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoKey, withWorkCopies, workCopyIssues, type WorkCopyMemory } from "../../../../server/backends/library/memory-workcopies";
import { readMemoryHealth } from "../../../../server/backends/library/memory-health-read";

const copy = (slug: string, repo: string | null, files: Record<string, string | null>): WorkCopyMemory => ({
  slug,
  repo,
  files: Object.entries(files).map(([file, version]) => ({ file, version })),
});

describe("workCopyIssues", () => {
  it("names the other copies of the same repository holding a memory of that name, same text or not", () => {
    const issues = workCopyIssues([
      copy("-w-app2", "github.com/o/app", { "a.md": "v1", "b.md": "v2", "only.md": "v9" }),
      copy("-w-app3", "github.com/o/app", { "a.md": "v1", "b.md": "v3" }),
      copy("-w-app4", "github.com/o/app", { "a.md": "v7" }),
    ]);
    expect(Object.fromEntries(issues.get("-w-app2") ?? [])).toEqual({
      "a.md": {
        kind: "in-work-copies",
        copies: [
          { slug: "-w-app3", same: true },
          { slug: "-w-app4", same: false },
        ],
      },
      "b.md": { kind: "in-work-copies", copies: [{ slug: "-w-app3", same: false }] },
    });
    expect([...(issues.get("-w-app4")?.keys() ?? [])]).toEqual(["a.md"]);
  });

  it("says nothing across different repositories, of a folder whose repository is unknown, or of a lone copy", () => {
    expect(
      workCopyIssues([
        copy("-w-app", "github.com/o/app", { "a.md": "v1" }),
        copy("-w-other", "github.com/o/other", { "a.md": "v1" }),
        copy("-w-loose", null, { "a.md": "v1" }),
        copy("-w-loose2", null, { "a.md": "v1" }),
      ]).size,
    ).toBe(0);
  });

  it("never calls a text it could not read the same, even beside another it could not read", () => {
    const issues = workCopyIssues([copy("-a", "r", { "a.md": null }), copy("-b", "r", { "a.md": null })]);
    expect(issues.get("-a")?.get("a.md")?.copies).toEqual([{ slug: "-b", same: false }]);
  });
});

describe("repoKey", () => {
  it("is one key for one repository however its remote was written", () => {
    expect(repoKey({ host: "github.com", path: "Receptron/MulmoTerminal" })).toBe(repoKey({ host: "github.com", path: "receptron/mulmoterminal" }));
    expect(repoKey({ host: "github.com", path: "o/app" })).not.toBe(repoKey({ host: "gitlab.com", path: "o/app" }));
  });
});

describe("withWorkCopies", () => {
  it("adds the issue after a file's others, and lists a file that had none", () => {
    const found = new Map([
      ["a.md", { kind: "in-work-copies" as const, copies: [{ slug: "-b", same: true }] }],
      ["c.md", { kind: "in-work-copies" as const, copies: [{ slug: "-b", same: false }] }],
    ]);
    const health = withWorkCopies({ slug: "-a", issues: [], files: { "a.md": [{ kind: "not-in-index" }] } }, found);
    expect(health.files).toEqual({ "a.md": [{ kind: "not-in-index" }, found.get("a.md")], "c.md": [found.get("c.md")] });
    expect(withWorkCopies({ slug: "-a", issues: [], files: {} }, undefined)).toEqual({ slug: "-a", issues: [], files: {} });
  });
});

describe("readMemoryHealth across work copies", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const MEMORY = (name: string, body: string) => `---\nname: ${name}\ndescription: d\ntype: feedback\n---\n${body}`;

  it("asks each folder's directory for its repository, and reports memory a sibling copy also holds", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-memory-copies-"));
    dirs.push(root);
    const cwds = ["app2", "app3", "lone"].map((name) => path.join(root, name));
    const write = (cwd: string, file: string, text: string): void => {
      const folder = path.join(root, "projects", cwd.replace(/[^a-zA-Z0-9\-_]/g, "-"), "memory");
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, file), text);
      writeFileSync(path.join(folder, "MEMORY.md"), "- [A](a.md)\n");
    };
    const [app2, app3, lone] = cwds as [string, string, string];
    write(app2, "a.md", MEMORY("a", "same"));
    write(app3, "a.md", MEMORY("a", "same"));
    write(lone, "a.md", MEMORY("a", "same"));
    const asked: string[] = [];
    const repoOf = (dir: string) => (asked.push(dir), Promise.resolve(dir === lone ? "github.com/o/lone" : "github.com/o/app"));
    const health = await readMemoryHealth(path.join(root, "projects"), cwds, 0, repoOf);
    const slugOf = (cwd: string) => cwd.replace(/[^a-zA-Z0-9\-_]/g, "-");
    expect(asked.sort()).toEqual([...cwds].sort());
    expect(health.map((project) => project.slug).sort()).toEqual([slugOf(app2), slugOf(app3)].sort());
    expect(health.find((project) => project.slug === slugOf(app2))?.files).toEqual({
      "a.md": [{ kind: "in-work-copies", copies: [{ slug: slugOf(app3), same: true }] }],
    });
  });

  it("calls two memories holding a written U+FFFD the same when their bytes are", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-memory-copies-"));
    dirs.push(root);
    const cwds = ["app2", "app3"].map((name) => path.join(root, name));
    cwds.forEach((cwd) => {
      const folder = path.join(root, "projects", cwd.replace(/[^a-zA-Z0-9\-_]/g, "-"), "memory");
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, "MEMORY.md"), "- [A](a.md)\n");
      writeFileSync(path.join(folder, "a.md"), MEMORY("a", "a replacement character: \uFFFD"));
    });
    const health = await readMemoryHealth(path.join(root, "projects"), cwds, 0, () => Promise.resolve("github.com/o/app"));
    expect(
      health
        .flatMap((project) => project.files["a.md"] ?? [])
        .flatMap((issue) => (issue.kind === "in-work-copies" ? issue.copies : []))
        .map((copy) => copy.same),
    ).toEqual([true, true]);
  });

  it("never calls two files the same when their bytes are not text, though they read alike", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-memory-copies-"));
    dirs.push(root);
    const cwds = ["app2", "app3"].map((name) => path.join(root, name));
    cwds.forEach((cwd, at) => {
      const folder = path.join(root, "projects", cwd.replace(/[^a-zA-Z0-9\-_]/g, "-"), "memory");
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, "MEMORY.md"), "- [A](a.md)\n");
      writeFileSync(path.join(folder, "a.md"), Buffer.concat([Buffer.from(MEMORY("a", "x")), Buffer.from([0xff - at])]));
    });
    const health = await readMemoryHealth(path.join(root, "projects"), cwds, 0, () => Promise.resolve("github.com/o/app"));
    expect(health.flatMap((project) => project.files["a.md"] ?? []).flatMap((issue) => (issue.kind === "in-work-copies" ? issue.copies : []))).toEqual([
      { slug: expect.any(String), same: false },
      { slug: expect.any(String), same: false },
    ]);
  });
});
