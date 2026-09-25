// @vitest-environment node
import { describe, it, expect } from "vitest";
import { basePlanSchema, composePlan, usecaseStepsSchema, type BasePlan, type UsecaseSteps } from "../../../common/blueprint/plan";
import { baseManifestSchema, blueprintManifestSchema, incompatibility, usecaseManifestSchema } from "../../../common/blueprint/manifest";

const step = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, skill: `skills/${id}`, check: "true", ...extra });

const base: BasePlan = basePlanSchema.parse({ steps: [step("init"), step("auth"), step("deploy", { gates: ["deploy-production"] })] });

const usecase = (steps: Record<string, unknown>[]): UsecaseSteps => usecaseStepsSchema.parse({ steps });

describe("composePlan", () => {
  it("returns the base plan untouched when the usecase adds nothing", () => {
    const result = composePlan(base, usecase([]));
    expect(result).toEqual({ ok: true, steps: base.steps.map((s) => ({ ...s, origin: "base" })) });
  });

  it("splices usecase steps after their anchor, in the order they are listed", () => {
    const result = composePlan(
      base,
      usecase([step("domain", { insertAfter: "auth" }), step("audit", { insertAfter: "auth" }), step("offboard", { insertAfter: "init" })]),
    );
    expect(result.ok && result.steps.map((s) => s.id)).toEqual(["init", "offboard", "auth", "domain", "audit", "deploy"]);
  });

  it("tags each step with the pack it came from", () => {
    const result = composePlan(base, usecase([step("domain", { insertAfter: "auth" })]));
    expect(result.ok && result.steps.map((s) => `${s.id}:${s.origin}`)).toEqual(["init:base", "auth:base", "domain:usecase", "deploy:base"]);
  });

  it("appends steps without an anchor at the end", () => {
    const result = composePlan(base, usecase([step("handover")]));
    expect(result.ok && result.steps.map((s) => s.id)).toEqual(["init", "auth", "deploy", "handover"]);
  });

  it("drops the anchor from the composed steps", () => {
    const result = composePlan(base, usecase([step("domain", { insertAfter: "auth" })]));
    expect(result.ok && result.steps.every((s) => !("insertAfter" in s))).toBe(true);
  });

  it("refuses an anchor the base plan does not have", () => {
    const result = composePlan(base, usecase([step("domain", { insertAfter: "nope" })]));
    expect(result).toEqual({ ok: false, problems: [expect.stringContaining('"nope"')] });
  });

  it("refuses a usecase step anchored on another usecase step", () => {
    const result = composePlan(base, usecase([step("a", { insertAfter: "auth" }), step("b", { insertAfter: "a" })]));
    expect(result.ok).toBe(false);
  });

  it("refuses a usecase step reusing a base id", () => {
    const result = composePlan(base, usecase([step("auth", { insertAfter: "init" })]));
    expect(result).toEqual({ ok: false, problems: ['duplicate step id "auth"'] });
  });

  it("reports a missing anchor and a duplicate id together", () => {
    const result = composePlan(base, usecase([step("x", { insertAfter: "nope" }), step("auth", { insertAfter: "init" })]));
    expect(result.ok ? [] : result.problems).toHaveLength(2);
  });

  it("refuses duplicate ids within the base plan", () => {
    const duplicated = basePlanSchema.parse({ steps: [step("init"), step("init")] });
    expect(composePlan(duplicated, usecase([])).ok).toBe(false);
  });
});

describe("plan schemas", () => {
  it("defaults gates to none", () => {
    expect(basePlanSchema.parse({ steps: [step("init")] }).steps[0].gates).toEqual([]);
  });

  it.each([
    ["an unknown gate", { steps: [step("init", { gates: ["launch-missiles"] })] }],
    ["an empty plan", { steps: [] }],
    ["an upper-case id", { steps: [step("Init")] }],
    ["a missing check", { steps: [{ id: "init", title: "init", skill: "s" }] }],
    ["an empty check", { steps: [step("init", { check: "" })] }],
  ])("rejects %s", (_label, input) => {
    expect(basePlanSchema.safeParse(input).success).toBe(false);
  });
});

describe("manifests", () => {
  const firebase = baseManifestSchema.parse({ kind: "base", slug: "firebase", title: "Firebase", version: "0.1.0", platform: "firebase" });
  const internal = usecaseManifestSchema.parse({ kind: "usecase", slug: "internal", title: "Internal", version: "0.1.0", bases: ["firebase"] });

  it("accepts a usecase on a base it lists", () => {
    expect(incompatibility(firebase, internal)).toBeNull();
  });

  it("names both sides when a usecase does not support the base", () => {
    const supabase = { ...firebase, slug: "supabase" };
    expect(incompatibility(supabase, internal)).toContain('"supabase"');
  });

  it("discriminates on kind", () => {
    expect(blueprintManifestSchema.parse({ kind: "usecase", slug: "social", title: "S", version: "1", bases: ["firebase"] }).kind).toBe("usecase");
  });

  it.each([
    ["a usecase with no bases", { kind: "usecase", slug: "x", title: "X", version: "1", bases: [] }],
    ["a bad slug", { kind: "base", slug: "Fire Base", title: "X", version: "1", platform: "p" }],
    ["an unknown kind", { kind: "addon", slug: "x", title: "X", version: "1" }],
    ["null", null],
  ])("rejects %s", (_label, input) => {
    expect(blueprintManifestSchema.safeParse(input).success).toBe(false);
  });
});
