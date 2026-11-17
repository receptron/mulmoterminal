// A rooted gui-chat-protocol `FileOps` over one directory, with the containment
// guard in a single place. Used for the shared artifacts area (backends/plugins/artifacts.ts)
// and for each plugin's private data/config areas (infra/tools/pluginRuntime.ts) — every
// caller-supplied `rel` is resolved against the root and rejected if it escapes, so
// a plugin can never read or write outside the area it was handed.
//
// Two layers guard containment: a cheap lexical check rejects `..` / absolute inputs,
// then a realpath check resolves symlinks in any existing path component and confirms
// the true target is still inside the root. FileOps exposes no symlink-creation
// primitive, so a plugin can't plant one itself — the realpath layer is defence against
// a symlink placed by something else (a dependency, another process) from being followed
// out of the sandbox.
//
// Those checks answer, and then the operation acts by name, so a folder swapped for a link out in
// between would carry it out (#3306). The contents — read, readBytes, write — therefore go through
// @mulmoclaude/core's verified open and write, as MulmoClaude's confined ops do: a read proves the
// open handle is the in-root file, and a write verifies its staging file before renaming it into
// place. The anchor is the root's own realpath, so a ROOT replaced by a link is not caught, as
// before. stat and readDir check again once they have read; exists and unlink stay check-then-act.
// The parent folders a write creates are made one level at a time and checked after each
// (verifiedMkdir.ts): a swap can leave one empty folder outside, and the write then stops.
//
// `rootFor` is invoked PER OPERATION rather than captured: the workspace is injected
// at boot, after these ops are already bound into the plugin registry's closures.
import fs from "fs/promises";
import { realpathSync } from "node:fs";
import path from "path";
import type { FileOps } from "gui-chat-protocol";
import { openVerifiedWithinScope, realpathIfPresent, resolveExistingWithinRoot, writeFileVerifiedInScope, type VerifiedScope } from "@mulmoclaude/core/files";
import { isWithin } from "../../infra/fs/path-within.js";
import { realContainedWithin } from "../../files/pathContainment.js";
import { makeFoldersVerified } from "../../files/verifiedMkdir.js";

const MAX_SYMLINK_DEPTH = 40;

async function readlinkOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readlink(p);
  } catch {
    return null;
  }
}

// realpath, but tolerant of a not-yet-created leaf/dir: resolve the deepest existing
// ancestor's real path, then re-append the missing tail lexically. `fs.realpath`
// throws on a BROKEN symlink (existing link, missing target), so that case is handled
// explicitly by following the link's target — treating it as a plain missing file would
// let a dangling symlink pointing outside the root slip past the containment check.
async function realpathAllowingMissing(p: string, depth = 0): Promise<string> {
  if (depth > MAX_SYMLINK_DEPTH) throw new Error("too many symlink levels");
  try {
    // .native, for the Windows 8.3 reason in files/pathContainment.ts: the JS implementation
    // leaves `C:\Users\RUNNER~1` alone where the native one expands it, and a containment check
    // comparing the two spellings never matches. fs/promises has no native variant.
    return realpathSync.native(p);
  } catch {
    const link = await readlinkOrNull(p);
    if (link !== null) return realpathAllowingMissing(path.resolve(path.dirname(p), link), depth + 1);
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(await realpathAllowingMissing(parent, depth), path.basename(p));
  }
}

const anchoredAt = (rootReal: string): VerifiedScope => ({ trustedReal: rootReal, scopeWithinTrusted: "" });

/** `abs`'s bytes, read only through a handle proven to be the in-root file; null when it is missing,
 *  outside, or swapped during the call — all of which a caller sees as ENOENT, so one treating a
 *  missing file as "not there" stays closed. */
async function readVerifiedFile(root: string, abs: string): Promise<Buffer | null> {
  const rootReal = await realpathIfPresent(root);
  const handle = rootReal === null ? null : await openVerifiedWithinScope(anchoredAt(rootReal), path.relative(root, abs));
  if (handle === null) return null;
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** Write to `realAbs`, the real place the check found, so a link is written THROUGH (its target is
 *  replaced or created) rather than replaced itself. False when its folder is not in the root now. */
async function writeVerifiedFile(realRoot: string, realAbs: string, content: string | Uint8Array): Promise<boolean> {
  const dirReal = await resolveExistingWithinRoot(realRoot, path.relative(realRoot, path.dirname(realAbs)));
  if (dirReal === null) return false;
  await writeFileVerifiedInScope(anchoredAt(realRoot), dirReal, path.basename(realAbs), content);
  return true;
}

/** `dir` and its missing parents, the root made as asked and every level below it checked once made. */
async function makeParentFolders(root: string, dir: string, rel: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  if (makeFoldersVerified(dir, (abs) => realContainedWithin(root, abs)) === "escaped") {
    throw new Error(`path escapes its root via symlink while making its folders: ${rel}`);
  }
}

// A listing or a stat has no descriptor to compare, so the check is asked again once it has been read,
// and the root must still be the folder it was when the operation began: one taken through a folder —
// or the root itself — swapped for a link out, still in place, throws rather than reaching the plugin
// (#3306). A swap undone before then is not seen.
function metadataOps(containedPaths: ContainedPaths, escapedVia: (rel: string) => Error): Pick<FileOps, "readDir" | "stat"> {
  const readThenCheck = async <T>(rel: string, read: (abs: string) => Promise<T>): Promise<T> => {
    const { abs, realRoot } = await containedPaths(rel);
    const value = await read(abs);
    if ((await containedPaths(rel)).realRoot !== realRoot) throw escapedVia(rel);
    return value;
  };
  return {
    readDir: (rel) => readThenCheck(rel, (abs) => fs.readdir(abs)),
    stat: (rel) =>
      readThenCheck(rel, async (abs) => {
        const { mtimeMs, size } = await fs.stat(abs);
        return { mtimeMs, size };
      }),
  };
}

/** `rel` checked, as the path it was asked by and as the real place it lands (links followed). */
type ContainedPaths = (rel: string) => Promise<{ abs: string; realRoot: string; realAbs: string }>;

export function createFileOps(rootFor: () => string, label: string): FileOps {
  const lexicalAbs = (rel: string): { root: string; abs: string } => {
    const root = path.resolve(rootFor());
    const abs = path.resolve(root, rel);
    if (!isWithin(root, abs)) {
      throw new Error(`${label} path escapes its root: ${rel}`);
    }
    return { root, abs };
  };

  const escapedVia = (rel: string): Error => new Error(`${label} path escapes its root via symlink: ${rel}`);

  const containedPaths: ContainedPaths = async (rel) => {
    const { root, abs } = lexicalAbs(rel);
    const [realRoot, realAbs] = await Promise.all([realpathAllowingMissing(root), realpathAllowingMissing(abs)]);
    if (!isWithin(realRoot, realAbs)) throw escapedVia(rel);
    return { abs, realRoot, realAbs };
  };

  const safeAbs = async (rel: string): Promise<string> => (await containedPaths(rel)).abs;

  const readVerified = async (rel: string): Promise<Buffer> => {
    const bytes = await readVerifiedFile(path.resolve(rootFor()), await safeAbs(rel));
    if (bytes === null) throw Object.assign(new Error(`${label} file is not inside its root: ${rel}`), { code: "ENOENT" });
    return bytes;
  };

  const writeVerified = async (rel: string, content: string | Uint8Array): Promise<void> => {
    const { abs } = await containedPaths(rel);
    await makeParentFolders(path.resolve(rootFor()), path.dirname(abs), rel);
    const { realRoot, realAbs } = await containedPaths(rel);
    if (!(await writeVerifiedFile(realRoot, realAbs, content))) throw escapedVia(rel);
  };

  return {
    async read(rel) {
      return (await readVerified(rel)).toString("utf8");
    },
    async readBytes(rel) {
      return new Uint8Array(await readVerified(rel));
    },
    async write(rel, content) {
      await writeVerified(rel, content);
    },
    ...metadataOps(containedPaths, escapedVia),
    async exists(rel) {
      // safeAbs runs before the try so an escaping path still throws — the catch is
      // only meant to turn a missing file into `false`.
      const abs = await safeAbs(rel);
      try {
        await fs.access(abs);
        return true;
      } catch {
        return false;
      }
    },
    async unlink(rel) {
      await fs.rm(await safeAbs(rel), { force: true });
    },
  };
}
