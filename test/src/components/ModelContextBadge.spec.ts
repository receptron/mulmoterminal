import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ModelContextBadge from "../../../src/components/ModelContextBadge.vue";

function mountBadge(props: { agent?: "claude" | "codex"; model: string | null; contextTokens?: number }) {
  return mount(ModelContextBadge, {
    props: { agent: props.agent ?? "claude", model: props.model, contextTokens: props.contextTokens ?? 0 },
  });
}

describe("ModelContextBadge", () => {
  it("shows the short family label + ctx% for a known Claude model (70k / 200k = 35%)", () => {
    const w = mountBadge({ model: "claude-opus-4-20250514", contextTokens: 70_000 });
    expect(w.find("span").text()).toBe("Opus · ctx 35%");
  });

  it("maps sonnet and haiku ids to their short labels", () => {
    expect(mountBadge({ model: "claude-3-5-sonnet-20241022", contextTokens: 0 }).find("span").text()).toBe("Sonnet · ctx 0%");
    expect(mountBadge({ model: "claude-haiku-4-20250101", contextTokens: 20_000 }).find("span").text()).toBe("Haiku · ctx 10%");
  });

  it("uses a 1M window for current-generation models (Opus 4.6+, Sonnet 4.6+, Fable/Mythos)", () => {
    // Regression: a full opus-4-8 session (~999k ctx) reads as ~100%, not ~500% against a 200k window.
    expect(mountBadge({ model: "claude-opus-4-8", contextTokens: 999_606 }).find("span").text()).toBe("Opus · ctx 100%");
    expect(mountBadge({ model: "claude-sonnet-5", contextTokens: 500_000 }).find("span").text()).toBe("Sonnet · ctx 50%");
    expect(mountBadge({ model: "claude-sonnet-4-6", contextTokens: 100_000 }).find("span").text()).toBe("Sonnet · ctx 10%");
    expect(mountBadge({ model: "claude-fable-5", contextTokens: 250_000 }).find("span").text()).toBe("Fable · ctx 25%");
  });

  it("keeps the 200k window for older Opus/Sonnet (pre-4.6)", () => {
    expect(mountBadge({ model: "claude-opus-4-5-20251101", contextTokens: 100_000 }).find("span").text()).toBe("Opus · ctx 50%");
    expect(mountBadge({ model: "claude-sonnet-4-5-20250929", contextTokens: 100_000 }).find("span").text()).toBe("Sonnet · ctx 50%");
  });

  it("shows the model tail but NO % for an unknown model (never guesses a window)", () => {
    const w = mountBadge({ agent: "codex", model: "gpt-5-codex", contextTokens: 999_999 });
    expect(w.find("span").text()).toBe("gpt-5-codex");
    expect(w.find("span").text()).not.toContain("ctx");
  });

  it("uses the last path segment for a provider-prefixed unknown id", () => {
    const w = mountBadge({ agent: "codex", model: "openai/o3-pro", contextTokens: 1000 });
    expect(w.find("span").text()).toBe("o3-pro");
  });

  it("renders nothing when the model is unknown/null (no transcript model yet)", () => {
    expect(mountBadge({ model: null, contextTokens: 1000 }).find("span").exists()).toBe(false);
  });

  it("rounds the percentage", () => {
    // 51,234 / 200,000 = 25.617% → 26%
    expect(mountBadge({ model: "claude-opus-4", contextTokens: 51_234 }).find("span").text()).toBe("Opus · ctx 26%");
  });

  it("puts the agent name, full model id and raw token counts in the tooltip", () => {
    const w = mountBadge({ agent: "claude", model: "claude-opus-4-20250514", contextTokens: 70_000 });
    const title = w.find("span").attributes("title");
    expect(title).toContain("Claude");
    expect(title).toContain("claude-opus-4-20250514");
    expect(title).toContain("70,000 / 200,000 (35%)");
  });
});
