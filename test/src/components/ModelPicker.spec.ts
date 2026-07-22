import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import ModelPicker from "../../../src/components/ModelPicker.vue";
import { reloadLaunchOptions } from "../../../src/composables/useLaunchOptions";

const MODELS = [
  {
    provider: "openrouter",
    id: "moonshotai/kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    contextLength: 262_144,
    pricePerMTok: { input: 0.82, output: 3.75 },
    trials: { status: "measured" as const, passed: 3, of: 3, medianSeconds: 14, measuredAt: "2026-07-22" },
  },
  {
    provider: "openrouter",
    id: "meta-llama/llama-4-maverick",
    label: "Llama 4 Maverick",
    contextLength: 1_048_576,
    pricePerMTok: { input: 0.2, output: 0.8 },
    trials: { status: "measured" as const, passed: 0, of: 4, medianSeconds: null, measuredAt: "2026-07-22" },
  },
];

const READY = { providers: [{ id: "openrouter", label: "OpenRouter", ready: true, tokenEnv: "OPENROUTER_API_KEY", models: MODELS }], anyReady: true };
const UNCONFIGURED = { providers: [], anyReady: false };
const BLOCKED = {
  providers: [
    {
      id: "openrouter",
      label: "OpenRouter",
      ready: false,
      reason: "provider 'openrouter' needs OPENROUTER_API_KEY",
      tokenEnv: "OPENROUTER_API_KEY",
      models: MODELS,
    },
  ],
  anyReady: false,
};

const serve = async (payload: unknown) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
  await reloadLaunchOptions();
};

const picker = () => mount(ModelPicker, { props: { modelValue: null } });

beforeEach(() => vi.unstubAllGlobals());

describe("ModelPicker", () => {
  it("offers each reachable provider's models, defaulting to the directory's own choice", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    const select = wrapper.get('[data-testid="cell-model-select"]');
    expect(select.findAll("optgroup").map((group) => group.attributes("label"))).toEqual(["OpenRouter"]);
    expect(select.findAll("option")[0].text()).toBe("This directory's default");
    expect(select.findAll("option")[0].attributes("value")).toBe("");
  });

  // The measurement has to survive the trip into the option text — a bare name would hide
  // the only thing that says whether the session will work.
  it("shows the pass rate next to each model", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.text()).toContain("Kimi K2.7 Code · 3/3 · 14s · 262k");
    expect(wrapper.text()).toContain("never used a tool");
  });

  it("sorts a model that never used a tool below one that always did", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    const values = wrapper.findAll("option").map((option) => option.attributes("value"));
    expect(values.indexOf("openrouter|moonshotai/kimi-k2.7-code")).toBeLessThan(values.indexOf("openrouter|meta-llama/llama-4-maverick"));
  });

  it("emits the provider and model as a pair when one is picked", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    await wrapper.get('[data-testid="cell-model-select"]').setValue("openrouter|moonshotai/kimi-k2.7-code");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([{ provider: "openrouter", model: "moonshotai/kimi-k2.7-code" }]);
  });

  // Null is what makes the server fall back to .mulmoterminal.json, so going back to the
  // default must clear the choice rather than emit an empty pair.
  it("emits null when the user returns to the directory's default", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    const select = wrapper.get('[data-testid="cell-model-select"]');
    await select.setValue("openrouter|moonshotai/kimi-k2.7-code");
    await select.setValue("");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([null]);
  });

  it("hides the select when nothing is configured, and offers the help instead", async () => {
    await serve(UNCONFIGURED);
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.find('[data-testid="cell-model-select"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="cell-model-help"]').text()).toBe("Use another model…");
  });

  // A configured-but-unusable provider is the case where the user most needs the one
  // sentence naming what is missing — so it must not be offered as if it worked.
  it("does not offer a provider whose key is missing", async () => {
    await serve(BLOCKED);
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.find('[data-testid="cell-model-select"]').exists()).toBe(false);
  });

  it("puts that provider's own refusal at the top of the help", async () => {
    await serve(BLOCKED);
    const wrapper = picker();
    await flushPromises();
    await wrapper.get('[data-testid="cell-model-help"]').trigger("click");
    expect(wrapper.text()).toContain("provider 'openrouter' needs OPENROUTER_API_KEY");
  });

  // A picker that cannot load its list must not block launching: the form still starts a
  // session on whatever the directory already says.
  it("falls back to the directory default when the list cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await reloadLaunchOptions();
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.find('[data-testid="cell-model-select"]').exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });
});
