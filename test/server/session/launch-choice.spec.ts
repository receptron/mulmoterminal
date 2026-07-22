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
  // The finding that made this all-or-nothing (Codex, PR #587): dropping the provider while
  // keeping the model resolves to ANTHROPIC running another vendor's model id — the exact
  // silent wrong-backend this feature exists to prevent. The whole pick goes instead, and
  // the directory's own default decides.
  it("drops the whole pair when the model half is unusable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(launchChoiceFromParams(params("provider=openrouter&model=%20"))).toBeUndefined();
  });

  it("drops the whole pair when the provider half is unusable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(launchChoiceFromParams(params("provider=not%20an%20id&model=z-ai%2Fglm-5.2"))).toBeUndefined();
  });

  it("says which param it ignored", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    launchChoiceFromParams(params("provider=%3Bwhoami"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("provider"));
  });
});

describe("effectiveChoice", () => {
  const DIR = { provider: "openrouter", model: "moonshotai/kimi-k2.6" };
  const fresh = (over: Partial<Parameters<typeof effectiveChoice>[0]> = {}) => effectiveChoice({ dir: DIR, resuming: false, ...over });

  it("uses the directory's default when the form picked nothing", () => {
    expect(fresh()).toEqual(DIR);
  });

  it("lets the launch pick win over the directory's default", () => {
    const picked = { provider: "openrouter", model: "z-ai/glm-5.2" };
    expect(fresh({ launch: picked })).toEqual(picked);
  });

  // The pairing is the part that has to be right: keeping the directory's provider while
  // taking the form's model would aim one vendor's id at another vendor's endpoint.
  it("does not blend the two — a picked model drops the directory's provider", () => {
    expect(fresh({ launch: { provider: null, model: "claude-opus-4-8" } })).toEqual({ provider: null, model: "claude-opus-4-8" });
  });

  it("passes a picked provider with no model through, for resolveProvider to refuse", () => {
    expect(fresh({ launch: { provider: "openrouter", model: null } })).toEqual({ provider: "openrouter", model: null });
  });

  it("works from a directory with no provider or model at all", () => {
    expect(effectiveChoice({ dir: { provider: null, model: null }, resuming: false })).toEqual({ provider: null, model: null });
  });
});

// Codex's other finding on PR #587: the cell re-sends its pick on every reconnect, so a
// resume could apply a choice belonging to a different session.
describe("effectiveChoice while resuming", () => {
  const DIR = { provider: null, model: null };
  const STALE = { provider: "openrouter", model: "z-ai/glm-5.2" };
  const STARTED_ON = { provider: "openrouter", model: "moonshotai/kimi-k2.7-code" };

  it("ignores the browser's pick and continues on what the session started on", () => {
    expect(effectiveChoice({ launch: STALE, remembered: STARTED_ON, dir: DIR, resuming: true })).toEqual(STARTED_ON);
  });

  // The dangerous shape: a cell holding a stale pick reattaches a session that was never
  // started on a provider at all. Resuming it must not move the conversation elsewhere.
  it("does not apply a stale pick to a session this server never started on one", () => {
    expect(effectiveChoice({ launch: STALE, remembered: undefined, dir: DIR, resuming: true })).toEqual(DIR);
  });

  it("falls back to the directory's default, not to nothing, when the memory is gone", () => {
    const dir = { provider: "openrouter", model: "moonshotai/kimi-k2.6" };
    expect(effectiveChoice({ dir, resuming: true })).toEqual(dir);
  });

  // A resume keeps the provider it began on rather than silently sliding to the directory
  // default halfway through a conversation.
  it("keeps a remembered provider even when the directory names none", () => {
    expect(effectiveChoice({ remembered: STARTED_ON, dir: DIR, resuming: true })).toEqual(STARTED_ON);
  });
});
