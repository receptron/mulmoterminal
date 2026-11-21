// @vitest-environment node
// Claude Code's home measured entry by entry and project by project (#3333), on a real temp folder,
// and the project folders matched to their directories.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { measureHome } from "../../../../server/backends/library/storage-home.js";
import { listProjects, matchProjects } from "../../../../server/backends/library/storage-projects.js";
import type { WalkFs } from "../../../../server/backends/library/storage-walk.js";
import type { StorageProject } from "../../../../common/libraryStorage.js";

const realFs: WalkFs = { lstat: (at) => fs.lstat(at), readdir: (at) => fs.readdir(at), join: path.join };
const KIB = 1024;

describe("measureHome", () => {
  let home = "";
  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "mt-storage-home-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("measures each entry, each project, and reports every step", async () => {
    await mkdir(path.join(home, "projects", "-a"), { recursive: true });
    await mkdir(path.join(home, "projects", "-b"), { recursive: true });
    await mkdir(path.join(home, "debug"));
    await writeFile(path.join(home, "projects", "-a", "s.jsonl"), "x".repeat(64 * KIB));
    await writeFile(path.join(home, "projects", "-b", "s.jsonl"), "x");
    await writeFile(path.join(home, "debug", "d.txt"), "x".repeat(8 * KIB));
    await writeFile(path.join(home, "history.jsonl"), "x");
    await symlink("/", path.join(home, "root-link"));
    const steps: Array<{ done: number; of: number }> = [];
    const measure = await measureHome(
      home,
      realFs,
      () => 42,
      (step) => steps.push(step),
    );
    if (measure === null) throw new Error("expected a measurement");
    expect(measure.measuredAt).toBe(42);
    expect(measure.projects.map((p) => p.slug)).toEqual(["-a", "-b"]);
    expect(measure.projects[0].bytes).toBeGreaterThanOrEqual(64 * KIB);
    const byName = new Map(measure.entries.map((entry) => [entry.name, entry]));
    expect([...byName.keys()].sort()).toEqual(["debug", "history.jsonl", "projects", "root-link"]);
    expect(byName.get("projects")?.files).toBe(2);
    expect(byName.get("projects")?.directory).toBe(true);
    expect(byName.get("root-link")).toMatchObject({ directory: false, files: 1 });
    expect(measure.entries[0].name).toBe("projects"); // largest first
    expect(measure.total.files).toBe(5);
    expect(measure.total.bytes).toBe(measure.entries.reduce((sum, entry) => sum + entry.bytes, 0));
    expect(steps.at(-1)).toEqual({ done: 5, of: 5 });
    expect(steps.map((step) => step.done)).toEqual([1, 2, 3, 4, 5]);
  });

  it("is null for a home that is not a directory, and empty for one with nothing in it", async () => {
    expect(await measureHome(path.join(home, "missing"), realFs, Date.now, () => {})).toBeNull();
    await writeFile(path.join(home, "a-file"), "x");
    expect(await measureHome(path.join(home, "a-file"), realFs, Date.now, () => {})).toBeNull();
    const empty = await measureHome(path.join(home), realFs, Date.now, () => {});
    expect(empty?.projects).toEqual([]);
    expect(empty?.entries.map((entry) => entry.name)).toEqual(["a-file"]);
  });

  it("measures a `projects` that is a file as an entry, with no projects", async () => {
    await writeFile(path.join(home, "projects"), "x");
    const measure = await measureHome(home, realFs, Date.now, () => {});
    expect(measure?.projects).toEqual([]);
    expect(measure?.entries).toMatchObject([{ name: "projects", files: 1 }]);
  });
});

const slugOf = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, "-");
const size = { bytes: 10, files: 1, unreadable: 0 };
const rules = { slugOf, temporaryRoots: ["/tmp", "/private/var/folders"] };

describe("matchProjects", () => {
  it("names a folder's directory from the index, and judges temp by the directory", () => {
    const matched = matchProjects(
      [
        { slug: "-Users-me-app", ...size },
        { slug: "-tmp-x", ...size },
      ],
      ["/Users/me/app", "/tmp/x"],
      rules,
    );
    expect(matched).toEqual([
      { slug: "-Users-me-app", ...size, cwd: "/Users/me/app", temporary: false },
      { slug: "-tmp-x", ...size, cwd: "/tmp/x", temporary: true },
    ]);
  });

  it("judges a folder the index does not know by its name, and only at a whole root", () => {
    const matched = matchProjects(
      ["-private-var-folders-ab-T-probe", "-tmp", "-tmpfoo-app", "-Users-me-gone"].map((slug) => ({ slug, ...size })),
      [],
      rules,
    );
    expect(matched.map((p) => [p.slug, p.cwd, p.temporary])).toEqual([
      ["-private-var-folders-ab-T-probe", null, true],
      ["-tmp", null, true],
      ["-tmpfoo-app", null, false],
      ["-Users-me-gone", null, false],
    ]);
  });

  it("keeps the first directory when two name the same folder", () => {
    expect(matchProjects([{ slug: "-a-b", ...size }], ["/a/b", "/a-b"], rules)[0].cwd).toBe("/a/b");
  });
});

describe("listProjects", () => {
  const project = (slug: string, cwd: string | null, bytes: number): StorageProject => ({ slug, cwd, temporary: false, bytes, files: 1, unreadable: 0 });
  const all = [project("-a-app", "/a/app", 30), project("-b-App2", "/b/App2", 20), project("-c-x", null, 10)];

  it("lists the first ones and sums the rest", () => {
    expect(listProjects(all, "", 2)).toEqual({ projects: all.slice(0, 2), rest: { bytes: 10, files: 1, unreadable: 0, count: 1 } });
    expect(listProjects(all, "", 5).rest).toEqual({ bytes: 0, files: 0, unreadable: 0, count: 0 });
  });

  it("matches the directory or the folder name, ignoring case and spaces around the query", () => {
    expect(listProjects(all, " APP ").projects.map((p) => p.slug)).toEqual(["-a-app", "-b-App2"]);
    expect(listProjects(all, "-c-").projects.map((p) => p.slug)).toEqual(["-c-x"]);
    expect(listProjects(all, "nothing")).toEqual({ projects: [], rest: { bytes: 0, files: 0, unreadable: 0, count: 0 } });
  });
});
