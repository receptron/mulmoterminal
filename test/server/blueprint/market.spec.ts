// @vitest-environment node
// Installing from a registry, against real git: a pack repository is made in a temp directory and
// cloned through a file:/// URL, exactly as an https one would be.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installPack, installedRecord, uninstallPack, cloneRepo, InstallRefusal } from "../../../server/blueprint/installer";
import { fetchRegistry, loadCatalog, readRegistryUrls, writeRegistryUrls } from "../../../server/blueprint/registry";
import { listPacks, packDirOf } from "../../../server/blueprint/packs";
import { registryEntrySchema, repoAllowedFor, type RegistryEntry } from "../../../common/blueprint/registry";

let work: string;
let packsDir: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "blueprint-market-"));
  packsDir = path.join(work, "installed");
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

// The binary is a parameter so the call names no command itself (the same shape as spawnCollect).
function run(bin: string, cwd: string, args: string[]): string {
  const result = spawnSync(bin, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${bin} ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

const git = (cwd: string, ...args: string[]): string => run("git", cwd, ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);

async function writePack(dir: string, slug: string, options: { withSkill?: boolean } = {}): Promise<void> {
  await mkdir(path.join(dir, "skills", "go"), { recursive: true });
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ kind: "usecase", slug, title: slug, version: "1", bases: ["firebase"] }));
  await writeFile(path.join(dir, "hearing.json"), JSON.stringify({ questions: [{ id: "x", label: "x", why: "w", kind: "text" }] }));
  await writeFile(path.join(dir, "steps.json"), JSON.stringify({ steps: [{ id: "go", title: "go", skill: "skills/go", check: "true" }] }));
  if (options.withSkill !== false) await writeFile(path.join(dir, "skills", "go", "SKILL.md"), '---\nname: x\ndescription: "x"\n---\n');
}

/** A git repository holding a pack under `packs/<slug>`; returns its file:/// URL and head commit. */
async function packRepo(slug: string, options: { withSkill?: boolean } = {}): Promise<{ repo: string; commit: string; dir: string }> {
  const dir = path.join(work, `repo-${slug}`);
  await writePack(path.join(dir, "packs", slug), slug, options);
  git(work, "init", "-q", "-b", "main", dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "pack");
  return { repo: `file://${dir}`, commit: git(dir, "rev-parse", "HEAD"), dir };
}

const entry = (repo: string, slug: string, extra: Partial<RegistryEntry> = {}): RegistryEntry =>
  registryEntrySchema.parse({ slug, kind: "usecase", title: slug, repo, path: `packs/${slug}`, ...extra });

// A registry on this machine: the only kind allowed to name a file:/// repository.
const LOCAL_REGISTRY = "http://127.0.0.1:8765/r.json";

const deps = () => ({ packsDir, builtinSlugs: new Set(["firebase", "internal"]), clone: cloneRepo, now: () => 7 });

// Each test runs real git several times; on a loaded runner a spawn alone can take seconds.
const GIT_TEST_TIMEOUT_MS = 60_000;

describe.skipIf(process.platform === "win32")("installPack", { timeout: GIT_TEST_TIMEOUT_MS }, () => {
  it("clones the listed directory, drops .git, and records where it came from", async () => {
    const { repo, commit } = await packRepo("acme-tool");
    const record = await installPack(entry(repo, "acme-tool"), "http://127.0.0.1:8765/r.json", deps());
    expect(record).toEqual({ slug: "acme-tool", registryUrl: "http://127.0.0.1:8765/r.json", repo, ref: "main", commit, installedAtMs: 7 });
    expect(existsSync(path.join(packsDir, "acme-tool", "manifest.json"))).toBe(true);
    expect(existsSync(path.join(packsDir, "acme-tool", ".git"))).toBe(false);
    expect(await installedRecord(packsDir, "acme-tool")).toEqual(record);
  });

  it("makes the installed pack findable, after the shipped ones", async () => {
    const { repo } = await packRepo("acme-tool");
    await installPack(entry(repo, "acme-tool"), LOCAL_REGISTRY, deps());
    const builtin = path.join(import.meta.dirname, "..", "..", "..", "blueprints");
    const roots = [
      { dir: builtin, source: "builtin" as const },
      { dir: packsDir, source: "installed" as const },
    ];
    expect((await listPacks(roots)).find((pack) => pack.slug === "acme-tool")?.source).toBe("installed");
    expect(await packDirOf(roots, "acme-tool")).toBe(path.join(packsDir, "acme-tool"));
  });

  it("refuses to replace a shipped pack", async () => {
    const { repo } = await packRepo("internal");
    await expect(installPack(entry(repo, "internal"), LOCAL_REGISTRY, deps())).rejects.toThrow(InstallRefusal);
    expect(existsSync(path.join(packsDir, "internal"))).toBe(false);
  });

  it("refuses a repository whose manifest is not the pack the registry names", async () => {
    const { repo } = await packRepo("acme-tool");
    await expect(installPack(entry(repo, "other-tool", { path: "packs/acme-tool" }), LOCAL_REGISTRY, deps())).rejects.toThrow('holds usecase "acme-tool"');
  });

  it("refuses a pack that cannot run, and keeps the version already installed", async () => {
    const good = await packRepo("acme-tool");
    await installPack(entry(good.repo, "acme-tool"), LOCAL_REGISTRY, deps());
    await rm(path.join(good.dir, "packs", "acme-tool", "skills", "go", "SKILL.md"));
    git(good.dir, "commit", "-q", "-am", "break it");
    await expect(installPack(entry(good.repo, "acme-tool"), LOCAL_REGISTRY, deps())).rejects.toThrow("cannot run");
    expect((await installedRecord(packsDir, "acme-tool"))?.commit).toBe(good.commit);
  });

  it("replaces an older install with a newer commit", async () => {
    const { repo, dir } = await packRepo("acme-tool");
    await installPack(entry(repo, "acme-tool"), LOCAL_REGISTRY, deps());
    await writeFile(path.join(dir, "packs", "acme-tool", "NEW.md"), "new");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "update");
    const record = await installPack(entry(repo, "acme-tool"), LOCAL_REGISTRY, deps());
    expect(record.commit).toBe(git(dir, "rev-parse", "HEAD"));
    expect(existsSync(path.join(packsDir, "acme-tool", "NEW.md"))).toBe(true);
  });

  it("fails cleanly on a branch the repository does not have, leaving no staging behind", async () => {
    const { repo } = await packRepo("acme-tool");
    await expect(installPack(entry(repo, "acme-tool", { ref: "no-such-branch" }), LOCAL_REGISTRY, deps())).rejects.toThrow("git clone");
    expect(await readFileNames(packsDir)).toEqual([]);
  });

  it("uninstalls only what it installed", async () => {
    const { repo } = await packRepo("acme-tool");
    await installPack(entry(repo, "acme-tool"), LOCAL_REGISTRY, deps());
    expect(await uninstallPack(packsDir, "acme-tool")).toBe(true);
    expect(await uninstallPack(packsDir, "acme-tool")).toBe(false);
    expect(await uninstallPack(packsDir, "firebase")).toBe(false);
  });
});

const readFileNames = (dir: string): Promise<string[]> => readdir(dir).catch(() => []);

describe("registry entries", () => {
  it.each([
    ["a path that climbs out", { path: "../secrets" }],
    ["an absolute path", { path: "/etc" }],
    ["an ssh repository", { repo: "git@github.com:a/b.git" }],
    ["an http repository", { repo: "http://example.com/a.git" }],
    ["a ref that is an option", { ref: "--upload-pack=x" }],
    ["a bad slug", { slug: "Acme Tool" }],
  ])("refuses %s", (_label, patch) => {
    expect(registryEntrySchema.safeParse({ slug: "acme", kind: "usecase", title: "a", repo: "https://example.com/a.git", ...patch }).success).toBe(false);
  });
});

describe("registries", () => {
  const registry = JSON.stringify({
    name: "Acme",
    packs: [
      { slug: "acme-tool", kind: "usecase", title: "Acme", repo: "https://example.com/a.git" },
      { slug: "internal", kind: "usecase", title: "dup", repo: "https://example.com/b.git" },
    ],
  });

  it("reads a registry and marks what is shipped and what is installed", async () => {
    const catalog = await loadCatalog({
      urls: ["https://reg.example/r.json", "https://broken.example/r.json"],
      builtinSlugs: new Set(["internal"]),
      installed: async (slug) => (slug === "acme-tool" ? { slug, registryUrl: "u", repo: "r", ref: "main", commit: "abc", installedAtMs: 1 } : null),
      fetchImpl: async (url) => {
        if (url.includes("broken")) throw new Error("HTTP 404");
        return registry;
      },
    });
    expect(catalog.registries[0].packs.map((pack) => [pack.slug, pack.builtin, pack.installed?.commit ?? null])).toEqual([
      ["acme-tool", false, "abc"],
      ["internal", true, null],
    ]);
    expect(catalog.registries[1]).toMatchObject({ packs: [], error: expect.stringContaining("HTTP 404") });
  });

  it("names the registry when it is not a registry", async () => {
    await expect(fetchRegistry("https://reg.example/r.json", async () => "{}")).rejects.toThrow("registry https://reg.example/r.json");
  });

  it("stores the registry list, without duplicates, and refuses plain http elsewhere", async () => {
    const file = path.join(work, "registries.json");
    await writeRegistryUrls(file, ["https://a.example/r.json", "https://a.example/r.json", "http://localhost:8080/r.json"]);
    expect(await readRegistryUrls(file)).toEqual(["https://a.example/r.json", "http://localhost:8080/r.json"]);
    await expect(writeRegistryUrls(file, ["http://evil.example/r.json"])).rejects.toThrow();
    expect(JSON.parse(await readFile(file, "utf8")).urls).toHaveLength(2);
  });
});

describe.skipIf(process.platform === "win32")("installPack refuses links", { timeout: 60_000 }, () => {
  it("refuses a pack holding a symbolic link, however harmless it looks", async () => {
    const { dir } = await packRepo("acme-tool");
    await symlink("/etc/hosts", path.join(dir, "packs", "acme-tool", "skills", "go", "notes.md"));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "link");
    await expect(installPack(entry(`file://${dir}`, "acme-tool"), LOCAL_REGISTRY, deps())).rejects.toThrow("links, which are not allowed: skills/go/notes.md");
    expect(existsSync(path.join(packsDir, "acme-tool"))).toBe(false);
  });
});

describe.skipIf(process.platform === "win32")("installPack keeps packs inside what the registry may reach", { timeout: 60_000 }, () => {
  it("refuses a file:/// repository listed by a registry on the web", async () => {
    const { repo } = await packRepo("acme-tool");
    await expect(installPack(entry(repo, "acme-tool"), "https://reg.example/r.json", deps())).rejects.toThrow("cannot install from this machine's disk");
  });

  it("refuses a pack directory that is itself a link out of the repository", async () => {
    const outside = path.join(work, "outside-pack");
    await writePack(outside, "acme-tool");
    const dir = path.join(work, "repo-linked");
    await mkdir(path.join(dir, "packs"), { recursive: true });
    await symlink(outside, path.join(dir, "packs", "acme-tool"));
    git(work, "init", "-q", "-b", "main", dir);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "linked");
    await expect(installPack(entry(`file://${dir}`, "acme-tool"), LOCAL_REGISTRY, deps())).rejects.toThrow(InstallRefusal);
  });
});

describe("repoAllowedFor", () => {
  it.each([
    ["https://reg.example/r.json", "https://github.com/a/b.git", true],
    ["https://reg.example/r.json", "file:///Users/me/repo", false],
    ["http://127.0.0.1:8765/r.json", "file:///Users/me/repo", true],
    ["http://localhost/r.json", "file:///Users/me/repo", true],
    ["not a url", "file:///x", false],
  ])("%s may install %s: %s", (registryUrl, repo, expected) => {
    expect(repoAllowedFor(registryUrl, repo)).toBe(expected);
  });
});

describe.skipIf(process.platform === "win32")("installPack refuses a linked pack root", { timeout: 60_000 }, () => {
  it("refuses a pack directory that is a link to another directory inside the repository", async () => {
    const { dir } = await packRepo("acme-tool");
    await symlink("acme-tool", path.join(dir, "packs", "alias"));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "alias");
    await expect(installPack(entry(`file://${dir}`, "acme-tool", { path: "packs/alias" }), LOCAL_REGISTRY, deps())).rejects.toThrow("a link is not accepted");
  });
});
