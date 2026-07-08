// Dollar-cost estimation for Claude sessions: a hardcoded per-model rate table +
// per-turn cost from a transcript's `message.usage`, plus a project-scoped
// today/month roll-up served at GET /api/cost. Pricing is a public-list estimate
// (see MODEL_PRICING); unknown models are left unpriced rather than guessed.
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import type { Express } from "express";
import { isRecord, parseJsonl } from "./transcript.js";

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
  const turns = parseJsonl(raw)
    .map(assistantUsageTurn)
    .filter((t): t is UsageTurn => t !== null);
  return turns.reduce<JsonlCost>(
    (acc, turn) => {
      const { usd, priced } = costForUsage(turn.usage, turn.model);
      return priced ? { usd: acc.usd + usd, unpricedTurns: acc.unpricedTurns } : { usd: acc.usd, unpricedTurns: acc.unpricedTurns + 1 };
    },
    { usd: 0, unpricedTurns: 0 },
  );
}

// ── project-scoped aggregation (today / month) ─────────────────────────────────

// Cap on session files read per /api/cost call, so a project with a huge history
// stays bounded. Files within the month window are read newest-first up to this.
const MAX_COST_FILES = 200;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Claude stores each project's transcripts under ~/.claude/projects/<encoded-cwd>/
// (mirrors index.ts projectSessionsDir; kept here so this module has no server deps).
function projectSessionsDir(cwd: string): string {
  const encoded = path.resolve(cwd).replace(/[/.]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

const startOfToday_ms = (now: Date): number => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
const startOfMonth_ms = (now: Date): number => new Date(now.getFullYear(), now.getMonth(), 1).getTime();

interface FileStat {
  file: string;
  mtime_ms: number;
}

// Cheap stat-only pass: every *.jsonl's mtime, so files can be bucketed by day
// without reading them. Files that vanish between readdir and stat are skipped.
async function statJsonlFiles(dir: string): Promise<FileStat[]> {
  const names = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const stats = await Promise.all(
    names.map(async (file): Promise<FileStat | null> => {
      try {
        const st = await fs.stat(path.join(dir, file));
        return { file, mtime_ms: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  return stats.filter((s): s is FileStat => s !== null);
}

async function readFileCost(dir: string, file: string): Promise<JsonlCost> {
  try {
    return costFromJsonl(await fs.readFile(path.join(dir, file), "utf8"));
  } catch {
    return { usd: 0, unpricedTurns: 0 };
  }
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
  const perFile = await Promise.all(capped.map(async (s) => ({ mtime_ms: s.mtime_ms, cost: await readFileCost(dir, s.file) })));
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
export function mountCostRoute(app: Express, deps: { resolveCwd: (cwd: string | null) => string }): void {
  app.get("/api/cost", async (req, res) => {
    const cwd = deps.resolveCwd(typeof req.query.cwd === "string" ? req.query.cwd : null);
    const sessionParam = typeof req.query.session === "string" ? req.query.session : null;
    try {
      const rollup = await rollupProjectCost(cwd);
      const sessionCost = sessionParam && SESSION_ID_RE.test(sessionParam) ? await readFileCost(projectSessionsDir(cwd), `${sessionParam}.jsonl`) : null;
      res.json({
        session: sessionCost?.usd,
        sessionUnpricedTurns: sessionCost?.unpricedTurns ?? 0,
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
