// What a conversation spent and on which model, and how much each of its replies weighed (#3395), folded
// from its transcript.
//
// Claude Code records cost only as `cost-state`: running totals per model, with no time, written now and
// then — days apart in a long conversation. So the fold keeps two things apart and spend-split.ts joins
// them when read: each reply's weight (its tokens at their relative prices) in the 15-minute slot it was
// written in, one index row per reply id, and the conversation's totals per model with every count added
// up. For one model, cost per unit of weight is its price, so splitting the model's whole cost by weight
// places it as well as splitting each step between two cost records would — and nothing here has to be
// carried between cost records, cleared, or remembered past one record.
//
// Pure: no fs, no clock. Bounded: the replies are handed to the index at each commit (`takeReplies`), and
// what stays is one entry per count and model.
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { finiteNumber } from "../../../common/finiteNumber.js";

export const SPEND_SLOT_MS = 15 * 60 * 1000;
/** A token's price relative to an input token, the same for every Claude model. Only the ratios matter:
 *  they decide how a known cost is split, never what it is. */
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

/** One reply: its id (the index keeps one row per id, so a later record of it replaces the earlier), the
 *  slot it was written in, its model and its weight. */
export interface ReplyWeight {
  id: string;
  at_ms: number;
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
  /** Replies read since the last commit, by id. */
  unwritten: Record<string, ReplyWeight>;
}

export const emptySpendState = (): SpendState => ({ runs: {}, unwritten: {} });

type SpendField = keyof SpendTotals;
const perField = (value: (field: SpendField) => number): SpendTotals => ({
  costUsd: value("costUsd"),
  input: value("input"),
  output: value("output"),
  cacheRead: value("cacheRead"),
  cacheWrite: value("cacheWrite"),
});
export const zeroSpend = (): SpendTotals => perField(() => 0);
const runKey = (startTime: number | null): string => (startTime === null ? "" : String(startTime));
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
  if (record.type === "assistant" && at_ms !== null) foldReply(spend, record, at_ms);
  if (record.type === "cost-state") foldCost(spend, record);
}

function replyWeight(usage: Record<string, unknown>): number {
  const tokens = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens, usage.output_tokens].map(count);
  const [input = 0, cacheWrite = 0, cacheRead = 0, output = 0] = tokens;
  return input * TOKEN_PRICE.input + cacheWrite * TOKEN_PRICE.cacheWrite + cacheRead * TOKEN_PRICE.cacheRead + output * TOKEN_PRICE.output;
}

// One reply is written as several records under one message id; the newest record's usage stands.
function foldReply(spend: SpendState, record: Record<string, unknown>, at_ms: number): void {
  const message = record.message;
  if (!isRecord(message) || !isRecord(message.usage)) return;
  const model = modelName(readString(message.model));
  if (model === "" || model.startsWith("<")) return;
  const id = readString(message.id) || readString(record.uuid);
  if (id === "") return;
  spend.unwritten[id] = { id, at_ms: slotOf(at_ms), model, weight: replyWeight(message.usage) };
}

/** Each model's totals in a cost record, or the overall cost under UNKNOWN_MODEL when it has no breakdown. */
export function costRecordTotals(record: Record<string, unknown>): Record<string, SpendTotals> {
  const totals: Record<string, SpendTotals> = {};
  if (isRecord(record.modelUsage)) {
    Object.entries(record.modelUsage).forEach(([key, usage]) => {
      if (!isRecord(usage)) return;
      const into = (totals[modelName(key)] ??= zeroSpend());
      into.costUsd += count(usage.costUSD);
      into.input += count(usage.inputTokens);
      into.output += count(usage.outputTokens);
      into.cacheRead += count(usage.cacheReadInputTokens);
      into.cacheWrite += count(usage.cacheCreationInputTokens);
    });
  }
  const overall = finiteNumber(record.totalCostUSD);
  if (Object.keys(totals).length === 0 && overall !== null) totals[UNKNOWN_MODEL] = { ...zeroSpend(), costUsd: Math.max(overall, 0) };
  return totals;
}

const modelCost = (models: Record<string, SpendTotals>): number =>
  Object.entries(models).reduce((sum, [model, totals]) => (model === UNKNOWN_MODEL ? sum : sum + totals.costUsd), 0);

/** The count's overall cost as this record tells it: every model's highest — a model a record leaves out
 *  keeps what it reached — or its own total where that is more (no breakdown, or one short of the total). */
function overallCost(run: RunTotals, now: Record<string, SpendTotals>, recordTotal: number | null): number {
  const perModel = Object.keys(now).some((model) => model !== UNKNOWN_MODEL);
  return Math.max(perModel ? modelCost(run.models) : 0, recordTotal ?? 0);
}

// Within one count each total only grows, so a lower one changes nothing. The cost is followed as ONE
// overall total — a record may give it per model or only overall, and the two must not add up twice.
// Counts are kept by `startTime`, so a count Claude Code goes back to continues where it was.
function foldCost(spend: SpendState, record: Record<string, unknown>): void {
  const now = costRecordTotals(record);
  if (Object.keys(now).length === 0) return;
  const run = (spend.runs[runKey(finiteNumber(record.startTime))] ??= { costUsd: 0, models: {} });
  Object.entries(now).forEach(([model, totals]) => {
    const was = run.models[model] ?? zeroSpend();
    run.models[model] = perField((field) => Math.max(totals[field], was[field]));
  });
  run.costUsd = Math.max(run.costUsd, overallCost(run, now, finiteNumber(record.totalCostUSD)));
}

/** The conversation's totals per model, every count added up: each count's models, and what its overall
 *  cost came to beyond them under UNKNOWN_MODEL. Adds up to `spentUsd`. */
export function spendTotals(spend: SpendState): Record<string, SpendTotals> {
  const totals: Record<string, SpendTotals> = {};
  const add = (model: string, share: SpendTotals): void => {
    const held = totals[model] ?? zeroSpend();
    totals[model] = perField((field) => held[field] + share[field]);
  };
  Object.values(spend.runs).forEach((run) => {
    Object.entries(run.models).forEach(([model, share]) => {
      if (model !== UNKNOWN_MODEL) add(model, share);
    });
    const beyond = run.costUsd - modelCost(run.models);
    if (beyond > 0) add(UNKNOWN_MODEL, { ...zeroSpend(), costUsd: beyond });
  });
  return totals;
}

/** The replies read since the last call, for the index to keep; the state keeps none of them. */
export function takeReplies(spend: SpendState): ReplyWeight[] {
  const replies = Object.values(spend.unwritten);
  spend.unwritten = {};
  return replies;
}

const isTotals = (value: unknown): value is SpendTotals =>
  isRecord(value) && ["costUsd", "input", "output", "cacheRead", "cacheWrite"].every((field) => typeof value[field] === "number");
const isRun = (value: unknown): boolean =>
  isRecord(value) && typeof value.costUsd === "number" && isRecord(value.models) && Object.values(value.models).every(isTotals);

/** A spend state read back from the index; anything off-shape means "fold the transcript again". */
export const isSpendState = (value: unknown): value is SpendState =>
  isRecord(value) && isRecord(value.runs) && Object.values(value.runs).every(isRun) && isRecord(value.unwritten) && Object.keys(value.unwritten).length === 0;

/** A conversation's per-model totals read back from its index row; anything off-shape reads as none. */
export function parseSpendTotals(raw: unknown): Record<string, SpendTotals> {
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    const totals: Record<string, SpendTotals> = {};
    if (isRecord(parsed)) {
      Object.entries(parsed).forEach(([model, value]) => {
        if (isTotals(value)) totals[model] = value;
      });
    }
    return totals;
  } catch {
    return {};
  }
}
