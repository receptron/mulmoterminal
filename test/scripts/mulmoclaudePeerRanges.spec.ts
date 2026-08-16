// Which `@mulmoclaude/core` each bundled plugin actually runs against.
//
// It is not one answer. `collection-plugin` declares core as a PEER only, so it runs on the core
// MulmoTerminal installs — one core, ours. Every other plugin declares it as a DEPENDENCY, so yarn
// nests a copy under the plugin and that copy is what it imports; six of them sit at 3.x while the
// top level is 4.2.0, and none of that is a mismatch.
//
// The distinction is the whole point, because only the first kind can be broken from HERE. A peer
// range is a declaration and yarn only warns, so a host that pins a core older than the plugin
// expects installs cleanly and fails late: the plugin keeps importing what it imported, and what
// breaks is the symbol core moved or re-typed — an empty control or an unformatted value in the
// pane, not an install error. The stamped-`datetime` lock is the live example. It needs
// `isCanonicalServerTime`, which exists only from core 4.2.0, so collection-plugin 4.2.0 declares
// `^4.2.0`; holding the plugin a major behind left the pane drawing that field as an empty
// `datetime-local`, and saving it wrote over a value the rules refuse to see move.
//
// So this reads what is INSTALLED rather than what package.json asks for: a range resolves to one
// version, and that version is the one that runs.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Manifest {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

// Read by path rather than by resolution: these packages ship an `exports` map with no
// `./package.json` entry, so `require.resolve` cannot reach the very file that says what they are.
const manifestAt = (dir: string): Manifest => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;

const pluginDir = (pkg: string): string => join(root, "node_modules", pkg);

/** Every bundled plugin, listed rather than discovered: a plugin that stops declaring core, or
 *  stops nesting its own, must still be READ — a discovered list would simply not find it. */
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

/** Plugins that name no core at all, in either list.
 *
 *  Recorded rather than skipped, because "declares nothing" and "is not checked" look identical
 *  from a predicate that filters. An entry here says someone looked and the plugin genuinely does
 *  not use core; a plugin that DROPS its declaration therefore fails until it is either fixed or
 *  added here on purpose. */
const NO_CORE: Record<string, string> = {
  "@mulmoclaude/form-plugin": "the form card is self-contained; it names core in neither list",
  "@mulmoclaude/x-plugin": "no peer dependencies at all",
};

/** The core a plugin actually imports: its own nested copy when it has one, otherwise ours. */
function resolvedCoreFor(pkg: string): { version: string; nested: boolean } | null {
  const nested = join(pluginDir(pkg), "node_modules", "@mulmoclaude", "core");
  if (existsSync(nested)) return { version: manifestAt(nested).version, nested: true };
  const top = join(root, "node_modules", "@mulmoclaude", "core");
  if (!existsSync(top)) return null;
  return { version: manifestAt(top).version, nested: false };
}

const declaredCoreOf = (pkg: string): string | undefined => {
  const manifest = manifestAt(pluginDir(pkg));
  return manifest.dependencies?.["@mulmoclaude/core"] ?? manifest.peerDependencies?.["@mulmoclaude/core"];
};

/** `^X.Y.Z` against a concrete version. Written out rather than pulled from `semver`, which this
 *  repo does not declare — and every range in play is a caret, so the whole of semver would be
 *  answering one question. Anything else is refused rather than guessed at. */
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

describe("the core each bundled plugin runs against", () => {
  it("every plugin either names a core or is recorded as naming none", () => {
    const silent = PLUGINS.filter((pkg) => declaredCoreOf(pkg) === undefined);
    // Both directions: a plugin that newly drops its declaration has to be looked at, and a
    // recorded one that starts declaring again has to lose its entry.
    expect([...silent].sort()).toEqual(Object.keys(NO_CORE).sort());
  });

  it("resolves a core that satisfies what it declares", () => {
    for (const pkg of PLUGINS) {
      const declared = declaredCoreOf(pkg);
      if (declared === undefined) continue; // covered by the test above
      const resolved = resolvedCoreFor(pkg);
      expect(resolved, `${pkg} declares core ${declared} and resolves none`).not.toBeNull();
      expect(satisfiesCaret(resolved?.version ?? "", declared), `${pkg} declares core ${declared} but runs ${resolved?.version}`).toBe(true);
    }
  });

  it("collection-plugin is the one running on OUR core, and is new enough for the stamped datetime", () => {
    // Not a general fact — it is what makes this package the one MulmoTerminal can break by
    // pinning core. If it ever nests its own copy, the coupling is gone and this file's whole
    // premise needs rereading.
    const resolved = resolvedCoreFor("@mulmoclaude/collection-plugin");
    expect(resolved?.nested).toBe(false);
    expect(satisfiesCaret(resolved?.version ?? "", "^4.2.0")).toBe(true);

    // The version, not the behaviour: the behaviour is the package's own test. What this pins is
    // that MulmoTerminal is not holding it behind that fix.
    const [major, minor] = manifestAt(pluginDir("@mulmoclaude/collection-plugin")).version.split(".").map(Number);
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
