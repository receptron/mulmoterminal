// A rooted gui-chat-protocol `FileOps` over one directory, with the containment
// guard in a single place. Used for the shared artifacts area (backends/artifacts.ts)
// and for each plugin's private data/config areas (infra/pluginRuntime.ts) — every
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
// `rootFor` is invoked PER OPERATION rather than captured: the workspace is injected
// at boot, after these ops are already bound into the plugin registry's closures.
import fs from "fs/promises";
import path from "path";
import type { FileOps } from "gui-chat-protocol";

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
    return await fs.realpath(p);
  } catch {
    const link = await readlinkOrNull(p);
    if (link !== null) return realpathAllowingMissing(path.resolve(path.dirname(p), link), depth + 1);
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(await realpathAllowingMissing(parent, depth), path.basename(p));
  }
}

export function createFileOps(rootFor: () => string, label: string): FileOps {
  const lexicalAbs = (rel: string): { root: string; abs: string } => {
    const root = path.resolve(rootFor());
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`${label} path escapes its root: ${rel}`);
    }
    return { root, abs };
  };

  const safeAbs = async (rel: string): Promise<string> => {
    const { root, abs } = lexicalAbs(rel);
    const [realRoot, realAbs] = await Promise.all([realpathAllowingMissing(root), realpathAllowingMissing(abs)]);
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
      throw new Error(`${label} path escapes its root via symlink: ${rel}`);
    }
    return abs;
  };

  return {
    async read(rel) {
      return fs.readFile(await safeAbs(rel), "utf8");
    },
    async readBytes(rel) {
      return new Uint8Array(await fs.readFile(await safeAbs(rel)));
    },
    async write(rel, content) {
      const abs = await safeAbs(rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    },
    async readDir(rel) {
      return fs.readdir(await safeAbs(rel));
    },
    async stat(rel) {
      const s = await fs.stat(await safeAbs(rel));
      return { mtimeMs: s.mtimeMs, size: s.size };
    },
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
