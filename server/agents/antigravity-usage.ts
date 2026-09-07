// The token and context numbers for an Antigravity session, out of agy's own accounting.
//
// They are NOT in the transcript — `transcript.jsonl` has no token field of any kind, which is why
// #1465 shipped the model alone. They are in a second store the transcript never mentions:
// `~/.gemini/antigravity-cli/conversations/<conversationId>.db`, a SQLite database whose
// `gen_metadata` table holds one protobuf blob per generation. Measured on a real conversation:
//
//   idx=  0  ctx 2,522/256,000    prompt 22,812  out   178  cached       0  thoughts  80
//   idx=240  ctx 234,987/256,000  prompt  4,901  out   180  cached 227,183  thoughts  94
//   idx=300  ctx 146,536/256,000  prompt  3,660  out    84  cached 137,957  thoughts  68   <- compacted
//   idx=518  ctx 199,141/256,000  prompt  2,485  out   255  cached 194,633  thoughts 221
//
// The context reading climbs, drops when the conversation compacts, and the per-generation counts
// sum to within a few percent of it. That is what identifies the fields; there is no schema on
// disk and no name anywhere — see antigravity-proto.ts.
//
// **So the whole of this file is written to answer "nothing" rather than a wrong number.** A badge
// is read before deciding to compact, and a number invented from a renumbered field would be acted
// on. Every layer can decline: the walker returns undefined for anything unexpected, the gates
// below reject a reading that is not internally consistent, and one missing leaf drops the whole
// answer rather than contributing a zero. If agy moves these fields the badges go quiet, which is
// where they were before this existed.
import path from "node:path";
import { protoVarintsAt } from "./antigravity-proto.js";
import type { SessionContextInfo } from "../../common/sessionContext.js";
import type { SessionUsage } from "../session/transcript.js";

export interface AntigravityBadges {
  usage: SessionUsage;
  context: Omit<SessionContextInfo, "model">;
}

// `1.9.10` — the context reading. `.1` is how much of the window this generation used, `.4` is the
// window itself.
const CONTEXT_PREFIX = [1, 9, 10] as const;
const CONTEXT_USED = 1;
const CONTEXT_WINDOW = 4;

// `1.4` — the generation's token counts.
const USAGE_PREFIX = [1, 4] as const;
const PROMPT_TOKENS = 2; // input that was not served from cache
const OUTPUT_TOKENS = 3;
const CACHED_TOKENS = 5; // input served from cache; absent on the first generation, which has none
const TOOL_PROMPT_TOKENS = 9;
const THINKING_TOKENS = 10;

// What a reading has to look like to be one. These are deliberately loose — they are here to catch
// a field that now means something else entirely (a timestamp, an enum, a byte offset), not to
// second-guess agy about its own limits.
const MIN_WINDOW = 1024;
const MAX_WINDOW = 100_000_000;
const MAX_TOKENS = 1_000_000_000;

/** The most recent rows are scanned newest-first for the context reading, because the last row of
 *  the table is not always a generation — a conversation can end with a configuration record. Past
 *  this many the answer is "no reading", not a deeper search. */
const CONTEXT_SCAN_ROWS = 32;
/** Summing the whole table is what makes the usage badge cumulative. A conversation this long is
 *  beyond anything measured (the largest here has 519 rows), so it is a runaway guard: the usage
 *  badge is dropped rather than reported from a partial sum.
 *
 *  One MORE than this is read, so that a table of exactly this many rows is recognised as complete
 *  rather than assumed to be the top of a longer one. */
const MAX_USAGE_ROWS = 50_000;

export function antigravityDbPath(conversationsRoot: string, conversationId: string): string {
  return path.join(conversationsRoot, `${conversationId}.db`);
}

interface GenRow {
  data: Buffer;
}

/**
 * Rows of `gen_metadata`, newest first, or null if the database cannot be read as one.
 *
 * `node:sqlite` is imported here rather than at module scope for two reasons: it is flagged
 * experimental, so importing it prints a warning on a server that may never start an agy session,
 * and a Node built without it would otherwise take the whole module down at import time instead of
 * costing one quiet badge.
 */
async function readGenRows(file: string, limit: number): Promise<GenRow[] | null> {
  let db: InstanceType<typeof import("node:sqlite").DatabaseSync> | null = null;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    // Read-only, and through a URI so a database agy has open is opened as a reader rather than as
    // something that could take a write lock on the file the agent is working from.
    // A PLAIN path, not a `file:…?mode=ro` URI. node:sqlite does not enable SQLite's URI filenames
    // on every Node this package supports (`>=22.12`), and where it does not, the URI is taken as a
    // literal filename — the open fails, and every agy badge silently goes quiet on that runtime.
    // `readOnly` is the option that makes this a reader, and it is honoured everywhere.
    db = new DatabaseSync(file, { readOnly: true });
    // A NAMED parameter: `limit ?` binds fine in every other sqlite binding and throws
    // "column index out of range" in node:sqlite, which the specs caught and this comment exists
    // so nobody "simplifies" back to.
    const rows = db.prepare("select data from gen_metadata order by idx desc limit $limit").all({ limit });
    return rows.map(genRowOf).filter((row): row is GenRow => row !== null);
  } catch {
    return null; // no database yet, a shape we do not know, or no sqlite in this runtime
  } finally {
    try {
      db?.close();
    } catch {
      // Closing a handle that never opened is not a failure worth reporting.
    }
  }
}

/** One row's blob. node:sqlite hands a BLOB back as a Uint8Array, not a Buffer — wrapped rather
 *  than copied, since these run to hundreds of kilobytes each. */
function genRowOf(row: Record<string, unknown> | null): GenRow | null {
  const data = row?.data;
  if (Buffer.isBuffer(data)) return { data };
  if (data instanceof Uint8Array) return { data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
  return null;
}

const inRange = (value: number | undefined, max: number): value is number => value !== undefined && Number.isInteger(value) && value >= 0 && value <= max;

/** The context reading from the newest generation row that carries one. */
function contextOf(rows: readonly GenRow[]): { contextTokens: number; contextWindow: number } | null {
  for (const row of rows) {
    const [used, window] = protoVarintsAt(row.data, CONTEXT_PREFIX, [CONTEXT_USED, CONTEXT_WINDOW]);
    if (!inRange(window, MAX_WINDOW) || window < MIN_WINDOW) continue;
    if (!inRange(used, MAX_TOKENS)) continue;
    // Over the window is not a reading: it means these two fields are no longer the pair we think
    // they are. The UI makes the same call for the same reason (#985) — see readContext.
    if (used > window) return null;
    return { contextTokens: used, contextWindow: window };
  }
  return null;
}

/** Cumulative usage across every generation, or null if any row that carries counts is not the
 *  shape we know — a partial sum is a wrong number, not a smaller one. */
function usageOf(rows: readonly GenRow[]): SessionUsage | null {
  const total: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  let counted = 0;
  for (const row of rows) {
    const [prompt, output, cached, toolPrompt, thinking] = protoVarintsAt(row.data, USAGE_PREFIX, [
      PROMPT_TOKENS,
      OUTPUT_TOKENS,
      CACHED_TOKENS,
      TOOL_PROMPT_TOKENS,
      THINKING_TOKENS,
    ]);
    // A row with no prompt count is not a generation (a configuration record sits in this table
    // too), so it is skipped rather than counted as a turn that cost nothing.
    if (prompt === undefined) continue;
    // Everything else is optional and genuinely absent on some rows — the first generation has no
    // cache read, a turn with no tool call has no tool prompt — but a value that IS there and is
    // out of range means the shape moved.
    const parts = [prompt, output, cached, toolPrompt, thinking];
    if (parts.some((part) => part !== undefined && !inRange(part, MAX_TOKENS))) return null;
    total.inputTokens += prompt + (toolPrompt ?? 0);
    total.outputTokens += (output ?? 0) + (thinking ?? 0);
    total.cacheReadTokens += cached ?? 0;
    counted++;
  }
  return counted > 0 ? total : null;
}

/**
 * The token and context badges for an agy conversation, or null when they cannot be read.
 *
 * Null is a normal answer, not an error: a conversation agy has not written a generation for yet,
 * a runtime without `node:sqlite`, a database whose fields no longer mean what they meant. The
 * caller shows the model alone, exactly as it did before this file existed.
 */
export async function antigravityBadgesFromDb(conversationsRoot: string, conversationId: string): Promise<AntigravityBadges | null> {
  const file = antigravityDbPath(conversationsRoot, conversationId);
  const rows = await readGenRows(file, MAX_USAGE_ROWS + 1);
  if (!rows?.length) return null;
  // A row beyond the cap means older generations are missing and any total would be short. The
  // context reading is still exact — it comes from the newest row — so only the usage is dropped.
  const complete = rows.length <= MAX_USAGE_ROWS;
  const context = contextOf(rows.slice(0, CONTEXT_SCAN_ROWS));
  const usage = complete ? usageOf(rows) : null;
  if (!context && !usage) return null;
  return {
    usage: usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    context: context ?? { contextTokens: 0, contextWindow: null },
  };
}
