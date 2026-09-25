// Reads blueprint packs from disk and composes a base with a usecase. Everything is parsed with the
// schemas in common/blueprint, so a pack that the spec in test/server/blueprint would reject is
// refused here too rather than half-run.
//
// Packs live in more than one place — the ones shipped with this app and the ones installed from a
// registry — and the roots are searched in order, so an installed pack can never stand in for a
// shipped one of the same name.
import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { blueprintManifestSchema, incompatibility, BLUEPRINT_SLUG_RE, type BlueprintManifest } from "../../common/blueprint/manifest.js";
import { basePlanSchema, composePlan, usecaseStepsSchema, type ComposedStep } from "../../common/blueprint/plan.js";
import { hearingSchema, type Hearing } from "../../common/blueprint/hearing.js";

export const PACK_SOURCES = ["builtin", "installed"] as const;
export type PackSource = (typeof PACK_SOURCES)[number];

export interface PackRoot {
  dir: string;
  source: PackSource;
}

export interface PackSummary {
  slug: string;
  manifest: BlueprintManifest;
  source: PackSource;
}

export type PackPair = { ok: true; basePackDir: string; usecasePackDir: string; steps: ComposedStep[]; hearing: Hearing } | { ok: false; problems: string[] };

const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));

const exists = (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

export const readManifest = async (packDir: string): Promise<BlueprintManifest> =>
  blueprintManifestSchema.parse(await readJson(path.join(packDir, "manifest.json")));

/** The directory of pack `slug` in the first root that has it, or null. */
export async function packDirOf(roots: readonly PackRoot[], slug: string): Promise<string | null> {
  if (!BLUEPRINT_SLUG_RE.test(slug)) return null;
  const found = await Promise.all(roots.map(async (root) => ((await exists(path.join(root.dir, slug, "manifest.json"))) ? path.join(root.dir, slug) : null)));
  return found.find((dir) => dir !== null) ?? null;
}

async function packsIn(root: PackRoot): Promise<PackSummary[]> {
  const entries = await readdir(root.dir, { withFileTypes: true }).catch(() => []);
  const slugs = entries.filter((entry) => entry.isDirectory() && BLUEPRINT_SLUG_RE.test(entry.name)).map((entry) => entry.name);
  const summaries = await Promise.all(slugs.map(async (slug) => ({ slug, manifest: await readManifest(path.join(root.dir, slug)).catch(() => null) })));
  return summaries.flatMap(({ slug, manifest }) => (manifest ? [{ slug, manifest, source: root.source }] : []));
}

/** Every readable pack, each slug once — from the first root that has it. */
export async function listPacks(roots: readonly PackRoot[]): Promise<PackSummary[]> {
  const perRoot = await Promise.all(roots.map(packsIn));
  const seen = new Set<string>();
  return perRoot.flat().filter((pack) => {
    if (seen.has(pack.slug)) return false;
    seen.add(pack.slug);
    return true;
  });
}

function pairProblems(base: BlueprintManifest | null, usecase: BlueprintManifest | null): string[] {
  if (base?.kind !== "base") return ["the base pack is not a base"];
  if (usecase?.kind !== "usecase") return ["the usecase pack is not a usecase"];
  const incompatible = incompatibility(base, usecase);
  return incompatible ? [incompatible] : [];
}

const manifestAt = async (dir: string | null): Promise<BlueprintManifest | null> => (dir ? readManifest(dir) : null);

/** The composed steps for building `usecase` on `base`, or why it cannot be built. */
export async function loadPackPair(roots: readonly PackRoot[], baseSlug: string, usecaseSlug: string): Promise<PackPair> {
  try {
    const [basePackDir, usecasePackDir] = await Promise.all([packDirOf(roots, baseSlug), packDirOf(roots, usecaseSlug)]);
    const problems = pairProblems(await manifestAt(basePackDir), await manifestAt(usecasePackDir));
    if (problems.length > 0 || !basePackDir || !usecasePackDir) return { ok: false, problems };
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

async function stepsOf(packDir: string, manifest: BlueprintManifest): Promise<{ id: string; skill: string }[]> {
  if (manifest.kind === "base") return basePlanSchema.parse(await readJson(path.join(packDir, "plan.json"))).steps;
  hearingSchema.parse(await readJson(path.join(packDir, "hearing.json")));
  return usecaseStepsSchema.parse(await readJson(path.join(packDir, "steps.json"))).steps;
}

/** Why a pack directory could not be run — empty when it can. What an install is held to. */
export async function packProblems(packDir: string): Promise<string[]> {
  try {
    const steps = await stepsOf(packDir, await readManifest(packDir));
    const missing = await Promise.all(
      steps.map(async (step) => ((await exists(path.join(packDir, step.skill, "SKILL.md"))) ? null : `step "${step.id}" has no ${step.skill}/SKILL.md`)),
    );
    return missing.filter((problem): problem is string => problem !== null);
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
}
