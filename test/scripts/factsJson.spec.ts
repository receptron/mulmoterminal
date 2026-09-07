// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `docs/facts.json` is the machine-readable copy of what this package is, served from the docs
// site and read by tools rather than people — so a stale field is not a typo someone spots, it is
// a wrong answer nobody can see is wrong. Two of its values are restatements of `package.json`,
// and `facts.schema.json` already says so in prose ("Must match the version in package.json").
// Nothing enforced it: the file sat on 4.4.0 for twelve releases (#1988), the same way the Node
// floor sat on 22.9 (#1986) — each side self-consistent, with nothing comparing them.

const readJson = (...parts: string[]): unknown => JSON.parse(readFileSync(join(process.cwd(), ...parts), "utf8"));

const hasVersion = (value: unknown): value is { version: string } =>
  typeof value === "object" && value !== null && "version" in value && typeof value.version === "string";

const hasNodeRequirement = (value: unknown): value is { requires: { node: string } } => {
  if (typeof value !== "object" || value === null || !("requires" in value)) return false;
  const { requires } = value;
  if (typeof requires !== "object" || requires === null || !("node" in requires)) return false;
  return typeof requires.node === "string";
};

const hasNodeEngine = (value: unknown): value is { engines: { node: string } } => {
  if (typeof value !== "object" || value === null || !("engines" in value)) return false;
  const { engines } = value;
  if (typeof engines !== "object" || engines === null || !("node" in engines)) return false;
  return typeof engines.node === "string";
};

describe("docs/facts.json restates package.json", () => {
  const facts = readJson("docs", "facts.json");
  const manifest = readJson("package.json");

  it("names the version being shipped", () => {
    expect(hasVersion(facts), "docs/facts.json has no string `version`").toBe(true);
    expect(hasVersion(manifest), "package.json has no string `version`").toBe(true);
    if (!hasVersion(facts) || !hasVersion(manifest)) return;
    // Failing here means the release commit bumped package.json and left facts.json behind.
    expect(facts.version, "docs/facts.json is behind the version being released").toBe(manifest.version);
  });

  it("names the Node requirement npm enforces", () => {
    expect(hasNodeRequirement(facts), "docs/facts.json has no string `requires.node`").toBe(true);
    expect(hasNodeEngine(manifest), "package.json has no string `engines.node`").toBe(true);
    if (!hasNodeRequirement(facts) || !hasNodeEngine(manifest)) return;
    expect(facts.requires.node, "docs/facts.json states a Node floor npm does not enforce").toBe(manifest.engines.node);
  });
});
