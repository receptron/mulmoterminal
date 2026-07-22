// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  ProviderRefusedError,
  isUsableBaseUrl,
  requireResolution,
  resolveProvider,
  withoutUnset,
  type ProviderConfig,
} from "../../../server/session/provider-env.js";

const OPENROUTER: ProviderConfig = {
  id: "openrouter",
  label: "OpenRouter",
  baseUrl: "https://openrouter.ai/api",
  tokenEnv: "OPENROUTER_API_KEY",
};

const PROVIDERS = [OPENROUTER];
const WITH_TOKEN = { OPENROUTER_API_KEY: "sk-or-test" };
const CHOICE = { provider: "openrouter", model: "z-ai/glm-5.2" };

const resolved = (over: Partial<Parameters<typeof resolveProvider>[0]> = {}, env: NodeJS.ProcessEnv = WITH_TOKEN) => {
  const result = resolveProvider({ ...CHOICE, ...over }, PROVIDERS, env);
  if (!result.ok) throw new Error(`expected a resolution, got: ${result.reason}`);
  return result.value;
};

describe("resolveProvider — no provider named", () => {
  it("does nothing at all when the directory configures neither", () => {
    const result = resolveProvider({ provider: null, model: null }, PROVIDERS, {});
    expect(result).toEqual({ ok: true, value: { model: null, env: {}, unset: [] } });
  });

  // A bare model choice stays on Anthropic — it is just `claude --model`.
  it("passes a bare model through without touching the environment", () => {
    const result = resolveProvider({ provider: null, model: "opus" }, PROVIDERS, {});
    expect(result).toEqual({ ok: true, value: { model: "opus", env: {}, unset: [] } });
  });
});

describe("resolveProvider — refusals", () => {
  // THE safety rule. Claude Code's auth precedence puts the subscription OAuth credential
  // last, so a base URL with no token would send that credential to the third party.
  it("refuses when the token env var is missing, rather than falling back", () => {
    const result = resolveProvider(CHOICE, PROVIDERS, {});
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("OPENROUTER_API_KEY") });
  });

  it("refuses when the token env var is present but empty", () => {
    const result = resolveProvider(CHOICE, PROVIDERS, { OPENROUTER_API_KEY: "" });
    expect(result.ok).toBe(false);
  });

  it("refuses a provider id that is not configured", () => {
    const result = resolveProvider({ provider: "typo", model: "x" }, PROVIDERS, WITH_TOKEN);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("unknown provider") });
  });

  it("refuses a provider with no model chosen", () => {
    const result = resolveProvider({ provider: "openrouter", model: null }, PROVIDERS, WITH_TOKEN);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("needs a model") });
  });

  // The container inherits no environment and cannot reach a loopback gateway, so a
  // sandboxed provider session would silently run against Anthropic instead.
  it("refuses the Docker sandbox rather than silently running against Anthropic", () => {
    const result = resolveProvider(CHOICE, PROVIDERS, WITH_TOKEN, true);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("sandbox") });
  });

  // Claude Code appends /v1/messages itself, so a baseUrl ending in /v1 404s at request
  // time — a failure that surfaces inside the session with no explanation.
  it("refuses a baseUrl that already ends in /v1", () => {
    const providers = [{ ...OPENROUTER, baseUrl: "https://openrouter.ai/api/v1" }];
    const result = resolveProvider(CHOICE, providers, WITH_TOKEN);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("baseUrl") });
  });
});

describe("isUsableBaseUrl", () => {
  it("accepts the endpoint Claude Code expects", () => {
    expect(isUsableBaseUrl("https://openrouter.ai/api")).toBe(true);
    expect(isUsableBaseUrl("http://localhost:4000")).toBe(true);
    expect(isUsableBaseUrl("https://api.moonshot.ai/anthropic")).toBe(true);
  });

  it("rejects a trailing /v1, with or without the slash", () => {
    expect(isUsableBaseUrl("https://openrouter.ai/api/v1")).toBe(false);
    expect(isUsableBaseUrl("https://openrouter.ai/api/v1/")).toBe(false);
  });

  it("rejects anything that is not an http(s) URL", () => {
    expect(isUsableBaseUrl("openrouter.ai/api")).toBe(false);
    expect(isUsableBaseUrl("")).toBe(false);
  });
});

describe("resolveProvider — the environment it builds", () => {
  it("aims Claude Code at the provider with its token", () => {
    expect(resolved().env).toMatchObject({
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: "sk-or-test",
      ANTHROPIC_MODEL: "z-ai/glm-5.2",
    });
  });

  // Background "haiku" calls go to a backend that has no haiku, and 400 without this.
  it("points the background model at the same model", () => {
    expect(resolved().env.ANTHROPIC_SMALL_FAST_MODEL).toBe("z-ai/glm-5.2");
  });

  // Starved of output budget a thinking model spends it all thinking and returns empty
  // visible text, which reads as a hung session.
  it("gives thinking models output headroom by default", () => {
    expect(resolved().env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe(String(DEFAULT_MAX_OUTPUT_TOKENS));
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(16000);
  });

  it("lets a provider raise the output cap", () => {
    const providers = [{ ...OPENROUTER, maxOutputTokens: 32000 }];
    const result = resolveProvider(CHOICE, providers, WITH_TOKEN);
    expect(result.ok && result.value.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("32000");
  });

  // A redirected session must not keep calling the real Anthropic API in the background.
  it("cuts background traffic to Anthropic", () => {
    expect(resolved().env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
  });

  // The settings `env` block can set a variable but not remove one, and a leftover
  // ANTHROPIC_API_KEY silently outranks the auth token.
  it("asks for ANTHROPIC_API_KEY to be removed, not blanked", () => {
    expect(resolved().unset).toEqual(["ANTHROPIC_API_KEY"]);
    expect(resolved().env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("passes the model to --model as well as the environment", () => {
    expect(resolved().model).toBe("z-ai/glm-5.2");
  });
});

describe("withoutUnset", () => {
  it("removes the named variables and keeps the rest", () => {
    expect(withoutUnset({ ANTHROPIC_API_KEY: "sk-ant", PATH: "/usr/bin" }, ["ANTHROPIC_API_KEY"])).toEqual({ PATH: "/usr/bin" });
  });

  it("returns the same object when there is nothing to remove", () => {
    const env = { PATH: "/usr/bin" };
    expect(withoutUnset(env, [])).toBe(env);
  });
});

// A `{ ok: false }` a caller can quietly ignore is how the refusal contract gets lost —
// it already happened once, with the spawn path downgrading refusals to a warning and
// running the session on Anthropic instead.
describe("requireResolution", () => {
  it("throws the reason rather than returning something ignorable", () => {
    const refused = resolveProvider({ provider: "openrouter", model: "m" }, PROVIDERS, {});
    expect(() => requireResolution(refused)).toThrow(ProviderRefusedError);
    expect(() => requireResolution(refused)).toThrow(/OPENROUTER_API_KEY/);
  });

  it("passes a good resolution straight through", () => {
    const ok = resolveProvider(CHOICE, PROVIDERS, WITH_TOKEN);
    expect(requireResolution(ok).model).toBe("z-ai/glm-5.2");
  });

  it("throws for every refusal reason, not just the missing token", () => {
    for (const refused of [
      resolveProvider({ provider: "typo", model: "m" }, PROVIDERS, WITH_TOKEN),
      resolveProvider({ provider: "openrouter", model: null }, PROVIDERS, WITH_TOKEN),
      resolveProvider(CHOICE, PROVIDERS, WITH_TOKEN, true),
    ]) {
      expect(() => requireResolution(refused)).toThrow(ProviderRefusedError);
    }
  });
});
