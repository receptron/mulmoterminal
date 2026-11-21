// Where a conversation's spending goes in time (#3395): its per-model totals (spend-fold.ts) split over its
// replies by weight, when the retrospective is read. A model's cost per unit of weight is its price, so
// each slot of replies takes the share its weight is of the model's. A model with cost and no reply of its
// own in the transcript — a subagent's, or a cost recorded with no breakdown — is split over every reply
// by weight; a conversation with no reply at all keeps its spending at its start. Until the next cost
// record, the replies after the last one share what is already known; the next one sets it right, since
// nothing is split until read. Pure.
import type { SpendTotals } from "./spend-fold.js";
import type { RetrospectiveSpend } from "./retrospective.js";

export interface SpendConversation {
  path: string;
  cwd: string | null;
  agent: string;
  startedAt: number | null;
  totals: Record<string, SpendTotals>;
}

/** The weight a conversation's replies of one model put in one slot. */
export interface SlotWeight {
  path: string;
  at_ms: number;
  model: string;
  weight: number;
}

/** What the retrospective needs: the conversations, the weights of their replies in the slots shown, and
 *  each conversation's whole weight per model — over every slot, shown or not. */
export interface SpendInputs {
  conversations: SpendConversation[];
  slots: SlotWeight[];
  wholeWeights: { path: string; model: string; weight: number }[];
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const known = groups.get(key(item));
    if (known === undefined) groups.set(key(item), [item]);
    else known.push(item);
  });
  return groups;
}

const shareOf = (totals: SpendTotals, part: number, whole: number): SpendTotals => ({
  costUsd: (totals.costUsd * part) / whole,
  input: (totals.input * part) / whole,
  output: (totals.output * part) / whole,
  cacheRead: (totals.cacheRead * part) / whole,
  cacheWrite: (totals.cacheWrite * part) / whole,
});

/** Every slot's weight in the conversation summed over its models. */
function slotsOfAllModels(slots: readonly SlotWeight[]): { at_ms: number; weight: number }[] {
  const byAt = new Map<number, number>();
  slots.forEach((slot) => byAt.set(slot.at_ms, (byAt.get(slot.at_ms) ?? 0) + slot.weight));
  return [...byAt].map(([at_ms, weight]) => ({ at_ms, weight }));
}

function splitConversation(conversation: SpendConversation, slots: readonly SlotWeight[], whole: ReadonlyMap<string, number>): RetrospectiveSpend[] {
  const where = { cwd: conversation.cwd, agent: conversation.agent };
  const allWeight = [...whole.values()].reduce((sum, weight) => sum + weight, 0);
  return Object.entries(conversation.totals).flatMap(([model, totals]) => {
    const own = whole.get(model) ?? 0;
    if (own > 0) {
      return slots.filter((slot) => slot.model === model).map((slot) => ({ ...where, at_ms: slot.at_ms, model, ...shareOf(totals, slot.weight, own) }));
    }
    if (allWeight > 0) return slotsOfAllModels(slots).map((slot) => ({ ...where, at_ms: slot.at_ms, model, ...shareOf(totals, slot.weight, allWeight) }));
    return conversation.startedAt === null ? [] : [{ ...where, at_ms: conversation.startedAt, model, ...totals }];
  });
}

/** The spending of the slots shown, conversation by conversation and model by model. */
export function splitSpend(inputs: SpendInputs): RetrospectiveSpend[] {
  const slotsByPath = groupBy(inputs.slots, (slot) => slot.path);
  const wholeByPath = groupBy(inputs.wholeWeights, (entry) => entry.path);
  return inputs.conversations.flatMap((conversation) => {
    const whole = new Map((wholeByPath.get(conversation.path) ?? []).map((entry) => [entry.model, entry.weight]));
    return splitConversation(conversation, slotsByPath.get(conversation.path) ?? [], whole);
  });
}
