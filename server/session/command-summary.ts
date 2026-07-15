// AI summary / Explain for a Run-menu command cell (issue #246). The browser sends
// the cell's captured terminal output; we run `claude -p` headless (non-interactive)
// and return a short Errors / Warnings / cause / fix summary. Extracted from index.ts
// so the pure logic (truncate / prompt / parse) and the spawn helper are unit-testable
// without an HTTP server or the `claude` CLI.
import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import { claudeAdapter } from "../agents/claude.js";

const BYTES_PER_KB = 1024;
// Cap the log we send to claude. The tail is what matters (errors + the exit line
// live there), and this bounds both the request body and the summary's token cost.
export const MAX_LOG_KB = 32;
const SUMMARY_TIMEOUT_MS = 60_000;
const EMPTY_OUTPUT_SUMMARY = "No command output to summarize yet.";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface TruncatedLog {
  text: string;
  truncated: boolean;
}

// Keep the LAST maxKb of the log. When it overflows, drop the leading partial line so
// a half-line (or a codepoint split by the byte cut) doesn't head the excerpt.
const NEWLINE_BYTE = 0x0a;
export function truncateLog(log: string, maxKb: number = MAX_LOG_KB): TruncatedLog {
  const maxBytes = maxKb * BYTES_PER_KB;
  const buf = Buffer.from(log, "utf8");
  if (buf.length <= maxBytes) return { text: log, truncated: false };
  const cut = buf.length - maxBytes;
  const tail = buf.subarray(cut).toString("utf8");
  // Only drop the leading line when the cut landed MID-line (the byte before the tail
  // isn't a newline) — that partial line, and any codepoint split by the byte cut,
  // is noise. At an exact line boundary the tail already starts with a whole line, so
  // dropping it would discard a valid line (possibly the key error).
  const startsMidLine = buf[cut - 1] !== NEWLINE_BYTE;
  const firstNewline = tail.indexOf("\n");
  return { text: startsMidLine && firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail, truncated: true };
}

export const DEFAULT_LOCALE = "en";

// Reduce a client-supplied locale to a safe base language code (e.g. "ja-JP" -> "ja").
// The value is interpolated into the claude prompt, so anything unexpected falls back
// to the default rather than injecting a free-form string.
export function normalizeLocale(v: unknown): string {
  const base = typeof v === "string" ? v.split("-")[0].toLowerCase() : "";
  return /^[a-z]{2,8}$/.test(base) ? base : DEFAULT_LOCALE;
}

// The headless instruction passed as `claude -p <prompt>`; the log rides on stdin.
// The reply (including its section labels) is written in the caller's language.
export function buildSummaryPrompt(locale: string = DEFAULT_LOCALE): string {
  return [
    "You are given the captured terminal output of a single shell command on stdin.",
    `Write your ENTIRE reply — including the section labels — in the language of IETF locale code "${locale}" (e.g. "ja" = Japanese, "en" = English).`,
    "Reply CONCISELY in plain text (no markdown), under ~120 words, using short labelled",
    "lines for each of the following and OMITTING any that do not apply:",
    "- the concrete error(s)",
    "- notable warnings",
    "- the most probable root cause",
    "- the smallest actionable next step (the fix)",
    "Do not echo the log back.",
  ].join("\n");
}

// `claude -p` prints the answer to stdout; trim the surrounding whitespace.
export function parseSummaryOutput(stdout: string): string {
  return stdout.trim();
}

export interface ClaudeRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type RunClaude = (params: { bin: string; prompt: string; input: string; timeoutMs: number; model?: string }) => Promise<ClaudeRunResult>;

// Default spawn: run `claude -p <prompt>`, feed the log on stdin, collect stdout.
// Argv (no shell), so nothing in the log or prompt is re-interpreted by a shell. A
// timeout kills a hung CLI so the request can't wait forever. Injected into
// summarizeLog so tests mock it — no `claude` binary needed. `model` (when given) picks
// a cheaper/faster model via `--model` — used by the header-title generator.
export const runClaudeHeadless: RunClaude = ({ bin, prompt, input, timeoutMs, model }) =>
  new Promise((resolve, reject) => {
    const args = model ? ["-p", prompt, "--model", model] : ["-p", prompt];
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude summary timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`failed to spawn claude: ${messageOf(e)}`));
    });
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), code });
    });
    child.stdin.end(input);
  });

export interface SummaryResult {
  summary: string;
  truncated: boolean;
}

export interface SummarizeDeps {
  runClaude?: RunClaude;
  claudeBin?: string;
  maxLogKb?: number;
  locale?: string;
}

// Truncate the log, then (unless it's empty) run claude headless for a summary.
export async function summarizeLog(log: string, deps: SummarizeDeps = {}): Promise<SummaryResult> {
  const runClaude = deps.runClaude ?? runClaudeHeadless;
  const bin = deps.claudeBin ?? claudeAdapter.bin();
  const { text, truncated } = truncateLog(log, deps.maxLogKb ?? MAX_LOG_KB);
  if (!text.trim()) return { summary: EMPTY_OUTPUT_SUMMARY, truncated };
  const { stdout, stderr, code } = await runClaude({
    bin,
    prompt: buildSummaryPrompt(deps.locale ?? DEFAULT_LOCALE),
    input: text,
    timeoutMs: SUMMARY_TIMEOUT_MS,
  });
  const summary = parseSummaryOutput(stdout);
  if (!summary) throw new Error(stderr.trim() || `claude produced no summary (exit ${code})`);
  return { summary, truncated };
}

interface CommandSummaryDeps {
  isAllowedOrigin: (origin?: string) => boolean;
}

// POST /api/command/summarize { log } -> { summary, truncated }. Same-origin guarded
// like the other local-action routes so a random site the user visits can't drive the
// local `claude` binary. Mirrors mountPickFileRoute's shape.
export function mountCommandSummaryRoute(app: Express, { isAllowedOrigin }: CommandSummaryDeps): void {
  app.post("/api/command/summarize", async (req: Request, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    const body = isRecord(req.body) ? req.body : {};
    if (typeof body.log !== "string") return res.status(400).json({ error: "body.log (string) required" });
    try {
      res.json(await summarizeLog(body.log, { locale: normalizeLocale(body.locale) }));
    } catch (e) {
      res.status(502).json({ error: `summary failed: ${messageOf(e)}` });
    }
  });
}
