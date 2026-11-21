// @vitest-environment node
// What a conversation spent and on which model, and how much each reply weighed (#3395): one weight per
// reply id, and per-model totals with every count Claude Code started added up.
import { describe, it, expect } from "vitest";
import {
  costRecordTotals,
  emptySpendState,
  foldSpendRecord,
  isSpendState,
  modelName,
  parseSpendTotals,
  SPEND_SLOT_MS,
  spendTotals,
  spentUsd,
  takeReplies,
  UNKNOWN_MODEL,
  type ReplyWeight,
  type SpendState,
} from "../../../../server/backends/library/spend-fold";
import { seededRandom } from "../../../helpers/seededRandom";

const HOUR_MS = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-10T08:00:00.000Z");
const iso = (at_ms: number): string => new Date(at_ms).toISOString();
const none = { costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const reply = (at_ms: number, id: string, usage: Record<string, number>, model = "claude-opus-5"): Record<string, unknown> => ({
  type: "assistant",
  timestamp: iso(at_ms),
  message: { id, model, usage },
});
const cost = (startTime: number | undefined, models: Record<string, Record<string, number>>, totalCostUSD?: number): Record<string, unknown> => ({
  type: "cost-state",
  startTime,
  totalCostUSD,
  modelUsage: models,
});

function fold(records: Record<string, unknown>[], spend: SpendState = emptySpendState()): { spend: SpendState; replies: ReplyWeight[] } {
  records.forEach((record) => foldSpendRecord(spend, record, typeof record.timestamp === "string" ? Date.parse(record.timestamp) : null));
  return { spend, replies: takeReplies(spend) };
}

describe("the replies", () => {
  it("weighs each by its tokens at their relative prices, in the 15-minute slot it was written in", () => {
    const { replies } = fold([
      reply(T0 + 60_000, "a", { input_tokens: 100, output_tokens: 20 }),
      reply(T0 + HOUR_MS, "b", { cache_read_input_tokens: 1000, cache_creation_input_tokens: 80 }),
    ]);
    expect(replies).toEqual([
      { id: "a", at_ms: T0, model: "claude-opus-5", weight: 200 },
      { id: "b", at_ms: T0 + HOUR_MS, model: "claude-opus-5", weight: 200 },
    ]);
    expect(SPEND_SLOT_MS).toBe(15 * 60 * 1000);
  });

  it("keeps one per id, the newest record standing, an id from the record when the message has none", () => {
    const { replies } = fold([
      reply(T0, "a", { output_tokens: 10 }),
      reply(T0, "a", { output_tokens: 30 }),
      { type: "assistant", uuid: "u1", timestamp: iso(T0), message: { model: "claude-opus-5[1m]", usage: { output_tokens: 1 } } },
    ]);
    expect(replies.map((one) => [one.id, one.model, one.weight])).toEqual([
      ["a", "claude-opus-5", 150],
      ["u1", "claude-opus-5", 5],
    ]);
  });

  it("ignores a reply with no usage, a placeholder model, no id at all, or no time", () => {
    const { replies } = fold([
      { type: "assistant", timestamp: iso(T0), message: { id: "x", model: "claude-opus-5" } },
      reply(T0, "y", { output_tokens: 5 }, "<synthetic>"),
      { type: "assistant", timestamp: iso(T0), message: { model: "claude-opus-5", usage: { output_tokens: 5 } } },
      { type: "assistant", message: { id: "z", model: "claude-opus-5", usage: { output_tokens: 5 } } },
    ]);
    expect(replies).toEqual([]);
  });
});

describe("counts", () => {
  it("adds every count's highest total, and a lower total in the same count changes nothing", () => {
    const { spend } = fold([cost(1, { m: { costUSD: 5 } }), cost(1, { m: { costUSD: 4 } }), cost(2, { m: { costUSD: 1 } }), cost(2, { m: { costUSD: 1.5 } })]);
    expect(spentUsd(spend)).toBe(6.5);
    expect(spendTotals(spend)).toEqual({ m: { ...none, costUsd: 6.5 } });
  });

  it("continues a count Claude Code goes back to rather than counting it again", () => {
    const { spend } = fold([cost(1, { m: { costUSD: 5 } }), cost(2, { m: { costUSD: 1 } }), cost(1, { m: { costUSD: 6 } })]);
    expect(spentUsd(spend)).toBe(7);
  });

  it("follows one overall cost when records give it per model in one and only overall in another", () => {
    const toOverall = fold([cost(1, { m: { costUSD: 5, outputTokens: 9 } }), cost(1, {}, 6)]).spend;
    expect(spentUsd(toOverall)).toBe(6);
    expect(spendTotals(toOverall)).toEqual({ m: { ...none, costUsd: 5, output: 9 }, [UNKNOWN_MODEL]: { ...none, costUsd: 1 } });
    const toModels = fold([cost(1, {}, 6), cost(1, { m: { costUSD: 7 } })]).spend;
    expect(spentUsd(toModels)).toBe(7);
    expect(spendTotals(toModels)).toEqual({ m: { ...none, costUsd: 7 } });
  });

  it("keeps what a model reached when a record leaves it out", () => {
    const { spend } = fold([cost(1, { a: { costUSD: 2 }, b: { costUSD: 4 } }), cost(1, { a: { costUSD: 3 } })]);
    expect(spentUsd(spend)).toBe(7);
    expect(spendTotals(spend)).toEqual({ a: { ...none, costUsd: 3 }, b: { ...none, costUsd: 4 } });
  });

  it("has spent nothing known before the first cost record, nor from one it cannot read", () => {
    expect(spentUsd(fold([reply(T0, "a", { output_tokens: 1 }), { type: "cost-state", totalCostUSD: "1" }]).spend)).toBeNull();
  });
});

describe("costRecordTotals", () => {
  it("names a model as its replies do, adding the variants of one model together", () => {
    expect(modelName("claude-opus-5[1m]")).toBe("claude-opus-5");
    expect(modelName("[1m]")).toBe("[1m]");
    const totals = costRecordTotals(
      cost(1, { "claude-opus-5[1m]": { costUSD: 1, inputTokens: 2 }, "claude-opus-5": { costUSD: 0.5, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 } }),
    );
    expect(totals).toEqual({ "claude-opus-5": { costUsd: 1.5, input: 2, output: 0, cacheRead: 4, cacheWrite: 3 } });
  });

  it("takes the overall cost as an unknown model when there is no breakdown, and nothing that is not a number", () => {
    expect(costRecordTotals({ type: "cost-state", totalCostUSD: 2 })).toEqual({ [UNKNOWN_MODEL]: { ...none, costUsd: 2 } });
    expect(costRecordTotals({ type: "cost-state", totalCostUSD: "2" })).toEqual({});
    expect(costRecordTotals({ type: "cost-state", modelUsage: { m: "x", n: { costUSD: -3, outputTokens: "9" } } })).toEqual({ n: none });
  });
});

describe("what is kept between batches", () => {
  it("hands over the replies once, and reads back only a drained state", () => {
    const spend = emptySpendState();
    foldSpendRecord(spend, cost(1, { m: { costUSD: 1 } }), null);
    expect(isSpendState(JSON.parse(JSON.stringify(spend)))).toBe(true);
    foldSpendRecord(spend, reply(T0, "a", { output_tokens: 1 }), T0);
    expect(isSpendState(spend)).toBe(false);
    expect(takeReplies(spend)).toHaveLength(1);
    expect(takeReplies(spend)).toEqual([]);
    expect(isSpendState(spend)).toBe(true);
  });

  it.each([
    ["not an object", 1],
    ["a count with a wrong-typed total", { ...emptySpendState(), runs: { "1": { costUsd: 1, models: { m: { costUsd: "1" } } } } }],
    ["a count with no overall cost", { ...emptySpendState(), runs: { "1": { models: {} } } }],
    ["no runs", { unwritten: {} }],
  ])("rejects %s", (_, value) => {
    expect(isSpendState(value)).toBe(false);
  });

  it("reads a conversation's totals back from its row, and none from anything off-shape", () => {
    expect(parseSpendTotals(JSON.stringify({ m: { ...none, costUsd: 2 }, bad: { costUsd: "1" } }))).toEqual({ m: { ...none, costUsd: 2 } });
    expect([parseSpendTotals("not json"), parseSpendTotals(null), parseSpendTotals("[1]")]).toEqual([{}, {}, {}]);
  });
});

describe("generated transcripts", () => {
  const SEEDS = Array.from({ length: 40 }, (_, n) => n + 1);
  const MODELS = ["claude-opus-5", "claude-fable-5-1", "claude-haiku-4-5"];

  it.each(SEEDS)("seed %i: the totals add up to every count's highest overall cost, in batches as in one go", (seed) => {
    const random = seededRandom(seed);
    const records: Record<string, unknown>[] = [];
    const highest = new Map<number, number>();
    const totalsByRun = new Map<number, Map<string, number>>();
    const weights = new Map<string, number>();
    let at_ms = T0;
    let run = 1;
    Array.from({ length: 60 }, (_, step) => step).forEach((step) => {
      at_ms += random.below(3) * SPEND_SLOT_MS + random.below(1000);
      if (random.below(10) < 6) {
        const id = `m${String(random.below(30))}`;
        const output = random.below(50);
        records.push(reply(at_ms, id, { output_tokens: output }, random.pick(MODELS)));
        weights.set(id, output * 5);
        return;
      }
      const turn = random.below(8);
      if (turn === 0) run += 1;
      else if (turn === 1 && run > 1) run = 1 + random.below(run); // Claude Code back on an earlier count
      const totals = totalsByRun.get(run) ?? new Map<string, number>();
      totalsByRun.set(run, totals);
      const model = random.pick(MODELS);
      totals.set(model, (totals.get(model) ?? 0) + random.below(4) + step / 100); // within a count a total only grows
      records.push(cost(run, Object.fromEntries([...totals].map(([name, usd]) => [`${name}[1m]`, { costUSD: usd }]))));
      highest.set(
        run,
        Math.max(
          highest.get(run) ?? 0,
          [...totals.values()].reduce((a, b) => a + b, 0),
        ),
      );
    });
    const expected = [...highest.values()].reduce((sum, usd) => sum + usd, 0);
    const whole = fold(records);
    const totalCost = (spend: SpendState): number => Object.values(spendTotals(spend)).reduce((sum, totals) => sum + totals.costUsd, 0);
    expect(spentUsd(whole.spend) ?? 0).toBeCloseTo(expected, 6);
    expect(totalCost(whole.spend)).toBeCloseTo(expected, 6);
    const split = random.below(records.length);
    const first = fold(records.slice(0, split));
    const resumed: unknown = JSON.parse(JSON.stringify(first.spend));
    if (!isSpendState(resumed)) throw new Error(`seed ${String(seed)}: the state did not read back`);
    const second = fold(records.slice(split), resumed);
    expect(totalCost(second.spend)).toBeCloseTo(expected, 6);
    const kept = new Map([...first.replies, ...second.replies].map((one) => [one.id, one.weight]));
    expect(kept).toEqual(weights);
  });
});
