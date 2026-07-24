// Turning a confusing crash into a one-line fix. When an `npx mulmoterminal` install is
// aborted mid-unpack (npm's npx lock race — `ECOMPROMISED: Lock compromised`), the next run
// reuses the half-unpacked `~/.npm/_npx/<hash>/node_modules` and dies at boot with
// ERR_MODULE_NOT_FOUND for some transitive dependency. That reads as a broken package, but
// the published tarball is fine — the local npx cache entry is corrupted, and removing it
// is the whole fix. Nothing here reads the filesystem; the caller feeds it stderr text.

const MISSING_MODULE = /ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/;

// The cache entry itself: `<sep>_npx<sep><hash>` followed by another separator. Anchored on
// the literal `_npx` rather than on a leading `[^\s'"]*` wildcard — that prefix can also match
// separators, which makes the match ambiguous and the regex backtrack super-linearly on a long
// stack trace. The directory part before it is recovered by scanning, not by matching.
const NPX_ENTRY = /[/\\]_npx[/\\][0-9a-f]+(?=[/\\])/;

// What ends the path token a stack trace embeds: whitespace, or the quotes Node wraps
// specifiers in.
const PATH_BOUNDARIES = [" ", "\t", "\n", "\r", "'", '"'];

// Where the path token containing the entry begins: just past the last boundary before it.
const pathStartIndex = (textBefore) => Math.max(-1, ...PATH_BOUNDARIES.map((ch) => textBefore.lastIndexOf(ch))) + 1;

/**
 * The corrupted npx cache entry a failed boot points at, or null.
 * Fires only when BOTH signals are present — a module-resolution error and a path inside
 * an `_npx/<hash>` cache entry — so an ordinary crash, or a resolution error in a normal
 * install, never triggers the hint.
 */
export function detectNpxCacheDir(stderrText) {
  if (typeof stderrText !== "string" || !MISSING_MODULE.test(stderrText)) return null;
  const match = NPX_ENTRY.exec(stderrText);
  if (!match) return null;
  return stderrText.slice(pathStartIndex(stderrText.slice(0, match.index)), match.index + match[0].length);
}

// Shell-quote the cache dir so a path containing quote characters (a home dir with an
// apostrophe on POSIX is the realistic case) produces a command that is still valid — and
// safe — to copy-paste, rather than one that breaks or runs something unintended.

// POSIX single-quoting: wrap in '…' and turn every embedded ' into '\'' (close, escaped
// quote, reopen). Nothing inside single quotes is special, so this is injection-proof.
const posixQuote = (s) => `'${s.replace(/'/g, "'\\''")}'`;

// PowerShell single-quoting: '…' with each ' doubled. Single quotes suppress $-interpolation
// (a double-quoted path containing $ would otherwise expand a variable), so this is safe.
const powershellQuote = (s) => `'${s.replace(/'/g, "''")}'`;

// cmd has no way to escape a " inside "…", but " is an illegal character in a Windows path,
// so double-quoting a real cache dir is safe; it protects the spaces that do occur.
const cmdQuote = (s) => `"${s}"`;

// The delete command differs per platform, and a wrong one is worse than none: `rm -rf` is not
// a command on Windows, and cmd's `rmdir /s /q` is a syntax error in PowerShell (where `rmdir`
// aliases Remove-Item), so Windows gets both of its shells spelled out.
const removalCommands = (cacheDir, platform) =>
  platform === "win32"
    ? [`  cmd:        rmdir /s /q ${cmdQuote(cacheDir)}`, `  PowerShell: Remove-Item -Recurse -Force ${powershellQuote(cacheDir)}`]
    : [`  rm -rf ${posixQuote(cacheDir)}`];

/** The recovery instructions shown under the crash, one string per line. */
export function npxCacheHintLines(cacheDir, platform) {
  return [
    "This looks like a corrupted npx cache, not a MulmoTerminal bug.",
    'An interrupted `npx` install (npm\'s "Lock compromised" race) can leave this entry half-unpacked:',
    `  ${cacheDir}`,
    "Remove it and run the same command again:",
    ...removalCommands(cacheDir, platform),
  ];
}
