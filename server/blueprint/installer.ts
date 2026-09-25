// Installing a pack a registry lists: clone it into a staging directory beside the installed packs,
// check it with the same rules a shipped pack is held to, and only then swap it in. A pack that
// fails any check leaves whatever was installed before untouched.
//
// An installed pack's check scripts run as the user, exactly like a shipped pack's. That is what
// installing one means; the market says so before it is done.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { writeFileAtomic } from "../files/atomic-write.js";
import { spawnCollect } from "../git/spawn-collect.js";
import { packProblems, readManifest } from "./packs.js";
import { installRecordSchema, repoAllowedFor, type InstallRecord, type RegistryEntry } from "../../common/blueprint/registry.js";

// A shallow clone of a pack repository; one that takes longer is stuck on the network or a prompt.
export const CLONE_TIMEOUT_MS = 120_000;
const RECORD_FILE = ".blueprint-install.json";

export type CloneRepo = (repo: string, ref: string, dest: string) => Promise<string>;

async function git(args: string[], cwd?: string): Promise<string> {
  // No prompt can be answered here, so a repository asking for credentials fails instead of hanging.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const result = await spawnCollect("git", args, { ...(cwd ? { cwd } : {}), env, timeoutMs: CLONE_TIMEOUT_MS, errorStderr: "git could not be started" });
  if (!result.ok) throw new Error(`git ${args[0] ?? ""}: ${result.stderr.trim() || "failed"}`);
  return result.stdout.trim();
}

/** Shallow-clones `ref` of `repo` into `dest` and returns the commit it got. */
export const cloneRepo: CloneRepo = async (repo, ref, dest) => {
  await git(["clone", "--depth", "1", "--branch", ref, "--", repo, dest]);
  return git(["rev-parse", "HEAD"], dest);
};

export interface InstallDeps {
  packsDir: string;
  builtinSlugs: ReadonlySet<string>;
  clone: CloneRepo;
  now: () => number;
}

export class InstallRefusal extends Error {}

const isInside = (child: string, parent: string): boolean => child === parent || child.startsWith(`${parent}${path.sep}`);

// Where the listed directory is, refused if it is a link or reaches out of the repository.
async function locateSource(entry: RegistryEntry, checkout: string): Promise<string> {
  const source = path.resolve(checkout, entry.path);
  const [realCheckout, realSource, info] = await Promise.all([realpath(checkout), realpath(source).catch(() => source), lstat(source).catch(() => null)]);
  if (!isInside(source, checkout) || !isInside(realSource, realCheckout)) throw new InstallRefusal(`path ${entry.path} leaves the repository`);
  if (!info?.isDirectory()) throw new InstallRefusal(`${entry.path || "the repository root"} is not a directory (a link is not accepted)`);
  return source;
}

// Checked AFTER the copy, on the copy: what is checked is exactly what gets installed.
async function checkStaged(entry: RegistryEntry, staged: string): Promise<void> {
  const links = await linksIn(staged);
  if (links.length > 0)
    throw new InstallRefusal(`the pack contains links, which are not allowed: ${links.map((link) => path.relative(staged, link)).join(", ")}`);
  const manifest = await readManifest(staged).catch((err: unknown) => {
    throw new InstallRefusal(`no readable manifest.json at ${entry.path || "the repository root"}: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (manifest.slug !== entry.slug || manifest.kind !== entry.kind) {
    throw new InstallRefusal(`the registry lists ${entry.kind} "${entry.slug}" but the repository holds ${manifest.kind} "${manifest.slug}"`);
  }
  const problems = await packProblems(staged);
  if (problems.length > 0) throw new InstallRefusal(`the pack cannot run: ${problems.join("; ")}`);
}

/** The swap failed AND the old version could not be put back; it is left at `previous`. */
class StrandedPrevious extends Error {}

async function swapIn(staged: string, target: string, staging: string): Promise<void> {
  const previous = path.join(staging, "previous");
  const hadPrevious = await rename(target, previous).then(
    () => true,
    () => false,
  );
  try {
    await rename(staged, target);
  } catch (err) {
    if (!hadPrevious) throw err;
    await rename(previous, target).catch((restoreErr: unknown) => {
      throw new StrandedPrevious(`could not install, nor restore the previous version — it is at ${previous}`, { cause: restoreErr });
    });
    throw err;
  }
}

// A link in a pack could point its agent at any file on this machine (a SKILL.md linked to a key),
// and a copy keeps links as links. A pack is plain files, so any link at all is refused.
async function linksIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) return [full];
      return entry.isDirectory() ? linksIn(full) : [];
    }),
  );
  return nested.flat();
}

export async function installPack(entry: RegistryEntry, registryUrl: string, deps: InstallDeps): Promise<InstallRecord> {
  if (deps.builtinSlugs.has(entry.slug)) throw new InstallRefusal(`"${entry.slug}" is a pack shipped with MulmoTerminal and cannot be replaced`);
  if (!repoAllowedFor(registryUrl, entry.repo)) throw new InstallRefusal(`a registry on the web cannot install from this machine's disk (${entry.repo})`);
  await mkdir(deps.packsDir, { recursive: true });
  const staging = path.join(deps.packsDir, `.staging-${randomUUID()}`);
  let keepStaging = false;
  try {
    const checkout = path.join(staging, "checkout");
    const commit = await deps.clone(entry.repo, entry.ref, checkout);
    const source = await locateSource(entry, checkout);
    const staged = path.join(staging, "pack");
    await cp(source, staged, { recursive: true, verbatimSymlinks: true, filter: (from) => path.basename(from) !== ".git" });
    await checkStaged(entry, staged);
    const record: InstallRecord = { slug: entry.slug, registryUrl, repo: entry.repo, ref: entry.ref, commit, installedAtMs: deps.now() };
    await writeFileAtomic(path.join(staged, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`);
    await swapIn(staged, path.join(deps.packsDir, entry.slug), staging).catch((err: unknown) => {
      keepStaging = err instanceof StrandedPrevious;
      throw err;
    });
    return record;
  } finally {
    if (!keepStaging) await rm(staging, { recursive: true, force: true });
  }
}

export async function installedRecord(packsDir: string, slug: string): Promise<InstallRecord | null> {
  try {
    return installRecordSchema.parse(JSON.parse(await readFile(path.join(packsDir, slug, RECORD_FILE), "utf8")));
  } catch {
    return null;
  }
}

/** Removes an installed pack. Shipped packs are not in this directory and cannot be named here. */
export async function uninstallPack(packsDir: string, slug: string): Promise<boolean> {
  if (!(await installedRecord(packsDir, slug))) return false;
  await rm(path.join(packsDir, slug), { recursive: true, force: true });
  return true;
}
