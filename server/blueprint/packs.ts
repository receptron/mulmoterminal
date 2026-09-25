// Reads blueprint packs from disk and composes a base with a usecase. Everything is parsed with the
// schemas in common/blueprint, so a pack that the spec in test/server/blueprint would reject is
// refused here too rather than half-run.
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { blueprintManifestSchema, incompatibility, BLUEPRINT_SLUG_RE, type BlueprintManifest } from "../../common/blueprint/manifest.js";
import { basePlanSchema, composePlan, usecaseStepsSchema, type ComposedStep } from "../../common/blueprint/plan.js";
import { hearingSchema, type Hearing } from "../../common/blueprint/hearing.js";

export interface PackSummary {
  slug: string;
  manifest: BlueprintManifest;
}

export type PackPair = { ok: true; basePackDir: string; usecasePackDir: string; steps: ComposedStep[]; hearing: Hearing } | { ok: false; problems: string[] };

const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));

const manifestOf = async (packsRoot: string, slug: string): Promise<BlueprintManifest | null> =>
  BLUEPRINT_SLUG_RE.test(slug) ? blueprintManifestSchema.parse(await readJson(path.join(packsRoot, slug, "manifest.json"))) : null;

export async function listPacks(packsRoot: string): Promise<PackSummary[]> {
  const entries = await readdir(packsRoot, { withFileTypes: true }).catch(() => []);
  const slugs = entries.filter((entry) => entry.isDirectory() && BLUEPRINT_SLUG_RE.test(entry.name)).map((entry) => entry.name);
  const summaries = await Promise.all(slugs.map(async (slug) => ({ slug, manifest: await manifestOf(packsRoot, slug).catch(() => null) })));
  return summaries.flatMap(({ slug, manifest }) => (manifest ? [{ slug, manifest }] : []));
}

async function pairProblems(base: BlueprintManifest | null, usecase: BlueprintManifest | null): Promise<string[]> {
  if (base?.kind !== "base") return ["the base pack is not a base"];
  if (usecase?.kind !== "usecase") return ["the usecase pack is not a usecase"];
  const incompatible = incompatibility(base, usecase);
  return incompatible ? [incompatible] : [];
}

/** The composed steps for building `usecase` on `base`, or why it cannot be built. */
export async function loadPackPair(packsRoot: string, baseSlug: string, usecaseSlug: string): Promise<PackPair> {
  try {
    const problems = await pairProblems(await manifestOf(packsRoot, baseSlug), await manifestOf(packsRoot, usecaseSlug));
    if (problems.length > 0) return { ok: false, problems };
    const basePackDir = path.join(packsRoot, baseSlug);
    const usecasePackDir = path.join(packsRoot, usecaseSlug);
    const composed = composePlan(
      basePlanSchema.parse(await readJson(path.join(basePackDir, "plan.json"))),
      usecaseStepsSchema.parse(await readJson(path.join(usecasePackDir, "steps.json"))),
    );
    if (!composed.ok) return composed;
    const hearing = hearingSchema.parse(await readJson(path.join(usecasePackDir, "hearing.json")));
    return { ok: true, basePackDir, usecasePackDir, steps: composed.steps, hearing };
  } catch (err) {
    return { ok: false, problems: [err instanceof Error ? err.message : String(err)] };
  }
}
