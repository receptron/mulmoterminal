// What a conversation spent, when, and on which model (#3395), folded from its transcript.
//
// Claude Code records cost only as `cost-state`: running totals, per model, with no time, written now
// and then — days apart in a long conversation. So the difference between two of them is shared out
// over the replies between them, each weighted by its tokens at their relative prices, and lands in the
// 15-minute slot the reply was written in. What is shared adds back up to the difference, so every
// total still equals what Claude Code recorded.
//
// Pure: no fs, no clock. Bounded: what is worked out is handed to the index at each commit
// (`takeSpent`) rather than kept, because the state is stored with every batch.
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { finiteNumber } from "../../../common/finiteNumber.js";

export const SPEND_SLOT_MS = 15 * 60 * 1000;
/** Replies remembered by id: one reply is written as several records, one after another. */
export const RECENT_REPLIES = 32;
/** A token's price relative to an input token, the same for every Claude model. Only the ratios
 *  matter: they decide how a known cost is shared, never what it is. */
const TOKEN_PRICE = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };
/** The model a cost record names with no per-model breakdown. */
export const UNKNOWN_MODEL = "";

export interface SpendTotals {
  costUsd: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SpendRow extends SpendTotals {
  at_ms: number;
  model: string;
}

interface RecentReply {
  id: string;
  slot: number;
  model: string;
  weight: number;
}

export interface SpendState {
  /** The count Claude Code is on (its `startTime`), and each model's highest totals in it. */
  run: { startTime: number | null; models: Record<string, SpendTotals> } | null;
  /** What the counts before this one came to, in dollars. */
  earlierRunsUsd: number;
  /** The replies since the last cost record: slot → model → weight. */
  pending: Record<string, Record<string, number>>;
  recent: RecentReply[];
  /** When the last record with a time was written. */
  lastAt: number | null;
  /** Shared out since the last commit, by `slot|model`. */
  unwritten: Record<string, SpendRow>;
}

export const emptySpendState = (): SpendState => ({ run: null, earlierRunsUsd: 0, pending: {}, recent: [], lastAt: null, unwritten: {} });

type SpendField = keyof SpendTotals;
const perField = (value: (field: SpendField) => number): SpendTotals => ({
  costUsd: value("costUsd"),
  input: value("input"),
  output: value("output"),
  cacheRead: value("cacheRead"),
  cacheWrite: value("cacheWrite"),
});
const zero = (): SpendTotals => perField(() => 0);
const slotOf = (at_ms: number): number => Math.floor(at_ms / SPEND_SLOT_MS) * SPEND_SLOT_MS;
const count = (value: unknown): number => Math.max(finiteNumber(value) ?? 0, 0);

/** `claude-opus-5[1m]` is the cost record's name for the replies' `claude-opus-5`. */
export function modelName(key: string): string {
  const open = key.lastIndexOf("[");
  return open > 0 && key.endsWith("]") ? key.slice(0, open) : key;
}

/** What all of a conversation's counts came to, or null before its first cost record. */
export const spentUsd = (spend: SpendState): number | null =>
  spend.run === null ? null : spend.earlierRunsUsd + Object.values(spend.run.models).reduce((sum, totals) => sum + totals.costUsd, 0);

export function foldSpendRecord(spend: SpendState, record: Record<string, unknown>, at_ms: number | null): void {
  if (at_ms !== null) spend.lastAt = at_ms;
  if (record.type === "assistant" && at_ms !== null) foldReply(spend, record, at_ms);
  if (record.type === "cost-state") foldCost(spend, record);
}

function replyWeight(usage: Record<string, unknown>): number {
  const tokens = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens, usage.output_tokens].map(count);
  const [input = 0, cacheWrite = 0, cacheRead = 0, output = 0] = tokens;
  return input * TOKEN_PRICE.input + cacheWrite * TOKEN_PRICE.cacheWrite + cacheRead * TOKEN_PRICE.cacheRead + output * TOKEN_PRICE.output;
}

function addPending(spend: SpendState, slot: number, model: string, weight: number): void {
  const models = (spend.pending[String(slot)] ??= {});
  models[model] = (models[model] ?? 0) + weight;
}

// A reply written again under the same id counts once, with its newest usage.
function foldReply(spend: SpendState, record: Record<string, unknown>, at_ms: number): void {
  const message = record.message;
  if (!isRecord(message) || !isRecord(message.usage)) return;
  const model = readString(message.model);
  if (model === "" || model.startsWith("<")) return;
  const weight = replyWeight(message.usage);
  const id = readString(message.id);
  const seen = id === "" ? undefined : spend.recent.find((reply) => reply.id === id);
  if (seen !== undefined) {
    addPending(spend, seen.slot, seen.model, weight - seen.weight);
    seen.weight = weight;
    return;
  }
  const slot = slotOf(at_ms);
  addPending(spend, slot, model, weight);
  if (id === "") return;
  spend.recent.push({ id, slot, model, weight });
  if (spend.recent.length > RECENT_REPLIES) spend.recent.shift();
}

/** Each model's totals in a cost record, or the overall cost under UNKNOWN_MODEL when it has no breakdown. */
export function costRecordTotals(record: Record<string, unknown>): Record<string, SpendTotals> {
  const totals: Record<string, SpendTotals> = {};
  if (isRecord(record.modelUsage)) {
    Object.entries(record.modelUsage).forEach(([key, usage]) => {
      if (!isRecord(usage)) return;
      const into = (totals[modelName(key)] ??= zero());
      into.costUsd += count(usage.costUSD);
      into.input += count(usage.inputTokens);
      into.output += count(usage.outputTokens);
      into.cacheRead += count(usage.cacheReadInputTokens);
      into.cacheWrite += count(usage.cacheCreationInputTokens);
    });
  }
  const overall = finiteNumber(record.totalCostUSD);
  if (Object.keys(totals).length === 0 && overall !== null) totals[UNKNOWN_MODEL] = { ...zero(), costUsd: Math.max(overall, 0) };
  return totals;
}

// Within one count each total only grows, so a lower one changes nothing; a new `startTime` is a new
// count, starting from nothing, and the old one's highest is kept.
function foldCost(spend: SpendState, record: Record<string, unknown>): void {
  const now = costRecordTotals(record);
  if (Object.keys(now).length === 0) return;
  const startTime = finiteNumber(record.startTime);
  const sameRun = spend.run !== null && spend.run.startTime === startTime;
  if (!sameRun) spend.earlierRunsUsd = spentUsd(spend) ?? 0;
  const before = sameRun && spend.run !== null ? spend.run.models : {};
  const highest: Record<string, SpendTotals> = { ...before };
  const grown: Record<string, SpendTotals> = {};
  Object.entries(now).forEach(([model, totals]) => {
    const was = before[model] ?? zero();
    grown[model] = perField((field) => Math.max(totals[field] - was[field], 0));
    highest[model] = perField((field) => Math.max(totals[field], was[field]));
  });
  spend.run = { startTime, models: highest };
  Object.entries(grown).forEach(([model, totals]) => shareOut(spend, model, totals, startTime));
  spend.pending = {};
  spend.recent = [];
}

/** Where `model`'s share goes, as slot → weight: its own replies since the last cost record, else every
 *  reply then (a subagent's model has none in this file), else the last moment this file has a time for. */
function sharesFor(spend: SpendState, model: string, startTime: number | null): [number, number][] {
  const slots = Object.entries(spend.pending);
  const own = slots.map(([slot, models]): [number, number] => [Number(slot), models[model] ?? 0]).filter(([, weight]) => weight > 0);
  if (own.length > 0) return own;
  const any = slots
    .map(([slot, models]): [number, number] => [Number(slot), Object.values(models).reduce((sum, weight) => sum + weight, 0)])
    .filter(([, weight]) => weight > 0);
  if (any.length > 0) return any;
  const at_ms = spend.lastAt ?? startTime;
  return at_ms === null ? [] : [[slotOf(at_ms), 1]];
}

function shareOut(spend: SpendState, model: string, grown: SpendTotals, startTime: number | null): void {
  if (Object.values(grown).every((value) => value === 0)) return;
  const shares = sharesFor(spend, model, startTime);
  const whole = shares.reduce((sum, [, weight]) => sum + weight, 0);
  shares.forEach(([slot, weight]) => {
    const key = `${String(slot)}|${model}`;
    const row = (spend.unwritten[key] ??= { at_ms: slot, model, ...zero() });
    Object.assign(
      row,
      perField((field) => row[field] + (grown[field] * weight) / whole),
    );
  });
}

/** What was shared out since the last call, for the index to add; the state keeps none of it. */
export function takeSpent(spend: SpendState): SpendRow[] {
  const rows = Object.values(spend.unwritten);
  spend.unwritten = {};
  return rows;
}

const isTotals = (value: unknown): value is SpendTotals =>
  isRecord(value) && ["costUsd", "input", "output", "cacheRead", "cacheWrite"].every((field) => typeof value[field] === "number");
const isRecent = (value: unknown): value is RecentReply =>
  isRecord(value) && typeof value.id === "string" && typeof value.slot === "number" && typeof value.model === "string" && typeof value.weight === "number";
const isRun = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    (value.startTime === null || typeof value.startTime === "number") &&
    isRecord(value.models) &&
    Object.values(value.models).every(isTotals));
const isPending = (value: unknown): boolean =>
  isRecord(value) && Object.values(value).every((models) => isRecord(models) && Object.values(models).every((weight) => typeof weight === "number"));

/** A spend state read back from the index; anything off-shape means "fold the transcript again". */
export const isSpendState = (value: unknown): value is SpendState =>
  isRecord(value) &&
  isRun(value.run) &&
  typeof value.earlierRunsUsd === "number" &&
  isPending(value.pending) &&
  Array.isArray(value.recent) &&
  value.recent.every(isRecent) &&
  (value.lastAt === null || typeof value.lastAt === "number") &&
  isRecord(value.unwritten) &&
  Object.keys(value.unwritten).length === 0;
