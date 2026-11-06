// @vitest-environment node
// Which `@mulmoclaude/core` each bundled package actually runs against.
//
// Nothing here nests its own core, so every package that names one imports the single core
// MulmoTerminal installs. That is what makes them breakable from HERE: a peer range is a
// declaration and yarn only warns, so a host that pins a core older than a package expects
// installs cleanly and fails late — the package keeps importing what it imported, and what
// breaks is the symbol core moved or re-typed, an empty control or an unformatted value in the
// pane rather than an install error. The stamped-`datetime` lock is the live example: it needs
// `isCanonicalServerTime`, and holding collection-plugin behind that left the pane drawing the
// field as an empty `datetime-local` — saving it then wrote over a value the rules refuse to
// see move.
//
// Declaring core as a DEPENDENCY is the way out of that regime, and it is checked directly
// rather than through yarn's output: yarn nests a copy only on a version CONFLICT, so a package
// that moved core to a dependency at the range we already pin would be hoisted, look exactly
// like a peer, and leave the premise silently false.
//
// So this reads what is INSTALLED rather than what package.json asks for: a range resolves to
// one version, and that version is the one that runs.
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

/** Every bundled plugin, taken from OUR OWN manifest rather than typed out here.
 *
 *  A hand-kept list is the failure this file would otherwise have: a plugin added to
 *  `package.json` and not to the list is bundled, ships, and is never checked — the guard passes
 *  by not looking. `package.json` is where "bundled" is actually decided, so it is what is read.
 *
 *  It is the DEPENDENCIES that are read, not the directory: a plugin pulled in transitively by
 *  another package is not one of ours to keep compatible. */
const PLUGINS: string[] = Object.keys(manifestAt(root).dependencies ?? {})
  .filter((name) => /^@mulmoclaude\/.*-plugin$/u.test(name))
  .sort();

/** Every direct dependency that names core, plugin or not.
 *
 *  A `-plugin` filter is how a consumer drifts unseen: `@receptron/sharedapp` names core too,
 *  and a plugin-shaped guard cannot see it go out of range. Read from the same manifest for
 *  `PLUGINS`' reason. */
const CORE_CONSUMERS: string[] = Object.keys(manifestAt(root).dependencies ?? {})
  .filter((name) => declaredCoreOf(name) !== undefined)
  .sort();

/** Non-plugin packages known to consume core.
 *
 *  `CORE_CONSUMERS` is selected BY declaring core, so a package that STOPS declaring one simply
 *  leaves the set — and every assertion about it passes by having nothing to say. That is the one
 *  way this file can go quiet without anything being fixed, and it is not hypothetical: it is how
 *  `@receptron/sharedapp` would disappear from the drift check that was written for it.
 *
 *  Plugins already have this in `NO_CORE`, which fails in both directions. This is the same
 *  promise for the consumers that are not shaped like a plugin. */
const EXPECTED_CORE_CONSUMERS = ["@receptron/sharedapp"];

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

/** A `||` union of carets: satisfied when any alternative is. Each alternative must still be a caret. */
const satisfiesCaretUnion = (version: string, range: string): boolean => range.split("||").some((alternative) => satisfiesCaret(version, alternative.trim()));

describe("the core each bundled consumer runs against", () => {
  it("has plugins to check, and reads them from what we actually bundle", () => {
    // Guards the reading itself: a manifest key that changed shape, or a filter that stopped
    // matching, would empty this list and every check below would pass on nothing.
    expect(PLUGINS.length).toBeGreaterThan(5);
    expect(PLUGINS).toContain("@mulmoclaude/collection-plugin");
  });

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
      expect(satisfiesCaretUnion(resolved?.version ?? "", declared), `${pkg} declares core ${declared} but runs ${resolved?.version}`).toBe(true);
    }
  });

  it("keeps every consumer we know about still declaring a core", () => {
    // Both directions, for NO_CORE's reason: a package that drops its declaration has to be
    // looked at, and one that stops being a dependency has to lose its entry here.
    expect(EXPECTED_CORE_CONSUMERS.filter((pkg) => declaredCoreOf(pkg) === undefined)).toEqual([]);
    const declaredByUs = Object.keys(manifestAt(root).dependencies ?? {});
    expect(EXPECTED_CORE_CONSUMERS.filter((pkg) => !declaredByUs.includes(pkg))).toEqual([]);
  });

  it("keeps every core consumer on OUR core, declaring none of its own", () => {
    // The DECLARATION, not yarn's output: a package that moved core to a dependency at the range
    // already pinned here is hoisted, so a nesting check would see nothing and the premise above
    // would be false with every test green.
    const owning = CORE_CONSUMERS.filter((pkg) => manifestAt(pluginDir(pkg)).dependencies?.["@mulmoclaude/core"] !== undefined);
    expect(owning).toEqual([]);
    expect(CORE_CONSUMERS.filter((pkg) => resolvedCoreFor(pkg)?.nested !== false)).toEqual([]);
  });

  // Every consumer whose declared range the pinned core does NOT satisfy, with the reason it is
  // tolerated. Recorded rather than filtered, for NO_CORE's reason: an entry says someone looked,
  // and both directions fail — a new drift has to be judged, and a fixed one has to lose its
  // entry. It is empty because the one entry it held did exactly that: `@receptron/sharedapp`
  // declared a core this repo had moved past, and the release that caught up removed it from here.
  const DRIFTED: Record<string, string> = {};

  it("names every consumer running outside its declared range", () => {
    const drifted = CORE_CONSUMERS.filter((pkg) => !satisfiesCaretUnion(resolvedCoreFor(pkg)?.version ?? "", declaredCoreOf(pkg) ?? ""));
    expect([...drifted].sort()).toEqual(Object.keys(DRIFTED).sort());
  });

  it("pins a core that still carries the symbol the stamped datetime needs", async () => {
    // The SYMBOL, not a version floor. A floor every declared range already forbids falling below
    // cannot fail, and it passes a core that kept the number and renamed the export — which is
    // the failure it was written for.
    const core: Record<string, unknown> = await import("@mulmoclaude/core/collection");
    expect(typeof core.isCanonicalServerTime).toBe("function");
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

  it("reads a || union of carets as any one of them", () => {
    expect(satisfiesCaretUnion("6.0.0", "^5.4.0 || ^6.0.0")).toBe(true);
    expect(satisfiesCaretUnion("5.4.1", "^5.4.0 || ^6.0.0")).toBe(true);
    expect(satisfiesCaretUnion("5.3.9", "^5.4.0 || ^6.0.0")).toBe(false);
    expect(satisfiesCaretUnion("7.0.0", "^5.4.0 || ^6.0.0")).toBe(false);
    expect(satisfiesCaretUnion("6.0.0", "^6.0.0")).toBe(true);
    expect(satisfiesCaretUnion("6.0.0", "^5.4.0 || >=6.0.0")).toBe(false);
    expect(satisfiesCaretUnion("6.0.0", "")).toBe(false);
  });
});
