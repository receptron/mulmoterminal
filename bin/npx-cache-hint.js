// Turning a confusing crash into a one-line fix. When an `npx mulmoterminal` install is
// aborted mid-unpack (npm's npx lock race — `ECOMPROMISED: Lock compromised`), the next run
// reuses the half-unpacked `~/.npm/_npx/<hash>/node_modules` and dies at boot with
// ERR_MODULE_NOT_FOUND for some transitive dependency. That reads as a broken package, but
// the published tarball is fine — the local npx cache entry is corrupted, and removing it
// is the whole fix. Nothing here reads the filesystem; the caller feeds it stderr text.

const MISSING_MODULE = /ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/;

// A path is only interesting up to its npx cache entry: `<...>/_npx/<hash>`. Both path
// separators appear in the wild (Windows stacks mix them), so match either.
const NPX_CACHE_DIR = /((?:[A-Za-z]:)?[^\s'"]*[/\\]_npx[/\\][0-9a-f]+)(?=[/\\])/;

/**
 * The corrupted npx cache entry a failed boot points at, or null.
 * Fires only when BOTH signals are present — a module-resolution error and a path inside
 * an `_npx/<hash>` cache entry — so an ordinary crash, or a resolution error in a normal
 * install, never triggers the hint.
 */
export function detectNpxCacheDir(stderrText) {
  if (typeof stderrText !== "string" || !MISSING_MODULE.test(stderrText)) return null;
  const match = NPX_CACHE_DIR.exec(stderrText);
  return match ? match[1] : null;
}

/** The recovery instructions shown under the crash, one string per line. */
export function npxCacheHintLines(cacheDir) {
  return [
    "This looks like a corrupted npx cache, not a MulmoTerminal bug.",
    'An interrupted `npx` install (npm\'s "Lock compromised" race) can leave this entry half-unpacked:',
    `  ${cacheDir}`,
    "Remove it and run the same command again:",
    `  rm -rf '${cacheDir}'`,
  ];
}
