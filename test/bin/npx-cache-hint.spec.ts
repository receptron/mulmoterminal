import { describe, expect, it } from "vitest";

import { detectNpxCacheDir, npxCacheHintLines } from "../../bin/npx-cache-hint.js";

// The stderr of the real 1.7.0 incident: an install aborted by npm's npx lock race left
// `compress-commons` half-unpacked, and the next boot died resolving it.
const REAL_CRASH = `node:internal/modules/esm/resolve:204
  const resolvedOption = FSLegacyMainResolve(pkgPath, packageConfig.main, baseStringified);
                         ^

Error: Cannot find package '/Users/isamu/.npm/_npx/b492274026eba8a2/node_modules/compress-commons/index.js' imported from /Users/isamu/.npm/_npx/b492274026eba8a2/node_modules/zip-stream/index.js
    at legacyMainResolve (node:internal/modules/esm/resolve:204:26)
  code: 'ERR_MODULE_NOT_FOUND'
`;

describe("detectNpxCacheDir", () => {
  it("extracts the cache entry from the real incident stderr", () => {
    expect(detectNpxCacheDir(REAL_CRASH)).toBe("/Users/isamu/.npm/_npx/b492274026eba8a2");
  });

  it("detects a Windows-style cache path", () => {
    const text = "Error: Cannot find module 'C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\0a1b2c3d4e5f6789\\node_modules\\ws\\index.js'";
    expect(detectNpxCacheDir(text)).toBe("C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\0a1b2c3d4e5f6789");
  });

  it("accepts the bare ERR_MODULE_NOT_FOUND code without a 'Cannot find' phrase", () => {
    const text = "code: 'ERR_MODULE_NOT_FOUND' at /home/u/.npm/_npx/abcdef0123456789/node_modules/x/y.js";
    expect(detectNpxCacheDir(text)).toBe("/home/u/.npm/_npx/abcdef0123456789");
  });

  it("returns the first cache entry when several paths appear", () => {
    expect(detectNpxCacheDir(REAL_CRASH + "\n/Users/isamu/.npm/_npx/ffffffffffffffff/node_modules/a.js")).toBe("/Users/isamu/.npm/_npx/b492274026eba8a2");
  });

  it("ignores a module-not-found error outside the npx cache", () => {
    const text = "Error: Cannot find package '/Users/me/project/node_modules/left-pad/index.js'\ncode: 'ERR_MODULE_NOT_FOUND'";
    expect(detectNpxCacheDir(text)).toBeNull();
  });

  it("ignores an npx cache path without a module-resolution error", () => {
    expect(detectNpxCacheDir("Server crashed at /Users/me/.npm/_npx/b492274026eba8a2/node_modules/x.js: ECONNRESET")).toBeNull();
  });

  it("requires a hex hash segment after _npx", () => {
    const text = "Cannot find module '/Users/me/.npm/_npx/not-a-hash!/node_modules/x.js'";
    expect(detectNpxCacheDir(text)).toBeNull();
  });

  it("returns null for an ordinary crash, an empty string, and a non-string", () => {
    expect(detectNpxCacheDir("TypeError: Cannot read properties of undefined")).toBeNull();
    expect(detectNpxCacheDir("")).toBeNull();
    expect(detectNpxCacheDir(undefined as unknown as string)).toBeNull();
  });
});

describe("npxCacheHintLines", () => {
  it("names the corrupted dir and the removal command", () => {
    const lines = npxCacheHintLines("/Users/isamu/.npm/_npx/b492274026eba8a2", "darwin");
    expect(lines.some((l) => l.includes("corrupted npx cache"))).toBe(true);
    expect(lines).toContain("  rm -rf '/Users/isamu/.npm/_npx/b492274026eba8a2'");
  });

  // `rm -rf` is not a command on Windows, and cmd's `rmdir /s /q` is a syntax error in
  // PowerShell (where `rmdir` aliases Remove-Item) — a wrong command is worse than none.
  it("gives Windows both of its shells and never the POSIX command", () => {
    const dir = "C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\0a1b2c3d4e5f6789";
    const lines = npxCacheHintLines(dir, "win32");
    expect(lines).toContain(`  cmd:        rmdir /s /q "${dir}"`);
    expect(lines).toContain(`  PowerShell: Remove-Item -Recurse -Force "${dir}"`);
    expect(lines.some((l) => l.includes("rm -rf"))).toBe(false);
  });

  it("gives POSIX platforms only the rm command", () => {
    const lines = npxCacheHintLines("/Users/isamu/.npm/_npx/b492274026eba8a2", "linux");
    expect(lines.some((l) => l.includes("rmdir /s /q") || l.includes("Remove-Item"))).toBe(false);
  });

  it("names the corrupted directory on every platform", () => {
    (["darwin", "linux", "win32"] as const).forEach((platform) => {
      expect(npxCacheHintLines("/home/u/.npm/_npx/abc123", platform)).toContain("  /home/u/.npm/_npx/abc123");
    });
  });
});
