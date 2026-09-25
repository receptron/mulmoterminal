// @vitest-environment node
// The dummy registry shipped for trying the market: every pack it lists must be installable from
// this repository, or the first thing anyone tries fails.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { registrySchema } from "../../../common/blueprint/registry";
import { packProblems, readManifest } from "../../../server/blueprint/packs";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");
const registry = registrySchema.parse(JSON.parse(readFileSync(path.join(REPO_ROOT, "samples", "blueprint-registry", "registry.json"), "utf8")));

describe("the sample registry", () => {
  it("lists at least one pack", () => {
    expect(registry.packs.length).toBeGreaterThan(0);
  });

  it.each(registry.packs.map((entry) => [entry.slug, entry] as const))("%s: comes from this repository and can be installed", async (_slug, entry) => {
    expect(entry.repo).toBe("https://github.com/receptron/mulmoterminal.git");
    const packDir = path.join(REPO_ROOT, entry.path);
    const manifest = await readManifest(packDir);
    expect([manifest.slug, manifest.kind]).toEqual([entry.slug, entry.kind]);
    expect(await packProblems(packDir)).toEqual([]);
  });
});
