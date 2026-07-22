// @vitest-environment node
//
// A directory's `.mulmoterminal.json` is the fourth way a provider/model reaches
// `claude --model` — and the most travelled one, since it decides every session that does
// not use the picker (#590). It is also the least trusted: the file comes from whatever
// repository was opened, so a cloned project brings its own.
//
// The check lives in resolveProvider rather than in the file parser, because that is the
// single gate every entry point passes through. These tests drive the real path — write the
// file, load it, resolve it, build the args — rather than calling the check directly, so
// they fail if any link in that chain stops applying it.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadDirConfig } from "../../../server/config/dir-config.js";
import { effectiveChoice } from "../../../server/session/launch-choice.js";
import { resolveProvider, type ProviderConfig, type ProviderResult } from "../../../server/session/provider-env.js";
import { buildClaudeArgs } from "../../../server/agents/claude-args.js";
import { MODEL_ID_ALLOWED } from "../../../common/modelIds.js";

const PROVIDERS: ProviderConfig[] = [{ id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", tokenEnv: "OPENROUTER_API_KEY" }];
const ENV = { OPENROUTER_API_KEY: "sk-test" } as NodeJS.ProcessEnv;

// What a session in a directory holding this config would resolve to.
function resolveDir(config: Record<string, unknown>): ProviderResult {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-dir-choice-"));
  writeFileSync(path.join(dir, ".mulmoterminal.json"), JSON.stringify(config));
  const loaded = loadDirConfig(dir);
  return resolveProvider(effectiveChoice({ dir: { provider: loaded.provider, model: loaded.model }, resuming: false }), PROVIDERS, ENV);
}

const reasonOf = (result: ProviderResult): string => (result.ok ? "" : result.reason);

describe("a model id from .mulmoterminal.json", () => {
  it("reaches the session when it is shaped like a model id", () => {
    const result = resolveDir({ provider: "openrouter", model: "moonshotai/kimi-k2.7-code" });
    expect(result.ok && result.value.model).toBe("moonshotai/kimi-k2.7-code");
  });

  it("works without a provider — that is picking another Anthropic model", () => {
    const result = resolveDir({ model: "claude-opus-4-8" });
    expect(result.ok && result.value.model).toBe("claude-opus-4-8");
  });

  // The one that motivated this: `--model --mcp-config=…` makes the value the CLI reads
  // depend on how claude's argument parser treats a value starting with a dash. The guard
  // exists so that never has to be relied on.
  it.each([
    ["a leading dash argv could read as another flag", "--mcp-config=/tmp/evil.json"],
    ["embedded whitespace and a second flag", "kimi k2 --dangerously-skip-permissions"],
    ["a newline", "kimi\nrm -rf /"],
    ["a NUL byte", "kimi\u0000"],
    ["a pipe, which the picker uses as its separator", "openrouter|kimi"],
  ])("is refused when it carries %s", (_why, model) => {
    const result = resolveDir({ provider: "openrouter", model });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("unusable model id");
  });

  // Found by reading the live OpenRouter catalog rather than by reasoning about the regex:
  // 10 of its 342 ids begin with `~` — the "always the latest" aliases. The shape rejected
  // them, which would have made a perfectly valid configuration unlaunchable. `~` is safe
  // where `-` is not: no argument parser reads it as a flag.
  it.each(["~anthropic/claude-opus-latest", "~moonshotai/kimi-latest", "~google/gemini-flash-latest"])("accepts the alias id %s", (model) => {
    expect(resolveDir({ provider: "openrouter", model }).ok).toBe(true);
  });

  it("is refused when it is absurdly long", () => {
    expect(resolveDir({ model: "m".repeat(121) }).ok).toBe(false);
    expect(resolveDir({ model: "m".repeat(120) }).ok).toBe(true);
  });

  // Refused, NOT dropped. Dropping it would start the session on the Anthropic default
  // while the directory plainly asked for OpenRouter — silently running somewhere the user
  // did not choose is the failure this whole feature exists to prevent, and a directory
  // whose provider is a typo is already refused rather than downgraded.
  it("never falls back to Anthropic when the directory named a provider", () => {
    const result = resolveDir({ provider: "openrouter", model: "not a model id" });
    expect(result.ok).toBe(false);
    expect(result.ok && result.value.env.ANTHROPIC_BASE_URL).toBeFalsy();
  });

  // The mirror image, and the reason the fix is not "drop whichever half is bad": a
  // surviving model with its provider gone is another vendor's id pointed at Anthropic.
  it("does not keep the model when the provider is unusable", () => {
    const result = resolveDir({ provider: "not a provider", model: "z-ai/glm-5.2" });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("unknown provider");
  });

  // The message and the rule were written twice and drifted: `~` was allowed while the
  // refusal still listed the old set (Codex, PR #594). They share a constant now, and this
  // fails if anyone hardcodes a list again.
  it("describes the allowed characters from the same place the rule reads them", () => {
    const reason = reasonOf(resolveDir({ model: "not a model id" }));
    expect(reason).toContain(MODEL_ID_ALLOWED);
    expect(MODEL_ID_ALLOWED).toContain("~");
  });

  it("quotes the offending value rather than pasting it into the message raw", () => {
    // The string reaches a log line and the session's terminal, so a newline in it must not
    // be able to forge one.
    expect(reasonOf(resolveDir({ model: "kimi\nFAKE LOG LINE" }))).not.toContain("\nFAKE");
  });
});

describe("the rest of a directory's config", () => {
  // The lenient contract predates this: one bad field must not stop a directory's colours
  // and header from loading. Only the launch is refused.
  it("still loads when the model is unusable", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-dir-choice-"));
    writeFileSync(path.join(dir, ".mulmoterminal.json"), JSON.stringify({ name: "acme", theme: "nord", model: "not a model id" }));
    const loaded = loadDirConfig(dir);
    expect(loaded.name).toBe("acme");
    expect(loaded.theme).toBe("nord");
  });
});

describe("what actually reaches argv", () => {
  const argsFor = (model: string | null) =>
    buildClaudeArgs({
      model,
      sessionId: "spec-session",
      resume: null,
      canResume: false,
      settings: "{}",
      permissionMode: "auto",
      attachGuiMcp: false,
      mcpConfig: "{}",
      guiMcpTools: "",
    });

  it("passes a usable id through as the --model value", () => {
    const args = argsFor("z-ai/glm-5.2");
    expect(args[args.indexOf("--model") + 1]).toBe("z-ai/glm-5.2");
  });

  // The end of the chain: a refused resolution never produces a model, so nothing unusable
  // can be there to pass on.
  it("has no --model at all when the directory named none", () => {
    expect(argsFor(null)).not.toContain("--model");
  });
});
