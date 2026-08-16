// The `@mulmoclaude/*` plugins declare which `@mulmoclaude/core` they were built
// against, and MulmoTerminal pins ONE core for all of them. Nothing enforces the
// two agree: a peer range is a declaration, and yarn only warns.
//
// It matters because the failure is silent and late. A plugin built against an
// older core keeps importing whatever it imported; what breaks is the symbol core
// moved or re-typed, and that shows up as an empty control or an unformatted value
// in the pane, not as an install error. The stamped-`datetime` lock is the live
// example: it needs `isCanonicalServerTime`, which exists only from core 4.2.0, so
// collection-plugin 4.2.0 declares `^4.2.0` and holding the plugin a major behind
// left the pane rendering that field as an empty `datetime-local`.
//
// So this reads what is actually INSTALLED rather than what package.json asks for
// — a range resolves to one version and that version is the one that runs.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Read from `node_modules` by path rather than by resolution: these packages ship
// an `exports` map with no `./package.json` entry, so `require.resolve` cannot
// reach the very file that says what they are.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Manifest {
  version: string;
  peerDependencies?: Record<string, string>;
}

const manifestOf = (pkg: string): Manifest => JSON.parse(readFileSync(join(root, "node_modules", pkg, "package.json"), "utf8")) as Manifest;

const versionOf = (pkg: string): string => manifestOf(pkg).version;

const corePeerOf = (pkg: string): string | undefined => manifestOf(pkg).peerDependencies?.["@mulmoclaude/core"];

/** Every bundled plugin, whether or not it declares a core peer today. Listed
 *  rather than discovered, so a plugin that STOPS declaring one is still read. */
const PLUGINS = [
  "@mulmoclaude/accounting-plugin",
  "@mulmoclaude/chart-plugin",
  "@mulmoclaude/collection-plugin",
  "@mulmoclaude/form-plugin",
  "@mulmoclaude/google-plugin",
  "@mulmoclaude/html-plugin",
  "@mulmoclaude/markdown-plugin",
  "@mulmoclaude/mulmoscript-plugin",
  "@mulmoclaude/x-plugin",
] as const;

/** Plugins whose declared core floor is BEHIND the core we run, kept here on
 *  purpose rather than fixed by holding core back.
 *
 *  Both were built against core 3 and were not republished when core went to 4 —
 *  core 4.0.0's break was moving the shared-app compiler out to
 *  `@receptron/sharedapp`, which neither of them touches. The entry is what says
 *  someone checked: an unexplained mismatch and a checked one look identical from
 *  the manifest. Remove an entry when its plugin's own major lands here. */
const KNOWN_BEHIND: Record<string, string> = {
  "@mulmoclaude/html-plugin": "3.0.0 declares core ^3.0.0; MulmoClaude ships 4.0.0 against core 4",
  "@mulmoclaude/markdown-plugin": "3.0.0 declares core ^3.0.0; MulmoClaude ships 4.0.0 against core 4",
};

/** `^X.Y.Z` against a concrete version. Written out rather than pulled from
 *  `semver`, which this repo does not declare — and every range here is a caret,
 *  so the whole of semver would be answering one question. */
function satisfiesCaret(version: string, range: string): boolean {
  const wanted = /^\^(\d+)\.(\d+)\.(\d+)$/u.exec(range);
  if (wanted === null) return false;
  const got = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (got === null) return false;
  const [wMajor, wMinor, wPatch] = wanted.slice(1).map(Number);
  const [gMajor, gMinor, gPatch] = got.slice(1).map(Number);
  if (gMajor !== wMajor) return false;
  if (gMinor !== wMinor) return gMinor > wMinor;
  return gPatch >= wPatch;
}

describe("bundled @mulmoclaude plugins against the core we install", () => {
  it("accepts the installed core, or says why it does not", () => {
    const core = versionOf("@mulmoclaude/core");
    const behind = PLUGINS.filter((pkg) => {
      const peer = corePeerOf(pkg);
      return peer !== undefined && !satisfiesCaret(core, peer);
    });
    // Both directions on purpose. A NEW mismatch has to be looked at; a recorded
    // one that has been fixed has to lose its entry, or the list stops meaning
    // "someone checked these" and becomes a list of things that used to be true.
    expect([...behind].sort()).toEqual(Object.keys(KNOWN_BEHIND).sort());
  });

  it("collection-plugin is new enough to carry the server-stamped datetime lock", () => {
    // The version, not the behaviour: the behaviour is the package's own test.
    // What this pins is that MulmoTerminal is not holding it behind that fix.
    const [major, minor] = versionOf("@mulmoclaude/collection-plugin").split(".").map(Number);
    expect(major > 4 || (major === 4 && minor >= 2)).toBe(true);
  });

  it("only recognises a caret range", () => {
    expect(satisfiesCaret("4.2.0", "^4.2.0")).toBe(true);
    expect(satisfiesCaret("4.2.1", "^4.2.0")).toBe(true);
    expect(satisfiesCaret("4.3.0", "^4.2.0")).toBe(true);
    expect(satisfiesCaret("4.1.9", "^4.2.0")).toBe(false);
    expect(satisfiesCaret("4.2.0", "^3.0.0")).toBe(false);
    expect(satisfiesCaret("3.9.9", "^4.0.0")).toBe(false);
    expect(satisfiesCaret("4.2.0", ">=4.0.0")).toBe(false);
  });
});
