// @vitest-environment node
// Where a conversation's spending goes in time (#3395): its per-model totals split over its replies by
// weight when read.
import { describe, it, expect } from "vitest";
import { splitSpend, type SpendConversation, type SpendInputs } from "../../../../server/backends/library/spend-split";
import { seededRandom } from "../../../helpers/seededRandom";

const none = { costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const conversation = (over: Partial<SpendConversation>): SpendConversation => ({
  path: "/p/a",
  cwd: "/w/app",
  agent: "claude",
  startedAt: 5,
  totals: {},
  ...over,
});
const byPlace = (inputs: SpendInputs): Record<string, number> =>
  Object.fromEntries(splitSpend(inputs).map((share) => [`${String(share.at_ms)} ${share.model}`, Math.round(share.costUsd * 1e9) / 1e9]));

describe("splitSpend", () => {
  it("splits a model's totals over its own replies by weight, tokens alike", () => {
    const shares = splitSpend({
      conversations: [conversation({ totals: { m: { ...none, costUsd: 4, output: 40 } } })],
      slots: [
        { path: "/p/a", at_ms: 100, model: "m", weight: 1 },
        { path: "/p/a", at_ms: 200, model: "m", weight: 3 },
      ],
      wholeWeights: [{ path: "/p/a", model: "m", weight: 4 }],
    });
    expect(shares).toEqual([
      { cwd: "/w/app", agent: "claude", at_ms: 100, model: "m", ...none, costUsd: 1, output: 10 },
      { cwd: "/w/app", agent: "claude", at_ms: 200, model: "m", ...none, costUsd: 3, output: 30 },
    ]);
  });

  it("gives only the slots shown their share of the whole weight", () => {
    const inputs = {
      conversations: [conversation({ totals: { m: { ...none, costUsd: 4 } } })],
      slots: [{ path: "/p/a", at_ms: 200, model: "m", weight: 3 }],
      wholeWeights: [{ path: "/p/a", model: "m", weight: 4 }],
    };
    expect(byPlace(inputs)).toEqual({ "200 m": 3 });
  });

  it("splits a model with no reply of its own over every reply, and a conversation with none at its start", () => {
    const inputs = {
      conversations: [
        conversation({ totals: { m: { ...none, costUsd: 2 }, helper: { ...none, costUsd: 3 }, "": { ...none, costUsd: 1 } } }),
        conversation({ path: "/p/b", startedAt: 7, totals: { m: { ...none, costUsd: 5 } } }),
        conversation({ path: "/p/c", startedAt: null, totals: { m: { ...none, costUsd: 5 } } }),
      ],
      slots: [
        { path: "/p/a", at_ms: 100, model: "m", weight: 1 },
        { path: "/p/a", at_ms: 100, model: "other", weight: 1 },
        { path: "/p/a", at_ms: 200, model: "m", weight: 2 },
      ],
      wholeWeights: [
        { path: "/p/a", model: "m", weight: 3 },
        { path: "/p/a", model: "other", weight: 1 },
      ],
    };
    expect(byPlace(inputs)).toEqual({ "100 m": 0.666666667, "200 m": 1.333333333, "100 helper": 1.5, "200 helper": 1.5, "100 ": 0.5, "200 ": 0.5, "7 m": 5 });
  });

  it("answers nothing for a conversation with no totals or no inputs", () => {
    expect(splitSpend({ conversations: [conversation({})], slots: [], wholeWeights: [] })).toEqual([]);
    expect(splitSpend({ conversations: [], slots: [{ path: "/p/a", at_ms: 1, model: "m", weight: 1 }], wholeWeights: [] })).toEqual([]);
  });

  it.each(Array.from({ length: 30 }, (_, n) => n + 1))("seed %i: with every slot shown, the shares add up to the totals", (seed) => {
    const random = seededRandom(seed);
    const models = ["a", "b", "c"];
    const slots = Array.from({ length: 1 + random.below(12) }, (_, n) => ({
      path: "/p/a",
      at_ms: random.below(6),
      model: random.pick(models.slice(0, 2)),
      weight: 1 + random.below(9) + n / 10,
    }));
    const merged = new Map<string, (typeof slots)[number]>();
    slots.forEach((slot) => {
      const key = `${String(slot.at_ms)}|${slot.model}`;
      const known = merged.get(key);
      merged.set(key, known === undefined ? { ...slot } : { ...known, weight: known.weight + slot.weight });
    });
    const shown = [...merged.values()];
    const wholeWeights = models.map((model) => ({
      path: "/p/a",
      model,
      weight: shown.filter((slot) => slot.model === model).reduce((sum, slot) => sum + slot.weight, 0),
    }));
    const totals = Object.fromEntries(models.map((model) => [model, { ...none, costUsd: random.below(100) / 10, output: random.below(1000) }]));
    const shares = splitSpend({ conversations: [conversation({ totals })], slots: shown, wholeWeights });
    models.forEach((model) => {
      const of = shares.filter((share) => share.model === model);
      expect(of.reduce((sum, share) => sum + share.costUsd, 0)).toBeCloseTo(totals[model]?.costUsd ?? 0, 9);
      expect(of.reduce((sum, share) => sum + share.output, 0)).toBeCloseTo(totals[model]?.output ?? 0, 9);
    });
  });
});
