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

/** One count of Claude Code's (one `startTime`): the highest overall cost it reached, and each model's
 *  highest totals. */
interface RunTotals {
  costUsd: number;
  models: Record<string, SpendTotals>;
}

export interface SpendState {
  /** Every count, by its `startTime` (`runKey`). A transcript holds as many as Claude Code started over. */
  runs: Record<string, RunTotals>;
  /** The replies since the last cost record: slot → model → weight. */
  pending: Record<string, Record<string, number>>;
  /** The last replies seen, kept across cost records so a reply's later records never count again. */
  recent: RecentReply[];
  /** When the last record with a time was written. */
  lastAt: number | null;
  /** Shared out before this file had any time, by model: placed at the first time it has. */
  unplaced: Record<string, SpendTotals>;
  /** Shared out since the last commit, by `slot|model`. */
  unwritten: Record<string, SpendRow>;
}

export const emptySpendState = (): SpendState => ({ runs: {}, pending: {}, recent: [], lastAt: null, unplaced: {}, unwritten: {} });

const runKey = (startTime: number | null): string => (startTime === null ? "" : String(startTime));

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
export function spentUsd(spend: SpendState): number | null {
  const runs = Object.values(spend.runs);
  return runs.length === 0 ? null : runs.reduce((sum, run) => sum + run.costUsd, 0);
}

export function foldSpendRecord(spend: SpendState, record: Record<string, unknown>, at_ms: number | null): void {
  if (at_ms !== null) {
    spend.lastAt = at_ms;
    placeUnplaced(spend, at_ms);
  }
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
    // Only the change counts: the weight it had may already have been shared out by a cost record.
    const models = (spend.pending[String(seen.slot)] ??= {});
    models[seen.model] = Math.max((models[seen.model] ?? 0) + weight - seen.weight, 0);
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

/** The count's overall cost as this record tells it: its own total when it gives no breakdown, else every
 *  model's highest — a model a record leaves out keeps what it reached. */
function overallCost(run: RunTotals, now: Record<string, SpendTotals>): number {
  const perModel = Object.keys(now).some((model) => model !== UNKNOWN_MODEL);
  if (!perModel) return now[UNKNOWN_MODEL]?.costUsd ?? 0;
  return Object.entries(run.models).reduce((sum, [model, totals]) => (model === UNKNOWN_MODEL ? sum : sum + totals.costUsd), 0);
}

// Within one count each total only grows, so a lower one changes nothing. The cost is followed as ONE
// overall total — a record may give it per model or only overall, and the two must not add up twice — and
// its growth goes to the models whose own cost grew, in proportion. Counts are kept by `startTime`, so a
// count Claude Code goes back to continues where it was.
function foldCost(spend: SpendState, record: Record<string, unknown>): void {
  const now = costRecordTotals(record);
  if (Object.keys(now).length === 0) return;
  const startTime = finiteNumber(record.startTime);
  const run = (spend.runs[runKey(startTime)] ??= { costUsd: 0, models: {} });
  const grown = Object.entries(now).map(([model, totals]): [string, SpendTotals] => {
    const was = run.models[model] ?? zero();
    run.models[model] = perField((field) => Math.max(totals[field], was[field]));
    return [model, perField((field) => Math.max(totals[field] - was[field], 0))];
  });
  const costGrowth = Math.max(overallCost(run, now) - run.costUsd, 0);
  run.costUsd += costGrowth;
  const modelGrowth = grown.reduce((sum, [, totals]) => sum + totals.costUsd, 0);
  grown.forEach(([model, totals]) => {
    const costUsd = modelGrowth === 0 ? 0 : (costGrowth * totals.costUsd) / modelGrowth;
    shareOut(spend, model, { ...totals, costUsd }, startTime);
  });
  spend.pending = {};
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

function addRow(spend: SpendState, slot: number, model: string, share: SpendTotals): void {
  const row = (spend.unwritten[`${String(slot)}|${model}`] ??= { at_ms: slot, model, ...zero() });
  Object.assign(
    row,
    perField((field) => row[field] + share[field]),
  );
}

function shareOut(spend: SpendState, model: string, grown: SpendTotals, startTime: number | null): void {
  if (Object.values(grown).every((value) => value === 0)) return;
  const shares = sharesFor(spend, model, startTime);
  if (shares.length === 0) {
    const held = spend.unplaced[model] ?? zero();
    spend.unplaced[model] = perField((field) => held[field] + grown[field]);
    return;
  }
  const whole = shares.reduce((sum, [, weight]) => sum + weight, 0);
  shares.forEach(([slot, weight]) =>
    addRow(
      spend,
      slot,
      model,
      perField((field) => (grown[field] * weight) / whole),
    ),
  );
}

function placeUnplaced(spend: SpendState, at_ms: number): void {
  Object.entries(spend.unplaced).forEach(([model, held]) => addRow(spend, slotOf(at_ms), model, held));
  spend.unplaced = {};
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
  isRecord(value) && typeof value.costUsd === "number" && isRecord(value.models) && Object.values(value.models).every(isTotals);
const isTotalsByModel = (value: unknown): boolean => isRecord(value) && Object.values(value).every(isTotals);
const isPending = (value: unknown): boolean =>
  isRecord(value) && Object.values(value).every((models) => isRecord(models) && Object.values(models).every((weight) => typeof weight === "number"));

/** A spend state read back from the index; anything off-shape means "fold the transcript again". */
export const isSpendState = (value: unknown): value is SpendState =>
  isRecord(value) &&
  isRecord(value.runs) &&
  Object.values(value.runs).every(isRun) &&
  isTotalsByModel(value.unplaced) &&
  isPending(value.pending) &&
  Array.isArray(value.recent) &&
  value.recent.every(isRecent) &&
  (value.lastAt === null || typeof value.lastAt === "number") &&
  isRecord(value.unwritten) &&
  Object.keys(value.unwritten).length === 0;
