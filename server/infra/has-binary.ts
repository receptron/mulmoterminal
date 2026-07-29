// Whether a command could be launched at all — and if not, WHY — without launching it.
//
// Pulled out of whisper.ts (#1011) because a second caller needed the same question and the two
// must not drift: the rate-limit probe asks it BEFORE spawning, so that a machine with no `claude`
// costs a PATH lookup instead of a spawn attempt per poll.
//
// Windows is why this is not a one-line existsSync: `claude` installed by npm is `claude.cmd`, and
// a bare name never matches a file on disk there. resolve-bin.ts already owns that rule for the
// spawn path, and reusing it keeps "can we launch it" and "what do we launch" answering the same
// way — a check that said yes where the spawn then said no would be worse than no check.
//
// The reason, not just the yes/no, is what #1063 needed. On macOS node-pty never looks at the
// binary: it posix_spawnp's its own spawn-helper, which execvp's the name in the CHILD, so every
// way a binary can be unusable — absent, not executable, a directory, a dangling symlink —
// arrives as a child exit code and nothing is thrown. A spawn site therefore cannot learn from
// its own failure what went wrong, and the one that guessed reported "not installed" for
// everything. Asking here, before the spawn, is the only place the answer exists.

import { accessSync, constants } from "node:fs";
import path from "node:path";
import { isExecutableFile, namesAPath, resolveWindowsBatch, resolveWindowsExecutable, windowsSearchDirectories } from "./resolve-bin.js";
import { pathFromEnv } from "./pty-env.js";

/** Why a named command could or could not be launched.
 *
 *  `missing` and `no-such-path` are separate because the ADVICE is opposite. A PATH miss carries
 *  the directories that were looked in, so the report can show the PATH it actually used rather
 *  than the one the reader assumes, and the fix is to set the override. A named path that isn't
 *  there is someone who already set the override — telling them to set it is the wrong sentence
 *  entirely. */
export type BinaryDiagnosis =
  | { kind: "ok"; path: string }
  | { kind: "missing"; searched: readonly string[] }
  | { kind: "no-such-path"; path: string }
  | { kind: "not-executable"; path: string };

/** The filesystem questions this asks, injected so the rules — including the Windows ones — are
 *  checkable from any host. */
export interface BinaryProbe {
  /** An existing regular file, symlinks followed (so a dangling link reads as absent, which is
   *  what execvp sees too). */
  isFile: (candidate: string) => boolean;
  /** Does this process have execute permission on it? */
  isExecutable: (candidate: string) => boolean;
}

const canExecute = (candidate: string): boolean => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const fsBinaryProbe: BinaryProbe = { isFile: isExecutableFile, isExecutable: canExecute };

// execvp's own rule: walk PATH in order and take the first entry that is a file this process can
// actually run. A directory or a non-executable file earlier on PATH does not shadow a working one
// later, so either is only reported when NOTHING runnable was found.
//
// `path.posix` throughout rather than the host's `path`, for the reason resolve-bin gives: a rule
// written against the running host cannot be checked from the other one, and the platform this
// most needs checking on is the one hardest to get onto a CI runner.
//
// Two ways PATH does not mean what reading it here would suggest, and BOTH have to end in `ok`,
// because this verdict now REFUSES the spawn — a preflight that cannot answer must never be the
// thing that says no:
//
//   - An entry that is not ABSOLUTE is resolved by execvp against the child's working directory,
//     and the child's is the PTY's, not ours. That covers a plainly relative entry (`tools`, `.`,
//     `../bin`) and the empty one, which POSIX reads as the current directory (`PATH=/usr/bin:`,
//     `/a::/b`) — measured: with `PATH=tools` and a pty cwd elsewhere, the binary launches while
//     probing `tools/…` from this process finds nothing. Same reason a relative `bin` is passed
//     through untested below.
//   - An UNSET PATH is not an empty one. execvp falls back to its own built-in default
//     (confstr _CS_PATH, typically /usr/bin:/bin), which this process cannot enumerate.
function diagnosePosixName(bin: string, searchPath: string | undefined, probe: BinaryProbe): BinaryDiagnosis {
  if (searchPath === undefined) return { kind: "ok", path: bin };
  const entries = searchPath.split(path.posix.delimiter);
  const dirs = entries.filter((entry) => path.posix.isAbsolute(entry));
  const candidates = dirs.map((dir) => path.posix.join(dir, bin));
  const runnable = candidates.find((candidate) => probe.isFile(candidate) && probe.isExecutable(candidate));
  if (runnable) return { kind: "ok", path: runnable };
  if (dirs.length !== entries.length) return { kind: "ok", path: bin };
  const present = candidates.find((candidate) => probe.isFile(candidate));
  return present ? { kind: "not-executable", path: present } : { kind: "missing", searched: dirs };
}

// Windows has no execute BIT: what CreateProcess will run is decided by file TYPE, and
// resolve-bin already encodes that (a `.exe`/`.com` directly, a `.cmd`/`.bat` through cmd.exe).
// So a file that resolves here is one Windows will at least try to run, and there is deliberately
// no not-executable verdict — inventing one would refuse spawns that work today.
//
// The extension-less fallback is not thoroughness, it is the rule resolve-bin states: whenever
// nothing resolves it hands node-pty the bare name unchanged, "a host that spawns fine today must
// keep spawning fine". node-pty's own lookup compares file names EXACTLY, so a PE image on PATH
// named `codex` with no extension is one it finds and this would otherwise refuse — and refusing a
// working spawn from a host that cannot be reproduced here is worse than the message it replaces.
function diagnoseWindowsName(bin: string, searchPath: string | undefined, probe: BinaryProbe): BinaryDiagnosis {
  const isFile = (candidate: string) => probe.isFile(candidate);
  const dirs = windowsSearchDirectories(searchPath);
  const found =
    resolveWindowsExecutable(bin, searchPath, isFile) ??
    resolveWindowsBatch(bin, searchPath, isFile) ??
    dirs.map((dir) => path.win32.join(dir, bin)).find(isFile);
  return found ? { kind: "ok", path: found } : { kind: "missing", searched: dirs };
}

// A name that already names a path skips the PATH search — but a RELATIVE one resolves against
// the PTY's cwd, not ours, so it cannot be answered from here at all. Reported as ok for the same
// reason resolve-bin wraps one without checking: the spawn's own error names the right directory,
// and refusing on a guess would break a setup that works.
function diagnosePathName(bin: string, platform: NodeJS.Platform, probe: BinaryProbe): BinaryDiagnosis {
  const rules = platform === "win32" ? path.win32 : path.posix;
  if (!rules.isAbsolute(bin)) return { kind: "ok", path: bin };
  if (!probe.isFile(bin)) return { kind: "no-such-path", path: bin };
  if (platform === "win32") return { kind: "ok", path: bin };
  return probe.isExecutable(bin) ? { kind: "ok", path: bin } : { kind: "not-executable", path: bin };
}

/** `bin` may be a bare command name or a path. `env` must be the environment the SPAWN will get,
 *  not `process.env`: sanitizePtyEnv drops PATH entries (a `node_modules/.bin`, a yarn shim dir),
 *  so the two disagree on exactly the machines where this matters. */
export function diagnoseBinary(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  probe: BinaryProbe = fsBinaryProbe,
): BinaryDiagnosis {
  if (!bin) return { kind: "missing", searched: [] };
  if (namesAPath(bin)) return diagnosePathName(bin, platform, probe);
  const searchPath = pathFromEnv(env);
  return platform === "win32" ? diagnoseWindowsName(bin, searchPath, probe) : diagnosePosixName(bin, searchPath, probe);
}

/** Whether a command could be launched at all. A file that is present but not runnable answers
 *  NO — the caller's next move is to spawn it, and "present" is not what that needs to know. */
export function hasBinary(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  probe: BinaryProbe = fsBinaryProbe,
): boolean {
  return diagnoseBinary(bin, env, platform, probe).kind === "ok";
}

// Enough directories for a reader to recognise which PATH they are looking at, without pasting
// forty entries into a terminal banner. The full list goes to the server log.
const LISTED_DIRECTORIES = 4;

const listDirectories = (dirs: readonly string[]): string =>
  dirs.length <= LISTED_DIRECTORIES ? dirs.join(", ") : `${dirs.slice(0, LISTED_DIRECTORIES).join(", ")}, +${dirs.length - LISTED_DIRECTORIES} more`;

/** What to tell the user, or null when nothing is wrong. `envVar` names the per-agent override
 *  (CODEX_BIN) so the message carries its own escape hatch. */
export function binaryProblemMessage(bin: string, diagnosis: BinaryDiagnosis, envVar: string): string | null {
  if (diagnosis.kind === "ok") return null;
  if (diagnosis.kind === "no-such-path") {
    // Whoever sees this has ALREADY set the override — a "set it to the full path" hint would be
    // telling them to do the thing that put them here.
    return `There is no file at ${diagnosis.path}, so nothing can be started from it. Correct ${envVar}, or unset it to look the command up on PATH instead.`;
  }
  if (diagnosis.kind === "not-executable") {
    // Naming the path is only worth it when the search FOUND it somewhere — with `${envVar}` set
    // to a full path the two are the same string, and saying it twice reads like a second file.
    const found = bin === diagnosis.path ? `\`${bin}\`` : `\`${bin}\` (found at ${diagnosis.path})`;
    return `${found} is not an executable file, so it cannot be started. Check its permissions, or set ${envVar} to one that can run.`;
  }
  // Naming the PATH is the point: this fires most often when the two differ — MulmoTerminal
  // started from an app or a launcher inherits a minimal PATH, while the user's login shell has
  // nvm/nodebrew/homebrew on it and `which` therefore succeeds in their terminal.
  const where = diagnosis.searched.length === 0 ? "an empty PATH" : `PATH: ${listDirectories(diagnosis.searched)}`;
  return `\`${bin}\` is not on the PATH this server spawns with, so it cannot be started (${where}). It may be installed only in your login shell's PATH — start MulmoTerminal from a terminal where \`which ${bin}\` works, or set ${envVar} to its full path.`;
}
