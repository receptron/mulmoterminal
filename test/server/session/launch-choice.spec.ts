// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

import { effectiveChoice, launchChoiceFromParams } from "../../../server/session/launch-choice.js";

const params = (query: string) => new URLSearchParams(query);

afterEach(() => vi.restoreAllMocks());

describe("launchChoiceFromParams", () => {
  // The overwhelmingly common case: no picker involvement, so the directory's own
  // .mulmoterminal.json must be left to decide.
  it("is undefined when neither param is present", () => {
    expect(launchChoiceFromParams(params("cwd=/tmp&gui=0"))).toBeUndefined();
  });

  it("carries a provider/model pair through", () => {
    expect(launchChoiceFromParams(params("provider=openrouter&model=moonshotai%2Fkimi-k2.7-code"))).toEqual({
      provider: "openrouter",
      model: "moonshotai/kimi-k2.7-code",
    });
  });

  // A bare model is a real pick on the default Anthropic backend ("run this one on Opus"),
  // so it must not require a provider to travel.
  it("allows a model with no provider", () => {
    expect(launchChoiceFromParams(params("model=claude-opus-4-8"))).toEqual({ provider: null, model: "claude-opus-4-8" });
  });

  // resolveProvider is the one that explains what's missing, so this half-choice has to
  // reach it rather than being dropped here.
  it("allows a provider with no model", () => {
    expect(launchChoiceFromParams(params("provider=openrouter"))).toEqual({ provider: "openrouter", model: null });
  });

  it("trims surrounding whitespace", () => {
    expect(launchChoiceFromParams(params("model=%20glm-5.2%20"))?.model).toBe("glm-5.2");
  });

  // These two values become `claude --model <value>` in argv and ANTHROPIC_MODEL in the
  // child's environment. Anything that isn't shaped like a model id is dropped, not passed.
  it.each([
    ["a leading dash argv would read as a flag", "model=--dangerously-skip-permissions"],
    ["an embedded space", "model=kimi%20k2"],
    ["a newline", "model=kimi%0Aecho"],
    ["a shell metacharacter", "model=kimi%3Brm%20-rf%20%2F"],
    ["a NUL byte", "model=kimi%00"],
    ["an empty value", "model="],
    ["only whitespace", "model=%20%20"],
  ])("drops a model with %s", (_why, query) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(launchChoiceFromParams(params(query))).toBeUndefined();
  });

  it("drops an absurdly long id rather than putting it in argv", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(launchChoiceFromParams(params(`model=${"m".repeat(121)}`))).toBeUndefined();
    expect(launchChoiceFromParams(params(`model=${"m".repeat(120)}`))?.model).toHaveLength(120);
  });

  // One bad half must not silently promote the other half into a pair the user never
  // chose — but the good half is still a choice, so it travels and resolveProvider judges it.
  it("keeps the usable half when the other is rejected", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(launchChoiceFromParams(params("provider=openrouter&model=%20"))).toEqual({ provider: "openrouter", model: null });
  });

  it("says which param it ignored", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    launchChoiceFromParams(params("provider=%3Bwhoami"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("provider"));
  });
});

describe("effectiveChoice", () => {
  const DIR = { provider: "openrouter", model: "moonshotai/kimi-k2.6" };

  it("uses the directory's default when the form picked nothing", () => {
    expect(effectiveChoice(undefined, DIR)).toEqual(DIR);
  });

  it("lets the launch pick win over the directory's default", () => {
    const picked = { provider: "openrouter", model: "z-ai/glm-5.2" };
    expect(effectiveChoice(picked, DIR)).toEqual(picked);
  });

  // The pairing is the part that has to be right: keeping the directory's provider while
  // taking the form's model would aim one vendor's id at another vendor's endpoint.
  it("does not blend the two — a picked model drops the directory's provider", () => {
    expect(effectiveChoice({ provider: null, model: "claude-opus-4-8" }, DIR)).toEqual({ provider: null, model: "claude-opus-4-8" });
  });

  it("passes a picked provider with no model through, for resolveProvider to refuse", () => {
    expect(effectiveChoice({ provider: "openrouter", model: null }, DIR)).toEqual({ provider: "openrouter", model: null });
  });

  it("works from a directory with no provider or model at all", () => {
    expect(effectiveChoice(undefined, { provider: null, model: null })).toEqual({ provider: null, model: null });
  });
});
