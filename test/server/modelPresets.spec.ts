import { describe, it, expect } from "vitest";
import { presetsForProvider, MODEL_PRESETS } from "../../common/modelPresets.js";

describe("presetsForProvider", () => {
  it("returns the built-in presets for a provider", () => {
    const openrouter = presetsForProvider("openrouter");
    expect(openrouter.length).toBeGreaterThan(0);
    expect(openrouter.every((p) => p.provider === "openrouter")).toBe(true);
  });

  it("appends a user model the provider has no preset for", () => {
    const result = presetsForProvider("openrouter", ["some/brand-new-model"]);
    const added = result.find((p) => p.id === "some/brand-new-model");
    expect(added).toMatchObject({ provider: "openrouter", label: "some/brand-new-model", trials: { status: "unmeasured" } });
  });

  it("keeps the preset (not a duplicate) when a user model matches a preset id case-insensitively", () => {
    const preset = MODEL_PRESETS.find((p) => p.provider === "openrouter");
    expect(preset).toBeDefined();
    const presetId = preset?.id ?? "";
    const result = presetsForProvider("openrouter", [presetId.toUpperCase()]);
    expect(result.filter((p) => p.id.toLowerCase() === presetId.toLowerCase())).toHaveLength(1);
  });

  // Regression (#748): user models were deduped against presets but not against EACH OTHER,
  // so a list with a repeat (or a case-variant repeat) showed the same model twice.
  it("collapses duplicate user models, including case-variants, to one entry", () => {
    const result = presetsForProvider("openrouter", ["user/x", "user/x", "User/X"]);
    expect(result.filter((p) => p.id.toLowerCase() === "user/x")).toHaveLength(1);
  });

  it("preserves the first spelling of a duplicated user model", () => {
    const result = presetsForProvider("openrouter", ["User/X", "user/x"]);
    const entry = result.find((p) => p.id.toLowerCase() === "user/x");
    expect(entry?.id).toBe("User/X");
  });
});

describe("MODEL_PRESETS data", () => {
  // Regression (#748): a 512_288 typo for a "512K" context — the real value is 512 * 1024.
  it("uses power-of-two context lengths (no 512_288 typo)", () => {
    const nemotron = MODEL_PRESETS.find((p) => p.id === "nvidia/nemotron-3-ultra-550b-a55b");
    expect(nemotron?.contextLength).toBe(524_288);
  });
});
