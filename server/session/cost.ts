// Dollar-cost estimation for Claude sessions: a hardcoded per-model rate table +
// per-turn cost from a transcript's `message.usage`, plus a project-scoped
// today/month roll-up served at GET /api/cost. Pricing is a public-list estimate
// (see MODEL_PRICING); unknown models are left unpriced rather than guessed.
import path from "node:path";
import fs from "node:fs/promises";
import type { Express, Response } from "express";
import { parseJsonl } from "./transcript.js";
import { createTranscriptFold } from "./transcript-fold.js";
import { transcriptFile } from "./transcript-locate.js";
import type { FileStamp } from "./file-cache.js";
import { isRecord } from "../../common/isRecord.js";
import { projectSessionsDir } from "./project-dir.js";

const TOKENS_PER_MILLION = 1_000_000;
// Cache reads bill at ~0.1x the base input rate; cache writes at 1.25x for the
// default 5-minute ephemeral cache (the TTL Claude Code uses). Both are derived
// from each model's input rate rather than listed separately.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

// $ per 1M tokens (input / output) for current Claude models, from Anthropic's
// public pricing. Matched by model-id PREFIX so dated snapshots (…-20260101)
// resolve to their family. A model with no entry is treated as unpriced.
interface ModelPricing {
  prefix: string;
  inputPerMillion_usd: number;
  outputPerMillion_usd: number;
}

const MODEL_PRICING: ModelPricing[] = [
  { prefix: "claude-fable-5", inputPerMillion_usd: 10, outputPerMillion_usd: 50 },
  { prefix: "claude-opus-4-8", inputPerMillion_usd: 5, outputPerMillion_usd: 25 },
  { prefix: "claude-opus-4-7", inputPerMillion_usd: 5, outputPerMillion_usd: 25 },
  { prefix: "claude-opus-4-6", inputPerMillion_usd: 5, outputPerMillion_usd: 25 },
  { prefix: "claude-opus-4-5", inputPerMillion_usd: 5, outputPerMillion_usd: 25 },
  { prefix: "claude-sonnet-5", inputPerMillion_usd: 3, outputPerMillion_usd: 15 },
  { prefix: "claude-sonnet-4-6", inputPerMillion_usd: 3, outputPerMillion_usd: 15 },
  { prefix: "claude-sonnet-4-5", inputPerMillion_usd: 3, outputPerMillion_usd: 15 },
  { prefix: "claude-haiku-4-5", inputPerMillion_usd: 1, outputPerMillion_usd: 5 },
];

export interface ModelRate {
  inputPerMillion_usd: number;
  outputPerMillion_usd: number;
  cacheReadPerMillion_usd: number;
  cacheWritePerMillion_usd: number;
}

// The rate for a model id, or null when it isn't in the table (→ unpriced).
export function rateForModel(model: string): ModelRate | null {
  const pricing = MODEL_PRICING.find((p) => model.startsWith(p.prefix));
  if (!pricing) return null;
  return {
    inputPerMillion_usd: pricing.inputPerMillion_usd,
    outputPerMillion_usd: pricing.outputPerMillion_usd,
    cacheReadPerMillion_usd: pricing.inputPerMillion_usd * CACHE_READ_MULTIPLIER,
    cacheWritePerMillion_usd: pricing.inputPerMillion_usd * CACHE_WRITE_MULTIPLIER,
  };
}

// A non-negative token count for a usage key (missing / negative / NaN → 0).
const tokenCount = (usage: Record<string, unknown>, key: string): number => {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
};

// The dollar cost of a single assistant turn, using that turn's own model's rates.
// `priced` is false (and usd 0) when the model has no known price.
export function costForUsage(usage: Record<string, unknown>, model: string): { usd: number; priced: boolean } {
  const rate = rateForModel(model);
  if (!rate) return { usd: 0, priced: false };
  const usd =
    (tokenCount(usage, "input_tokens") * rate.inputPerMillion_usd +
      tokenCount(usage, "output_tokens") * rate.outputPerMillion_usd +
      tokenCount(usage, "cache_read_input_tokens") * rate.cacheReadPerMillion_usd +
      tokenCount(usage, "cache_creation_input_tokens") * rate.cacheWritePerMillion_usd) /
    TOKENS_PER_MILLION;
  return { usd, priced: true };
}

export interface JsonlCost {
  usd: number;
  unpricedTurns: number;
}

interface UsageTurn {
  usage: Record<string, unknown>;
  model: string;
}

// One assistant turn's usage + model, or null for any other line. A session can
// switch models, so each turn keeps its own model for per-turn pricing.
function assistantUsageTurn(o: Record<string, unknown>): UsageTurn | null {
  if (o.type !== "assistant" || !isRecord(o.message) || !isRecord(o.message.usage)) return null;
  const model = typeof o.message.model === "string" ? o.message.model : "";
  return { usage: o.message.usage, model };
}

// Total dollar cost of a transcript, summed per assistant turn. Turns whose model
// has no known price are excluded from usd and counted in `unpricedTurns`.
export function costFromJsonl(raw: string): JsonlCost {
  const scan = createCostScan();
  parseJsonl(raw).forEach((record) => scan.add(record));
  return scan.total();
}

// One record's contribution, folded into a running total. The rule lives here rather than inside
// the scan below because a RESUMED read folds into a total it did not start (#1386): both paths
// have to add a turn the same way or a resumed cost drifts from a fresh one.
function foldCost(into: JsonlCost, record: Record<string, unknown>): void {
  const turn = assistantUsageTurn(record);
  if (!turn) return;
  const priced = costForUsage(turn.usage, turn.model);
  if (priced.priced) into.usd += priced.usd;
  else into.unpricedTurns += 1;
}

// A template to copy, never a target to fold into — foldCost MUTATES what it is given.
const EMPTY_COST: JsonlCost = { usd: 0, unpricedTurns: 0 };

/** The same accumulation, fed one record at a time — for a caller streaming a transcript too
 *  large to hold as a string (#998). The pricing rule stays in costForUsage either way. */
export function createCostScan() {
  const total: JsonlCost = { ...EMPTY_COST };
  return {
    add(record: Record<string, unknown>) {
      foldCost(total, record);
    },
    total: (): JsonlCost => ({ ...total }),
  };
}

// A transcript's cost, folded once: an unchanged file is not read again, a grown one costs only the
// bytes that arrived, and a big one keeps its total beside it. /api/cost reads up to 200 files per
// request and had no cache at all — 2.5-3.1 s every time the cost panel was opened on a 1.1 GB
// project (#1386).
const isJsonlCost = (value: unknown): value is JsonlCost => isRecord(value) && typeof value.usd === "number" && typeof value.unpricedTurns === "number";

const costFold = createTranscriptFold<JsonlCost>({
  kind: "cost",
  version: 1,
  isValue: isJsonlCost,
  empty: () => ({ ...EMPTY_COST }),
  fold: foldCost,
  copy: (cost) => ({ ...cost }),
});

// ── project-scoped aggregation (today / month) ─────────────────────────────────

// Cap on session files read per /api/cost call, so a project with a huge history
// stays bounded. Files within the month window are read newest-first up to this.
const MAX_COST_FILES = 200;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const startOfToday_ms = (now: Date): number => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
const startOfMonth_ms = (now: Date): number => new Date(now.getFullYear(), now.getMonth(), 1).getTime();

interface FileStat {
  file: string;
  mtime_ms: number;
  /** Carried alongside the mtime because the fold needs the same stat, not a second one. */
  size: number;
}

// Cheap stat-only pass: every *.jsonl's mtime, so files can be bucketed by day
// without reading them. Files that vanish between readdir and stat are skipped.
async function statJsonlFiles(dir: string): Promise<FileStat[]> {
  const names = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const stats = await Promise.all(
    names.map(async (file): Promise<FileStat | null> => {
      try {
        const st = await fs.stat(path.join(dir, file));
        return { file, mtime_ms: st.mtimeMs, size: st.size };
      } catch {
        return null;
      }
    }),
  );
  return stats.filter((s): s is FileStat => s !== null);
}

async function readFileCost(dir: string, file: string, stamp?: FileStamp): Promise<JsonlCost> {
  const full = path.join(dir, file);
  try {
    // The roll-up has already stat'ed every file to bucket it by day, so it hands its stamp down
    // rather than making this stat 200 files a second time.
    return await costFold.read(full, stamp ?? (await fileStamp(full)));
  } catch {
    return { ...EMPTY_COST };
  }
}

/** One session's cost. Exported so the route does not build the transcript path itself — and so the
 *  fold underneath it can be tested without an HTTP request. */
export async function sessionCost(cwd: string, id: string): Promise<JsonlCost> {
  const full = transcriptFile(id, cwd);
  return readFileCost(path.dirname(full), path.basename(full));
}

async function fileStamp(full: string): Promise<FileStamp> {
  const st = await fs.stat(full);
  return { mtimeMs: st.mtimeMs, size: st.size };
}

export interface CostRollup {
  today: number;
  month: number;
  unpricedTurns: number;
}

const EMPTY_ROLLUP: CostRollup = { today: 0, month: 0, unpricedTurns: 0 };

// Sum this-month and today costs across the project's sessions, bucketed by file
// mtime. Never throws: a missing dir or unreadable file yields zeros.
async function rollupProjectCost(cwd: string): Promise<CostRollup> {
  const dir = projectSessionsDir(cwd);
  const now = new Date();
  const monthStart_ms = startOfMonth_ms(now);
  const todayStart_ms = startOfToday_ms(now);
  const all: FileStat[] = await statJsonlFiles(dir).catch(() => []);
  const inMonth = all.filter((s) => s.mtime_ms >= monthStart_ms).sort((a, b) => b.mtime_ms - a.mtime_ms);
  const capped = inMonth.slice(0, MAX_COST_FILES);
  if (inMonth.length > capped.length) {
    console.log(`[api] /api/cost: capped at ${MAX_COST_FILES} of ${inMonth.length} session files for ${dir}`);
  }
  const perFile = await Promise.all(
    capped.map(async (s) => ({ mtime_ms: s.mtime_ms, cost: await readFileCost(dir, s.file, { mtimeMs: s.mtime_ms, size: s.size }) })),
  );
  return perFile.reduce<CostRollup>(
    (acc, f) => ({
      today: acc.today + (f.mtime_ms >= todayStart_ms ? f.cost.usd : 0),
      month: acc.month + f.cost.usd,
      unpricedTurns: acc.unpricedTurns + f.cost.unpricedTurns,
    }),
    EMPTY_ROLLUP,
  );
}

// GET /api/cost?cwd=&session= → { session?, sessionUnpricedTurns, today, month,
// currency, unpricedTurns }. today/month roll up the project's sessions; session
// (optional) is one transcript. The session's OWN unpriced-turn count is reported
// separately, since that session may fall outside the month window / file cap and so
// isn't reflected in `unpricedTurns` (which covers the roll-up only).
// `resolveCwd` answers null once it has refused the request itself (an unusable `?cwd=`), so the
// roll-up is never computed for a directory other than the one asked about.
export function mountCostRoute(app: Express, deps: { resolveCwd: (cwd: unknown, res: Response) => string | null }): void {
  app.get("/api/cost", async (req, res) => {
    const cwd = deps.resolveCwd(req.query.cwd, res);
    if (cwd === null) return;
    const sessionParam = typeof req.query.session === "string" ? req.query.session : null;
    try {
      const rollup = await rollupProjectCost(cwd);
      const thisSession = sessionParam && SESSION_ID_RE.test(sessionParam) ? await sessionCost(cwd, sessionParam) : null;
      res.json({
        session: thisSession?.usd,
        sessionUnpricedTurns: thisSession?.unpricedTurns ?? 0,
        today: rollup.today,
        month: rollup.month,
        currency: "USD",
        unpricedTurns: rollup.unpricedTurns,
      });
    } catch (err) {
      console.error("[api] /api/cost failed:", err);
      res.json({ today: 0, month: 0, currency: "USD", unpricedTurns: 0, sessionUnpricedTurns: 0 });
    }
  });
}
