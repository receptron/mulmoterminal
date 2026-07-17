import { describe, it, expect } from "vitest";
import { rateForModel, costForUsage, costFromJsonl } from "../../server/../server/cost.js";

const line = (o: unknown) => JSON.stringify(o);
const assistant = (model: string, usage: Record<string, number>) => line({ type: "assistant", message: { model, usage } });

describe("rateForModel", () => {
  it("prices current Opus / Sonnet / Haiku models", () => {
    expect(rateForModel("claude-opus-4-8")).toEqual({
      inputPerMillion_usd: 5,
      outputPerMillion_usd: 25,
      cacheReadPerMillion_usd: 0.5,
      cacheWritePerMillion_usd: 6.25,
    });
    expect(rateForModel("claude-sonnet-5")?.inputPerMillion_usd).toBe(3);
    expect(rateForModel("claude-haiku-4-5")?.outputPerMillion_usd).toBe(5);
    expect(rateForModel("claude-fable-5")?.inputPerMillion_usd).toBe(10);
  });

  it("matches dated snapshots by family prefix", () => {
    expect(rateForModel("claude-sonnet-4-5-20250929")?.inputPerMillion_usd).toBe(3);
    expect(rateForModel("claude-opus-4-5-20251101")?.outputPerMillion_usd).toBe(25);
  });

  it("does not confuse sonnet-5 with sonnet-4-5", () => {
    expect(rateForModel("claude-sonnet-5")?.outputPerMillion_usd).toBe(15);
    expect(rateForModel("claude-sonnet-4-5")?.outputPerMillion_usd).toBe(15);
  });

  it("returns null for unknown / empty models", () => {
    expect(rateForModel("gpt-4o")).toBeNull();
    expect(rateForModel("claude-opus-4-0")).toBeNull(); // not in the table → unpriced
    expect(rateForModel("")).toBeNull();
  });
});

describe("costForUsage", () => {
  it("prices input, output, cache-read and cache-write separately", () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    };
    const { usd, priced } = costForUsage(usage, "claude-opus-4-8");
    // 5 + 25 + 0.5 + 6.25
    expect(priced).toBe(true);
    expect(usd).toBeCloseTo(36.75, 10);
  });

  it("charges cache reads at 0.1x and writes at 1.25x the input rate", () => {
    const read = costForUsage({ cache_read_input_tokens: 1_000_000 }, "claude-sonnet-5").usd;
    const write = costForUsage({ cache_creation_input_tokens: 1_000_000 }, "claude-sonnet-5").usd;
    expect(read).toBeCloseTo(0.3, 10); // 3 * 0.1
    expect(write).toBeCloseTo(3.75, 10); // 3 * 1.25
  });

  it("is unpriced (usd 0) for an unknown model", () => {
    expect(costForUsage({ input_tokens: 1_000_000 }, "some-other-model")).toEqual({ usd: 0, priced: false });
  });

  it("treats missing / negative / non-number token fields as zero", () => {
    expect(costForUsage({}, "claude-opus-4-8").usd).toBe(0);
    expect(costForUsage({ input_tokens: -50, output_tokens: "10" }, "claude-opus-4-8").usd).toBe(0);
  });
});

describe("costFromJsonl", () => {
  it("sums cost across assistant turns, per turn's own model (model switch)", () => {
    const raw = [
      assistant("claude-opus-4-8", { output_tokens: 1_000_000 }), // $25
      line({ type: "user", message: { content: "hi" } }),
      assistant("claude-sonnet-5", { output_tokens: 1_000_000 }), // $15
    ].join("\n");
    const { usd, unpricedTurns } = costFromJsonl(raw);
    expect(usd).toBeCloseTo(40, 10);
    expect(unpricedTurns).toBe(0);
  });

  it("counts turns on unpriced models and excludes them from the total", () => {
    const raw = [
      assistant("claude-opus-4-8", { output_tokens: 1_000_000 }), // $25
      assistant("mystery-model", { output_tokens: 1_000_000 }), // unpriced
    ].join("\n");
    const { usd, unpricedTurns } = costFromJsonl(raw);
    expect(usd).toBeCloseTo(25, 10);
    expect(unpricedTurns).toBe(1);
  });

  it("treats an assistant turn missing its model as unpriced", () => {
    const raw = line({ type: "assistant", message: { usage: { output_tokens: 1_000_000 } } });
    expect(costFromJsonl(raw)).toEqual({ usd: 0, unpricedTurns: 1 });
  });

  it("ignores non-assistant lines and assistant lines without usage", () => {
    const raw = [
      line({ type: "user", message: { content: "hi" } }),
      line({ type: "assistant", message: { model: "claude-opus-4-8" } }), // no usage → skipped
    ].join("\n");
    expect(costFromJsonl(raw)).toEqual({ usd: 0, unpricedTurns: 0 });
  });

  it("returns zeros for empty or malformed input", () => {
    expect(costFromJsonl("")).toEqual({ usd: 0, unpricedTurns: 0 });
    expect(costFromJsonl("not json\n{broken")).toEqual({ usd: 0, unpricedTurns: 0 });
  });
});
