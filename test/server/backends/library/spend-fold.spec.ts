// @vitest-environment node
// What a conversation spent, when and on which model (#3395): cost records shared out over the replies
// between them, adding back up to what Claude Code recorded.
import { describe, it, expect } from "vitest";
import {
  costRecordTotals,
  emptySpendState,
  foldSpendRecord,
  isSpendState,
  modelName,
  RECENT_REPLIES,
  SPEND_SLOT_MS,
  spentUsd,
  takeSpent,
  UNKNOWN_MODEL,
  type SpendRow,
  type SpendState,
} from "../../../../server/backends/library/spend-fold";
import { seededRandom } from "../../../helpers/seededRandom";

const HOUR_MS = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-10T08:00:00.000Z");
const iso = (at_ms: number): string => new Date(at_ms).toISOString();

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

function fold(records: Record<string, unknown>[], spend: SpendState = emptySpendState()): { spend: SpendState; rows: SpendRow[] } {
  records.forEach((record) => {
    const at = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : null;
    foldSpendRecord(spend, record, at);
  });
  return { spend, rows: takeSpent(spend) };
}

const costBySlot = (rows: SpendRow[]): Record<string, number> =>
  Object.fromEntries(rows.map((row) => [`${iso(row.at_ms)} ${row.model}`, Math.round(row.costUsd * 1e9) / 1e9]));

describe("sharing a cost record out over the replies before it", () => {
  it("weighs each reply by its tokens at their relative prices, in the 15-minute slot it was written in", () => {
    const { rows } = fold([
      reply(T0, "a", { input_tokens: 100 }), // 100
      reply(T0 + 2 * HOUR_MS, "b", { output_tokens: 20, cache_read_input_tokens: 1000 }), // 100 + 100
      reply(T0 + 2 * HOUR_MS + 60_000, "c", { cache_creation_input_tokens: 80 }), // 100, same slot as b
      cost(1, { "claude-opus-5[1m]": { costUSD: 4, outputTokens: 400 } }),
    ]);
    expect(costBySlot(rows)).toEqual({ [`${iso(T0)} claude-opus-5`]: 1, [`${iso(T0 + 2 * HOUR_MS)} claude-opus-5`]: 3 });
    expect(rows.map((row) => row.output)).toEqual([100, 300]);
  });

  it("counts a reply written as several records once, with its newest usage", () => {
    const { rows } = fold([
      reply(T0, "a", { output_tokens: 10 }),
      reply(T0, "a", { output_tokens: 30 }),
      reply(T0 + HOUR_MS, "b", { output_tokens: 30 }),
      cost(1, { "claude-opus-5": { costUSD: 2 } }),
    ]);
    expect(Object.values(costBySlot(rows))).toEqual([1, 1]);
  });

  it("forgets the oldest replies past RECENT_REPLIES", () => {
    const replies = Array.from({ length: RECENT_REPLIES + 1 }, (_, n) => reply(T0, `r${String(n)}`, { output_tokens: 1 }));
    const { spend } = fold(replies);
    expect(spend.recent.map((known) => known.id)).toEqual(replies.slice(1).map((_, n) => `r${String(n + 1)}`));
  });

  it("gives a model with no reply of its own every reply's weight, and with no reply at all the last moment known", () => {
    const { rows } = fold([
      reply(T0, "a", { output_tokens: 10 }),
      reply(T0 + HOUR_MS, "b", { output_tokens: 30 }),
      cost(1, { "claude-opus-5": { costUSD: 2 }, "claude-haiku-4-5": { costUSD: 4 } }),
      { type: "user", timestamp: iso(T0 + 5 * HOUR_MS) },
      cost(1, { "claude-opus-5": { costUSD: 3 } }),
    ]);
    expect(costBySlot(rows)).toEqual({
      [`${iso(T0)} claude-opus-5`]: 0.5,
      [`${iso(T0 + HOUR_MS)} claude-opus-5`]: 1.5,
      [`${iso(T0)} claude-haiku-4-5`]: 1,
      [`${iso(T0 + HOUR_MS)} claude-haiku-4-5`]: 3,
      [`${iso(T0 + 5 * HOUR_MS)} claude-opus-5`]: 1,
    });
  });

  it("places a cost with no time before it at the count's start, or else holds it for the first time the file has", () => {
    expect(costBySlot(fold([cost(T0, { m: { costUSD: 1 } })]).rows)).toEqual({ [`${iso(T0)} m`]: 1 });
    const nowhere = fold([cost(undefined, { m: { costUSD: 1 } })]);
    expect(nowhere.rows).toEqual([]);
    expect(spentUsd(nowhere.spend)).toBe(1);
    const later = fold([{ type: "user", timestamp: iso(T0 + HOUR_MS) }, cost(undefined, { m: { costUSD: 1 } })], nowhere.spend);
    expect(costBySlot(later.rows)).toEqual({ [`${iso(T0 + HOUR_MS)} m`]: 1 });
  });

  it("does not count a reply again when its records fall on both sides of a cost record", () => {
    const { rows } = fold([
      reply(T0, "a", { output_tokens: 10 }),
      cost(1, { m: { costUSD: 1 } }),
      reply(T0, "a", { output_tokens: 10 }),
      reply(T0 + HOUR_MS, "b", { output_tokens: 10 }),
      cost(1, { m: { costUSD: 3 } }),
    ]);
    expect(costBySlot(rows)).toEqual({ [`${iso(T0)} m`]: 1, [`${iso(T0 + HOUR_MS)} m`]: 2 });
  });
});

describe("counts", () => {
  it("adds every count's highest total, and a lower total in the same count changes nothing", () => {
    const { spend, rows } = fold([
      reply(T0, "a", { output_tokens: 1 }),
      cost(1, { m: { costUSD: 5 } }),
      cost(1, { m: { costUSD: 4 } }),
      reply(T0 + HOUR_MS, "b", { output_tokens: 1 }),
      cost(2, { m: { costUSD: 1 } }),
      cost(2, { m: { costUSD: 1.5 } }),
    ]);
    expect(spentUsd(spend)).toBe(6.5);
    expect(rows.reduce((sum, row) => sum + row.costUsd, 0)).toBeCloseTo(6.5, 9);
  });

  it("follows one overall cost when records give it per model in one and only overall in another", () => {
    const toOverall = fold([reply(T0, "a", { output_tokens: 1 }), cost(1, { m: { costUSD: 5 } }), cost(1, {}, 6)]);
    expect(spentUsd(toOverall.spend)).toBe(6);
    expect(costBySlot(toOverall.rows)).toEqual({ [`${iso(T0)} m`]: 5, [`${iso(T0)} ${UNKNOWN_MODEL}`]: 1 });
    const toModels = fold([reply(T0, "a", { output_tokens: 1 }), cost(1, {}, 6), cost(1, { m: { costUSD: 7 } })]);
    expect(spentUsd(toModels.spend)).toBe(7);
    expect(toModels.rows.reduce((sum, row) => sum + row.costUsd, 0)).toBeCloseTo(7, 9);
  });

  it("continues a count Claude Code goes back to rather than counting it again", () => {
    const { spend, rows } = fold([
      reply(T0, "a", { output_tokens: 1 }),
      cost(1, { m: { costUSD: 5 } }),
      cost(2, { m: { costUSD: 1 } }),
      cost(1, { m: { costUSD: 6 } }),
    ]);
    expect(spentUsd(spend)).toBe(7);
    expect(rows.reduce((sum, row) => sum + row.costUsd, 0)).toBeCloseTo(7, 9);
  });

  it("has spent nothing known before the first cost record", () => {
    expect(spentUsd(fold([reply(T0, "a", { output_tokens: 1 })]).spend)).toBeNull();
  });
});

describe("costRecordTotals", () => {
  it("names a model as its replies do, adding the variants of one model together", () => {
    expect(modelName("claude-opus-5[1m]")).toBe("claude-opus-5");
    const totals = costRecordTotals(
      cost(1, { "claude-opus-5[1m]": { costUSD: 1, inputTokens: 2 }, "claude-opus-5": { costUSD: 0.5, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 } }),
    );
    expect(totals).toEqual({ "claude-opus-5": { costUsd: 1.5, input: 2, output: 0, cacheRead: 4, cacheWrite: 3 } });
  });

  it("takes the overall cost as an unknown model when there is no breakdown, and nothing that is not a number", () => {
    expect(costRecordTotals({ type: "cost-state", totalCostUSD: 2 })).toEqual({
      [UNKNOWN_MODEL]: { costUsd: 2, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    expect(costRecordTotals({ type: "cost-state", totalCostUSD: "2" })).toEqual({});
    expect(costRecordTotals({ type: "cost-state", modelUsage: { m: "x", n: { costUSD: -3, outputTokens: "9" } } })).toEqual({
      n: { costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it("ignores a cost record with nothing it can read, a reply with no usage or a placeholder model, and an untimed reply", () => {
    const { spend, rows } = fold([
      { type: "cost-state", totalCostUSD: "1" },
      { type: "assistant", timestamp: iso(T0), message: { id: "x", model: "claude-opus-5" } },
      reply(T0, "y", { output_tokens: 5 }, "<synthetic>"),
      { type: "assistant", message: { id: "z", model: "claude-opus-5", usage: { output_tokens: 5 } } },
    ]);
    expect([spend.runs, spend.pending, rows]).toEqual([{}, {}, []]);
  });
});

describe("the state kept between batches", () => {
  it("hands over what was shared out once, and reads back only a drained state", () => {
    const spend = emptySpendState();
    foldSpendRecord(spend, reply(T0, "a", { output_tokens: 1 }), T0);
    expect(isSpendState(JSON.parse(JSON.stringify(spend)))).toBe(true);
    foldSpendRecord(spend, cost(1, { m: { costUSD: 1 } }), null);
    expect(isSpendState(spend)).toBe(false);
    expect(takeSpent(spend)).toHaveLength(1);
    expect(takeSpent(spend)).toEqual([]);
    expect(isSpendState(spend)).toBe(true);
  });

  it.each([
    ["not an object", 1],
    ["a count with a wrong-typed total", { ...emptySpendState(), runs: { "1": { costUsd: 1, models: { m: { costUsd: "1" } } } } }],
    ["a count with no overall cost", { ...emptySpendState(), runs: { "1": { models: {} } } }],
    ["an unplaced share that is not totals", { ...emptySpendState(), unplaced: { m: 1 } }],
    ["a pending weight that is not a number", { ...emptySpendState(), pending: { "0": { m: "1" } } }],
    ["a recent reply missing its id", { ...emptySpendState(), recent: [{ slot: 0, model: "m", weight: 1 }] }],
    ["no lastAt", { ...emptySpendState(), lastAt: undefined }],
  ])("rejects %s", (_, value) => {
    expect(isSpendState(value)).toBe(false);
  });
});

describe("generated transcripts", () => {
  const SEEDS = Array.from({ length: 40 }, (_, n) => n + 1);
  const MODELS = ["claude-opus-5", "claude-fable-5-1", "claude-haiku-4-5"];

  it.each(SEEDS)("seed %i: the shares add up to every count's highest overall total, in batches as in one go", (seed) => {
    const random = seededRandom(seed);
    const records: Record<string, unknown>[] = [];
    const highest = new Map<number, number>();
    const totalsByRun = new Map<number, Map<string, number>>();
    let at_ms = T0;
    let run = 1;
    Array.from({ length: 60 }, (_, step) => step).forEach((step) => {
      at_ms += random.below(3) * SPEND_SLOT_MS + random.below(1000);
      const kind = random.below(10);
      if (kind < 6)
        records.push(reply(at_ms, `m${String(random.below(80))}`, { output_tokens: random.below(50), input_tokens: random.below(50) }, random.pick(MODELS)));
      else if (kind < 7) records.push({ type: "user", timestamp: iso(at_ms) });
      else {
        const turn = random.below(8);
        if (turn === 0) run += 1;
        else if (turn === 1 && run > 1) run = 1 + random.below(run); // Claude Code back on an earlier count
        const totals = totalsByRun.get(run) ?? new Map<string, number>();
        totalsByRun.set(run, totals);
        const model = random.pick(MODELS);
        totals.set(model, (totals.get(model) ?? 0) + random.below(4) + step / 100); // within a count a total only grows
        const models = Object.fromEntries([...totals].map(([name, usd]) => [`${name}[1m]`, { costUSD: usd }]));
        records.push(cost(run, models));
        const overall = [...totals.values()].reduce((a, b) => a + b, 0);
        highest.set(run, Math.max(highest.get(run) ?? 0, overall));
      }
    });
    const expected = [...highest.values()].reduce((sum, usd) => sum + usd, 0);
    const whole = fold(records);
    expect(whole.rows.reduce((sum, row) => sum + row.costUsd, 0)).toBeCloseTo(expected, 6);
    expect(spentUsd(whole.spend) ?? 0).toBeCloseTo(expected, 6);
    const split = random.below(records.length);
    const first = fold(records.slice(0, split));
    const resumed: unknown = JSON.parse(JSON.stringify(first.spend));
    if (!isSpendState(resumed)) throw new Error(`seed ${String(seed)}: the state did not read back`);
    const second = fold(records.slice(split), resumed);
    const inBatches = [...first.rows, ...second.rows].reduce((sum, row) => sum + row.costUsd, 0);
    expect(inBatches).toBeCloseTo(expected, 6);
    [...whole.rows, ...first.rows, ...second.rows].forEach((row) => expect(row.costUsd).toBeGreaterThanOrEqual(0));
  });
});
