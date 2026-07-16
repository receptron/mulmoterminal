// A rooted gui-chat-protocol `FileOps` over one directory, with the containment
// guard in a single place. Used for the shared artifacts area (backends/artifacts.ts)
// and for each plugin's private data/config areas (infra/pluginRuntime.ts) — every
// caller-supplied `rel` is resolved against the root and rejected if it escapes, so
// a plugin can never read or write outside the area it was handed.
//
// `rootFor` is invoked PER OPERATION rather than captured: the workspace is injected
// at boot, after these ops are already bound into the plugin registry's closures.
import fs from "fs/promises";
import path from "path";
import type { FileOps } from "gui-chat-protocol";

export function createFileOps(rootFor: () => string, label: string): FileOps {
  const absFor = (rel: string): string => {
    const root = path.resolve(rootFor());
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`${label} path escapes its root: ${rel}`);
    }
    return abs;
  };
  return {
    async read(rel) {
      return fs.readFile(absFor(rel), "utf8");
    },
    async readBytes(rel) {
      return new Uint8Array(await fs.readFile(absFor(rel)));
    },
    async write(rel, content) {
      const abs = absFor(rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    },
    async readDir(rel) {
      return fs.readdir(absFor(rel));
    },
    async stat(rel) {
      const s = await fs.stat(absFor(rel));
      return { mtimeMs: s.mtimeMs, size: s.size };
    },
    async exists(rel) {
      // Resolved outside the try so an escaping path still throws — the catch is
      // only meant to turn a missing file into `false`.
      const abs = absFor(rel);
      try {
        await fs.access(abs);
        return true;
      } catch {
        return false;
      }
    },
    async unlink(rel) {
      await fs.rm(absFor(rel), { force: true });
    },
  };
}
