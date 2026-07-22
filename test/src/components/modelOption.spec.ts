import { describe, it, expect } from "vitest";

import { modelOptionLabel, modelRank, presetFor, sortedModels } from "../../../src/components/modelOption";
import { MODEL_PRESETS, type ModelPreset } from "../../../common/modelPresets";

const preset = (over: Partial<ModelPreset>): ModelPreset => ({
  provider: "openrouter",
  id: "acme/model",
  label: "Acme",
  contextLength: 262_144,
  pricePerMTok: { input: 1, output: 2 },
  trials: { status: "measured", passed: 3, of: 3, medianSeconds: 14, measuredAt: "2026-07-22" },
  ...over,
});

describe("modelOptionLabel", () => {
  it("leads with the name, then how it did and how much it holds", () => {
    expect(modelOptionLabel(preset({}))).toBe("Acme · 3/3 · 14s · 262k");
  });

  it("rounds a million-token window to M", () => {
    expect(modelOptionLabel(preset({ contextLength: 1_048_576 }))).toContain("1M");
  });

  // The whole reason the numbers are shown: a model that answers but never calls a tool
  // must not read like one that works.
  it("says so when nothing ever used a tool", () => {
    expect(modelOptionLabel(preset({ trials: { status: "measured", passed: 0, of: 4, medianSeconds: null, measuredAt: "x" } }))).toContain(
      "0/4 — never used a tool",
    );
  });

  it("distinguishes unreachable from failing", () => {
    const label = modelOptionLabel(preset({ trials: { status: "unreachable", reason: "privacy settings", measuredAt: "x" } }));
    expect(label).toContain("not reachable from this account");
    expect(label).not.toContain("0/");
  });

  it("admits when a user's own model was never tested", () => {
    expect(modelOptionLabel(preset({ trials: { status: "unmeasured" }, contextLength: 0 }))).toBe("Acme · not tested");
  });

  it("omits an unknown context window rather than printing 0k", () => {
    expect(modelOptionLabel(preset({ contextLength: 0 }))).not.toContain("0k");
  });
});

describe("sortedModels", () => {
  it("sinks what cannot be used below what can, keeping the built-in order within a tier", () => {
    const models = [
      preset({ id: "dead", trials: { status: "measured", passed: 0, of: 3, medianSeconds: null, measuredAt: "x" } }),
      preset({ id: "flaky", trials: { status: "measured", passed: 2, of: 3, medianSeconds: 20, measuredAt: "x" } }),
      preset({ id: "cheap-solid" }),
      preset({ id: "unreachable", trials: { status: "unreachable", reason: "r", measuredAt: "x" } }),
      preset({ id: "dear-solid" }),
    ];
    expect(sortedModels(models).map((model) => model.id)).toEqual(["cheap-solid", "dear-solid", "flaky", "dead", "unreachable"]);
  });

  it("does not mutate the list it was given", () => {
    const models = [preset({ id: "b", trials: { status: "unmeasured" } }), preset({ id: "a" })];
    sortedModels(models);
    expect(models.map((model) => model.id)).toEqual(["b", "a"]);
  });

  it("ranks a flaky model with the untested ones — neither is trustworthy, both are usable", () => {
    expect(modelRank(preset({ trials: { status: "measured", passed: 2, of: 3, medianSeconds: 9, measuredAt: "x" } }))).toBe(
      modelRank(preset({ trials: { status: "unmeasured" } })),
    );
  });
});

describe("presetFor", () => {
  it("finds a model by its exact id", () => {
    expect(presetFor("moonshotai/kimi-k2.7-code")?.label).toBe("Kimi K2.7 Code");
  });

  it("ignores case, since the id travels through argv and a transcript", () => {
    expect(presetFor("MoonshotAI/Kimi-K2.7-Code")?.label).toBe("Kimi K2.7 Code");
  });

  // A substring match would let the shorter id claim the longer one's context window, and
  // the badge would then report a full session's usage against the wrong denominator.
  it("does not let a prefix claim a longer id", () => {
    expect(presetFor("moonshotai/kimi-k2")).toBeUndefined();
  });

  it("is undefined for a model nobody listed", () => {
    expect(presetFor("claude-opus-4-8")).toBeUndefined();
  });
});

describe("the built-in preset list", () => {
  it("has no duplicate ids", () => {
    const ids = MODEL_PRESETS.map((model) => `${model.provider}/${model.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Every entry claims to have been measured on a real date; a placeholder would quietly
  // present a guess as a measurement.
  it("dates every measurement it claims", () => {
    for (const model of MODEL_PRESETS) {
      if (model.trials.status !== "unmeasured") expect(model.trials.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("gives every model a context window and a price", () => {
    for (const model of MODEL_PRESETS) {
      expect(model.contextLength, model.id).toBeGreaterThan(0);
      expect(model.pricePerMTok.output, model.id).toBeGreaterThan(0);
    }
  });

  it("records a median only for models that actually passed", () => {
    for (const model of MODEL_PRESETS) {
      if (model.trials.status !== "measured") continue;
      expect(model.trials.medianSeconds === null, model.id).toBe(model.trials.passed === 0);
    }
  });
});
