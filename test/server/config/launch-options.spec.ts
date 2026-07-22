// @vitest-environment node
import { describe, it, expect } from "vitest";

import { launchOptions } from "../../../server/config/launch-options.js";
import { resolveProvider, type ProviderConfig } from "../../../server/session/provider-env.js";
import { sanitizeProviders } from "../../../server/config/app-config.js";
import { launchChoiceFromParams } from "../../../server/session/launch-choice.js";

const OPENROUTER: ProviderConfig = {
  id: "openrouter",
  label: "OpenRouter",
  baseUrl: "https://openrouter.ai/api",
  tokenEnv: "OPENROUTER_API_KEY",
};

const WITH_KEY = { OPENROUTER_API_KEY: "sk-test" } as NodeJS.ProcessEnv;

describe("launchOptions", () => {
  it("offers nothing when no provider is configured", () => {
    expect(launchOptions([], WITH_KEY)).toEqual({ providers: [], anyReady: false });
  });

  it("marks a provider ready when its token is in the environment", () => {
    const { providers, anyReady } = launchOptions([OPENROUTER], WITH_KEY);
    expect(anyReady).toBe(true);
    expect(providers[0]).toMatchObject({ id: "openrouter", label: "OpenRouter", ready: true });
    expect(providers[0].reason).toBeUndefined();
  });

  it("lists the built-in presets for that provider", () => {
    const [option] = launchOptions([OPENROUTER], WITH_KEY).providers;
    expect(option.models.length).toBeGreaterThan(10);
    expect(option.models.map((model) => model.id)).toContain("moonshotai/kimi-k2.7-code");
    expect(option.models.every((model) => model.provider === "openrouter")).toBe(true);
  });

  it("appends the user's own models, marked as never measured", () => {
    const [option] = launchOptions([{ ...OPENROUTER, models: ["acme/experimental-1"] }], WITH_KEY).providers;
    const added = option.models.find((model) => model.id === "acme/experimental-1");
    expect(added?.trials.status).toBe("unmeasured");
  });

  // A model the user lists that we already measured must not appear twice — and must keep
  // the measurement rather than being downgraded to "unmeasured" by the duplicate.
  it("does not duplicate a user model that is already a preset", () => {
    const [option] = launchOptions([{ ...OPENROUTER, models: ["moonshotai/kimi-k2.7-code"] }], WITH_KEY).providers;
    const matches = option.models.filter((model) => model.id === "moonshotai/kimi-k2.7-code");
    expect(matches).toHaveLength(1);
    expect(matches[0].trials.status).toBe("measured");
  });

  it("still lists a provider whose token is missing, and says so", () => {
    const { providers, anyReady } = launchOptions([OPENROUTER], {} as NodeJS.ProcessEnv);
    expect(anyReady).toBe(false);
    expect(providers[0].ready).toBe(false);
    expect(providers[0].reason).toContain("OPENROUTER_API_KEY");
  });

  it("reports an unusable baseUrl instead of offering a backend that would 404", () => {
    const [option] = launchOptions([{ ...OPENROUTER, baseUrl: "https://openrouter.ai/api/v1" }], WITH_KEY).providers;
    expect(option.ready).toBe(false);
    expect(option.reason).toContain("/v1");
  });

  // The picker's explanation and the session's refusal have to be the same sentence — a UI
  // that says one thing while the spawn says another is how a user ends up debugging the
  // wrong half of their setup.
  it("explains a refusal in the same words the spawn would refuse with", () => {
    const [option] = launchOptions([OPENROUTER], {} as NodeJS.ProcessEnv).providers;
    const spawn = resolveProvider({ provider: "openrouter", model: "moonshotai/kimi-k2.7-code" }, [OPENROUTER], {} as NodeJS.ProcessEnv);
    expect(spawn.ok).toBe(false);
    expect(option.reason).toBe(spawn.ok ? undefined : spawn.reason);
  });

  it("never exposes the token itself, only the variable's name", () => {
    const serialized = JSON.stringify(launchOptions([OPENROUTER], WITH_KEY));
    expect(serialized).toContain("OPENROUTER_API_KEY");
    expect(serialized).not.toContain("sk-test");
  });

  it("is ready when any one of several providers is", () => {
    const broken = { ...OPENROUTER, id: "moonshot", label: "Moonshot", tokenEnv: "MOONSHOT_API_KEY" };
    expect(launchOptions([broken, OPENROUTER], WITH_KEY).anyReady).toBe(true);
  });
});

// Codex on PR #587: the config schema accepted ids the launch parser then dropped, and a
// dropped provider whose model survived would have started the session on Anthropic. The
// two now share one id shape — this pins them together rather than trusting they agree.
describe("what config accepts and what the launch path accepts", () => {
  const provider = (id: string) => ({ id, label: "X", baseUrl: "https://x.example/api", tokenEnv: "X_KEY" });

  it("keeps a provider whose id the launch parser would also accept", () => {
    expect(sanitizeProviders([provider("open-router.v2")]).map((p) => p.id)).toEqual(["open-router.v2"]);
  });

  it.each(["has space", "-leading-dash", "pipe|char", ""])("refuses the id %j that the launch parser would drop", (id) => {
    expect(sanitizeProviders([provider(id)])).toEqual([]);
  });

  it("drops only the malformed model, not the provider's whole list", () => {
    const [saved] = sanitizeProviders([{ ...provider("openrouter"), models: ["z-ai/glm-5.2", "bad id", 42] }]);
    expect(saved.models).toEqual(["z-ai/glm-5.2"]);
  });

  // The round trip that matters: anything config keeps must survive the ws query.
  it("round-trips every id config keeps through the launch parser", () => {
    for (const { id } of sanitizeProviders([provider("openrouter"), provider("moonshot"), provider("gw.internal:8080")])) {
      expect(launchChoiceFromParams(new URLSearchParams({ provider: id, model: "m" }))).toEqual({ provider: id, model: "m" });
    }
  });
});
