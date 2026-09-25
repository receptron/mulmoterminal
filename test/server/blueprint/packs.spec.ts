// @vitest-environment node
// The packs under blueprints/ are data that nothing else in the build opens: a misspelt gate, a
// step pointing at a skill that is not there, or a check calling a script that was renamed all
// ship green unless read here. Each pack is parsed with the same schemas the executor will use.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blueprintManifestSchema, incompatibility, type BaseManifest, type UsecaseManifest } from "../../../common/blueprint/manifest.js";
import { basePlanSchema, composePlan, usecaseStepsSchema, BLUEPRINT_GATES, type ComposedStep } from "../../../common/blueprint/plan.js";
import { hearingSchema } from "../../../common/blueprint/hearing.js";

const PACKS_DIR = join(import.meta.dirname, "..", "..", "..", "blueprints");

const readJson = (pack: string, file: string): unknown => JSON.parse(readFileSync(join(PACKS_DIR, pack, file), "utf8"));

const packDirs = readdirSync(PACKS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const manifests = packDirs.map((dir) => ({ dir, manifest: blueprintManifestSchema.parse(readJson(dir, "manifest.json")) }));
const bases = manifests.flatMap(({ dir, manifest }) => (manifest.kind === "base" ? [{ dir, manifest }] : []));
const usecases = manifests.flatMap(({ dir, manifest }) => (manifest.kind === "usecase" ? [{ dir, manifest }] : []));

// Every base/usecase pair the usecase says it supports.
const pairs = usecases.flatMap((usecase) =>
  bases.filter((base) => incompatibility(base.manifest, usecase.manifest) === null).map((base) => ({ base, usecase })),
);

const composed = (base: { dir: string }, usecase: { dir: string }): ComposedStep[] => {
  const result = composePlan(basePlanSchema.parse(readJson(base.dir, "plan.json")), usecaseStepsSchema.parse(readJson(usecase.dir, "steps.json")));
  if (!result.ok) throw new Error(result.problems.join("; "));
  return result.steps;
};

// `$BLUEPRINT_BASE/checks/x.sh` → the script it names, in the pack the variable points at.
const SCRIPT_REF_RE = /\$(BLUEPRINT_BASE|BLUEPRINT_USECASE)\/([\w./-]+)/g;

const scriptsCalledBy = (check: string, packFor: Record<string, string>): string[] =>
  [...check.matchAll(SCRIPT_REF_RE)].map(([, variable, file]) => join(PACKS_DIR, packFor[variable] ?? "", file));

const frontmatterField = (text: string, key: string): string | undefined =>
  /^---\n([\s\S]*?)\n---(?:\n|$)/
    .exec(text)?.[1]
    ?.split("\n")
    .find((line) => line.startsWith(`${key}: `))
    ?.slice(key.length + 2);

describe("blueprint packs", () => {
  it("has at least one base, one usecase and one pair that composes", () => {
    expect(bases.length).toBeGreaterThan(0);
    expect(usecases.length).toBeGreaterThan(0);
    expect(pairs.length).toBeGreaterThan(0);
  });

  it.each(manifests.map(({ dir, manifest }) => [dir, manifest] as const))("%s: the directory is named after its slug", (dir, manifest) => {
    expect(manifest.slug).toBe(dir);
  });

  it.each(usecases.map(({ dir }) => dir))("%s: every usecase names only bases that exist", (dir) => {
    const usecase = usecases.find((entry) => entry.dir === dir)?.manifest;
    expect(usecase?.bases.filter((slug) => !bases.some((base) => base.manifest.slug === slug))).toEqual([]);
  });

  it.each(usecases.map(({ dir }) => dir))("%s: the hearing parses", (dir) => {
    expect(hearingSchema.safeParse(readJson(dir, "hearing.json")).error?.issues ?? []).toEqual([]);
  });
});

describe.each(pairs.map(({ base, usecase }) => [`${base.dir} x ${usecase.dir}`, base, usecase] as const))("%s", (_label, base, usecase) => {
  const steps = composed(base, usecase);
  const packFor: Record<string, string> = { BLUEPRINT_BASE: base.dir, BLUEPRINT_USECASE: usecase.dir };
  const packOf = (step: ComposedStep): string => (step.origin === "base" ? base.dir : usecase.dir);

  it.each(steps.map((step) => [step.id, step] as const))("%s: its skill exists and names itself after the pack and step", (_id, step) => {
    const file = join(PACKS_DIR, packOf(step), step.skill, "SKILL.md");
    const text = readFileSync(file, "utf8");
    expect(frontmatterField(text, "name")).toBe(`blueprint-${packOf(step)}-${step.id}`);
    // Quoted as JSON so a colon in the sentence cannot break the YAML (see skillFrontmatter.spec.ts).
    expect(() => JSON.parse(frontmatterField(text, "description") ?? "")).not.toThrow();
  });

  it.each(steps.map((step) => [step.id, step] as const))("%s: its check calls scripts that exist", (_id, step) => {
    const scripts = scriptsCalledBy(step.check, packFor);
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((script) => !existsSync(script))).toEqual([]);
  });

  it("stops for billing before anything is built, and publishes to production only after dev", () => {
    const ids = steps.map((step) => step.id);
    const production = steps.findIndex((step) => step.gates.includes("deploy-production"));
    expect(steps.find((step) => step.id === "projects")?.gates).toContain("billing");
    expect(production).toBeGreaterThan(ids.indexOf("deploy-dev"));
    expect(ids.indexOf("deploy-dev")).toBeGreaterThan(ids.indexOf("scaffold"));
  });

  it("leaves no skill in either pack that no step uses", () => {
    const used = new Set(steps.map((step) => join(packOf(step), step.skill)));
    const shipped = [base.dir, usecase.dir].flatMap((dir) => {
      const skills = join(PACKS_DIR, dir, "skills");
      return existsSync(skills) ? readdirSync(skills).map((name) => join(dir, "skills", name)) : [];
    });
    expect(shipped.filter((skill) => !used.has(skill))).toEqual([]);
  });

  it("uses only known gates", () => {
    expect(steps.flatMap((step) => step.gates).filter((gate) => !BLUEPRINT_GATES.includes(gate))).toEqual([]);
  });
});

describe("check scripts", () => {
  const scripts = packDirs.flatMap((dir) => {
    const checks = join(PACKS_DIR, dir, "checks");
    return existsSync(checks) ? readdirSync(checks).map((file) => join(checks, file)) : [];
  });

  it.skipIf(process.platform === "win32").each(scripts)("%s parses as sh", (script) => {
    expect(() => execFileSync("/bin/sh", ["-n", script])).not.toThrow();
  });
});

describe("templates", () => {
  const manifestOf = (dir: string): BaseManifest | UsecaseManifest | undefined => manifests.find((entry) => entry.dir === dir)?.manifest;

  it.each(packDirs)("%s: every JSON file parses", (dir) => {
    expect(manifestOf(dir)).toBeDefined();
    const infra = join(PACKS_DIR, dir, "infra");
    const jsonFiles = existsSync(infra) ? readdirSync(infra).filter((file) => file.endsWith(".json")) : [];
    jsonFiles.forEach((file) => expect(() => readJson(dir, join("infra", file))).not.toThrow());
  });

  it.each(packDirs.filter((dir) => existsSync(join(PACKS_DIR, dir, "infra", "firestore.rules"))))("%s: firestore.rules ends by denying everything", (dir) => {
    const rules = readFileSync(join(PACKS_DIR, dir, "infra", "firestore.rules"), "utf8");
    expect(rules).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}\s*\}\s*\}\s*$/);
    expect(rules).not.toMatch(/if\s+true\b/);
  });
});
