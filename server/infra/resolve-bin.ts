// Windows-only PATH resolution for the binaries we hand to node-pty.
//
// node-pty gates a spawn on its OWN lookup (src/win/path_util.cc get_shell_path), which
// compares each PATH directory's file name EXACTLY — it never appends an executable
// extension. A bare "claude" therefore misses `…\.local\bin\claude.exe` and the spawn dies
// with `File not found: ` (nothing after the colon, since the path it failed to find is the
// empty string). Handing it an absolute path skips that lookup entirely (#794).
//
// node-pty then launches via `CreateProcessW(nullptr, cmdline, …)`, which runs PE images
// only. A batch shim — all an npm-global install leaves on PATH — therefore has to go
// through `cmd.exe` instead of being named directly (#798), which is why this resolves to a
// launch descriptor rather than to a path.
import { statSync } from "node:fs";
import path from "node:path";
import { envValue, pathFromEnv } from "./pty-env.js";
import { batchCommandLine } from "./cmd-escape.js";

// `.exe` first: with both present, a bare name would have reached the `.exe` (CreateProcess
// appends exactly that), so resolving must not silently switch which file runs.
const EXECUTABLE_EXTENSIONS = [".exe", ".com"] as const;
const BATCH_EXTENSIONS = [".cmd", ".bat"] as const;

const endsWithOneOf = (bin: string, extensions: readonly string[]): boolean => extensions.some((ext) => bin.toLowerCase().endsWith(ext));

// A name node-pty/CreateProcess already resolves on its own (absolute, or relative to a
// directory) rather than by searching PATH.
export const namesAPath = (bin: string): boolean => bin.includes("\\") || bin.includes("/");

// What node-pty is handed. `args` as a STRING is a raw command line that node-pty passes
// through verbatim (its argsToCommandLine only quotes an argv ARRAY) — which is what lets
// the cmd.exe wrapping below own its own quoting.
export type PtyLaunch = { file: string; args: string[] | string };

export function isExecutableFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

// A PATH entry may be quoted — `"C:\Program Files\tools"` — which the shells strip and a
// plain join would not, leaving a path that matches nothing.
export const windowsSearchDirectories = (searchPath: string | undefined): string[] =>
  (searchPath ?? "")
    .split(";")
    .map((entry) => entry.replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry !== "");

// The first `<dir>\<bin><ext>` that exists, over every PATH directory for one set of
// extensions. `find` is lazy, so it stops at the first hit.
function searchPathFor(bin: string, extensions: readonly string[], searchPath: string | undefined, fileExists: (candidate: string) => boolean): string | null {
  const names = endsWithOneOf(bin, extensions) ? [bin] : extensions.map((ext) => bin + ext);
  return (
    windowsSearchDirectories(searchPath)
      .flatMap((dir) => names.map((name) => path.win32.join(dir, name)))
      .find(fileExists) ?? null
  );
}

/** The absolute path of the executable a bare Windows command name refers to, or null when
 *  PATH holds no `.exe`/`.com` for it. Pure — `searchPath` and the existence check are
 *  parameters, and `path.win32` + ";" are used explicitly, so the rule is checkable from a
 *  POSIX host too. */
export function resolveWindowsExecutable(bin: string, searchPath: string | undefined, fileExists: (candidate: string) => boolean): string | null {
  if (bin === "" || namesAPath(bin)) return null;
  return searchPathFor(bin, EXECUTABLE_EXTENSIONS, searchPath, fileExists);
}

/** The absolute path of the batch shim a bare command name refers to, or null. Only ever
 *  consulted after `resolveWindowsExecutable` has come up empty ACROSS THE WHOLE PATH —
 *  deliberately not cmd.exe's per-directory order. An install whose shim sits in an earlier
 *  PATH directory than its real `.exe` runs the `.exe` today; moving it onto the cmd.exe
 *  path would add a parsing layer to a spawn that already works. */
export function resolveWindowsBatch(bin: string, searchPath: string | undefined, fileExists: (candidate: string) => boolean): string | null {
  if (bin === "" || namesAPath(bin)) return null;
  return searchPathFor(bin, BATCH_EXTENSIONS, searchPath, fileExists);
}

/** How to launch `bin args…`. Off Windows, and whenever nothing resolves, this is the
 *  arguments unchanged — a host that spawns fine today must keep spawning fine. */
export function resolvePtyLaunch(
  bin: string,
  args: string[],
  platform: NodeJS.Platform,
  searchPath: string | undefined,
  comspec: string | undefined,
  fileExists = isExecutableFile,
): PtyLaunch {
  if (platform !== "win32") return { file: bin, args };
  // A name that already names a path needs no PATH search — but CreateProcess still cannot
  // RUN a batch file, and `CLAUDE_BIN=C:\…\claude.cmd` is exactly what someone reaches for
  // when working around a broken spawn. Wrapped without an existence check: a relative path
  // is relative to the PTY's cwd, not this process's, so checking here would ask the wrong
  // directory — and cmd.exe naming the path it cannot find beats node-pty's empty message.
  if (namesAPath(bin)) {
    if (!endsWithOneOf(bin, BATCH_EXTENSIONS)) return { file: bin, args };
    return { file: commandProcessor(comspec, searchPath, fileExists), args: batchCommandLine(bin, args) };
  }
  const executable = resolveWindowsExecutable(bin, searchPath, fileExists);
  if (executable) return { file: executable, args };
  const batch = resolveWindowsBatch(bin, searchPath, fileExists);
  if (batch) return { file: commandProcessor(comspec, searchPath, fileExists), args: batchCommandLine(batch, args) };
  return { file: bin, args };
}

// ComSpec is where Windows itself records the command processor; falling back to a PATH
// lookup (and then to the bare name) keeps a stripped environment working.
function commandProcessor(comspec: string | undefined, searchPath: string | undefined, fileExists: (candidate: string) => boolean): string {
  if (comspec && namesAPath(comspec) && fileExists(comspec)) return comspec;
  return resolveWindowsExecutable("cmd.exe", searchPath, fileExists) ?? "cmd.exe";
}

/** `resolvePtyLaunch` against the environment the session itself will run with: the binary
 *  that matters is the one reachable from the child's PATH, not the server's. */
export function resolvePtyLaunchForEnv(bin: string, args: string[], env: NodeJS.ProcessEnv): PtyLaunch {
  return resolvePtyLaunch(bin, args, process.platform, pathFromEnv(env), envValue(env, "ComSpec"));
}
