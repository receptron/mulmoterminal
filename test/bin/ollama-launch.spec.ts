import { describe, it, expect } from "vitest";
import {
  parseClaudeOllamaArgs,
  buildClaudeEnv,
  buildOllamaServeEnv,
  buildClaudeArgs,
  modelIsInstalled,
  MINIMAL_PROMPT_FLAGS,
  OLLAMA_CONTEXT_LENGTH,
} from "../../bin/ollama-launch.js";

describe("parseClaudeOllamaArgs", () => {
  it("takes the first arg as the model and passes the rest to claude", () => {
    expect(parseClaudeOllamaArgs(["qwen3:4b", "-p", "hi"])).toEqual({ help: false, model: "qwen3:4b", claudeArgs: ["-p", "hi"] });
  });

  it("has no claude args when only a model is given", () => {
    expect(parseClaudeOllamaArgs(["qwen3:4b"])).toEqual({ help: false, model: "qwen3:4b", claudeArgs: [] });
  });

  it("asks for help with no args or -h/--help", () => {
    for (const argv of [[], ["-h"], ["--help"]]) {
      expect(parseClaudeOllamaArgs(argv)).toEqual({ help: true, model: null, claudeArgs: [] });
    }
  });
});

describe("buildClaudeEnv", () => {
  const base = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-should-be-removed", HOME: "/home/me" };
  const env = buildClaudeEnv(base, "qwen3:4b", "http://127.0.0.1:12345");

  // The whole point: a lingering ANTHROPIC_API_KEY makes Claude ignore the base URL, so it
  // must be gone, not just overwritten.
  it("removes ANTHROPIC_API_KEY", () => {
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
  });

  it("points Claude at the local server with a dummy token", () => {
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:12345");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("ollama");
  });

  // The main and background slots both resolve to the local model (there is no local haiku).
  it("sets both the model and the small/fast model", () => {
    expect(env.ANTHROPIC_MODEL).toBe("qwen3:4b");
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe("qwen3:4b");
  });

  // A reasoning model burns the first budget on thinking; too small a ceiling → empty first turn.
  it("keeps a generous output ceiling", () => {
    expect(Number(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS)).toBeGreaterThanOrEqual(8000);
  });

  it("preserves the rest of the environment and does not mutate the input", () => {
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/me");
    expect(base.ANTHROPIC_API_KEY).toBe("sk-should-be-removed"); // input untouched
  });
});

describe("buildOllamaServeEnv", () => {
  it("sets the host and a big context, keeping the base env", () => {
    const env = buildOllamaServeEnv({ PATH: "/usr/bin" }, "127.0.0.1:11500");
    expect(env.OLLAMA_HOST).toBe("127.0.0.1:11500");
    expect(env.OLLAMA_CONTEXT_LENGTH).toBe(String(OLLAMA_CONTEXT_LENGTH));
    expect(env.PATH).toBe("/usr/bin");
  });

  it("takes an explicit context length as a string", () => {
    expect(buildOllamaServeEnv({}, "h", 8192).OLLAMA_CONTEXT_LENGTH).toBe("8192");
  });
});

describe("buildClaudeArgs", () => {
  // The prompt-shrinking flags are what let a small model use tools at all — they must always
  // be present, ahead of the user's args.
  it("prepends the minimal-prompt flags", () => {
    expect(buildClaudeArgs(["-p", "hi"])).toEqual([...MINIMAL_PROMPT_FLAGS, "-p", "hi"]);
  });

  it("includes --bare and --disable-slash-commands", () => {
    expect(buildClaudeArgs([])).toContain("--bare");
    expect(buildClaudeArgs([])).toContain("--disable-slash-commands");
  });
});

describe("modelIsInstalled", () => {
  const tags = { models: [{ name: "qwen3:4b" }, { name: "llama3.1:8b" }, { name: "mistral:latest" }] };

  it("finds an exact tag", () => {
    expect(modelIsInstalled(tags, "qwen3:4b")).toBe(true);
  });

  // `ollama run mistral` resolves to mistral:latest — accept the bare name too.
  it("accepts a bare name that resolves to :latest", () => {
    expect(modelIsInstalled(tags, "mistral")).toBe(true);
  });

  it("is false for a model that is not pulled", () => {
    expect(modelIsInstalled(tags, "qwen3:32b")).toBe(false);
  });

  it("is false (no throw) for junk tag payloads", () => {
    expect(modelIsInstalled(null, "qwen3:4b")).toBe(false);
    expect(modelIsInstalled({}, "qwen3:4b")).toBe(false);
    expect(modelIsInstalled({ models: "nope" }, "qwen3:4b")).toBe(false);
  });
});
