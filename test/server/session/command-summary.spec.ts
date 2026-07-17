import { describe, it, expect, vi } from "vitest";
import {
  truncateLog,
  buildSummaryPrompt,
  normalizeLocale,
  parseSummaryOutput,
  summarizeLog,
  MAX_LOG_KB,
  type RunClaude,
} from "../../../server/session/command-summary.js";

const KB = 1024;
const ok = (stdout: string): RunClaude => vi.fn(async () => ({ stdout, stderr: "", code: 0 }));

describe("truncateLog", () => {
  it("returns short logs unchanged and not truncated", () => {
    expect(truncateLog("hello\nworld")).toEqual({ text: "hello\nworld", truncated: false });
  });

  it("keeps a log exactly at the cap unchanged (boundary)", () => {
    const exact = "a".repeat(2 * KB);
    expect(truncateLog(exact, 2)).toEqual({ text: exact, truncated: false });
  });

  it("keeps the TAIL and drops the leading partial line when over the cap", () => {
    const log = "OLD-HEAD-LINE\n" + "x".repeat(2 * KB) + "\nTAIL-ERROR";
    const { text, truncated } = truncateLog(log, 2);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(2 * KB);
    expect(text).toContain("TAIL-ERROR");
    expect(text.startsWith("OLD-HEAD-LINE")).toBe(false);
  });

  it("keeps the first line intact when the cut lands exactly on a line boundary", () => {
    const firstLine = "KEEP-FIRST-LINE\n";
    const tail = firstLine + "y".repeat(2 * KB - firstLine.length); // exactly 2 KB of whole lines
    const log = "PRECEDING-DROPPED-LINE\n" + tail; // the byte before the cut is the '\n'
    const { text, truncated } = truncateLog(log, 2);
    expect(truncated).toBe(true);
    expect(text.startsWith("KEEP-FIRST-LINE")).toBe(true); // NOT dropped at a boundary cut
    expect(text).not.toContain("PRECEDING-DROPPED-LINE");
  });

  it("just-over-the-cap by one byte truncates", () => {
    const log = "h\n" + "y".repeat(KB);
    expect(truncateLog(log, 1).truncated).toBe(true);
  });

  it("defaults to MAX_LOG_KB", () => {
    expect(truncateLog("z".repeat(MAX_LOG_KB * KB + 1)).truncated).toBe(true);
  });

  it("handles an empty log", () => {
    expect(truncateLog("")).toEqual({ text: "", truncated: false });
  });
});

describe("buildSummaryPrompt", () => {
  it("names the four things to report and defaults to English", () => {
    const p = buildSummaryPrompt().toLowerCase();
    for (const s of ["error", "warning", "cause", "fix"]) expect(p).toContain(s);
    expect(buildSummaryPrompt()).toContain('"en"');
  });
  it("instructs the reply language from the given locale", () => {
    expect(buildSummaryPrompt("ja")).toContain('"ja"');
  });
});

describe("normalizeLocale", () => {
  it("reduces a full tag to its base language", () => {
    expect(normalizeLocale("ja-JP")).toBe("ja");
    expect(normalizeLocale("en-US")).toBe("en");
  });
  it("falls back to en for missing / malformed input", () => {
    for (const bad of [undefined, "", "../evil", 123, "toolonglanguagecode"]) expect(normalizeLocale(bad)).toBe("en");
  });
});

describe("parseSummaryOutput", () => {
  it("trims surrounding whitespace", () => {
    expect(parseSummaryOutput("\n  Errors: boom\n")).toBe("Errors: boom");
  });
  it("returns empty for whitespace-only output", () => {
    expect(parseSummaryOutput("   \n")).toBe("");
  });
});

describe("summarizeLog", () => {
  it("runs claude on the truncated log and returns its summary (happy path)", async () => {
    const runClaude = ok("Errors: missing module\nSuggested fix: yarn add foo");
    const res = await summarizeLog("npm ERR! cannot find module foo", { runClaude });
    expect(res).toEqual({ summary: "Errors: missing module\nSuggested fix: yarn add foo", truncated: false });
    expect(runClaude).toHaveBeenCalledOnce();
    expect(runClaude.mock.calls[0][0].input).toContain("npm ERR!");
  });

  it("threads the locale into the prompt so claude replies in that language", async () => {
    const runClaude = ok("要約: モジュール不足");
    await summarizeLog("npm ERR!", { runClaude, locale: "ja" });
    expect(runClaude.mock.calls[0][0].prompt).toContain('"ja"');
  });

  it("short-circuits empty output without spawning claude", async () => {
    const runClaude = ok("unused");
    const res = await summarizeLog("   \n\t", { runClaude });
    expect(res.summary).toMatch(/No command output/i);
    expect(runClaude).not.toHaveBeenCalled();
  });

  it("passes the truncated tail (not the head) to claude when over the cap", async () => {
    const runClaude = ok("Errors: fail");
    const log = "HEAD\n" + "x".repeat(2 * KB) + "\nDEEP-TAIL";
    await summarizeLog(log, { runClaude, maxLogKb: 2 });
    const input = runClaude.mock.calls[0][0].input;
    expect(input).toContain("DEEP-TAIL");
    expect(input.startsWith("HEAD")).toBe(false);
  });

  it("throws when claude produces no output (failure)", async () => {
    const runClaude: RunClaude = vi.fn(async () => ({ stdout: "", stderr: "not logged in", code: 1 }));
    await expect(summarizeLog("some log", { runClaude })).rejects.toThrow(/not logged in/);
  });

  it("propagates a spawn failure", async () => {
    const runClaude: RunClaude = vi.fn(async () => {
      throw new Error("spawn claude ENOENT");
    });
    await expect(summarizeLog("some log", { runClaude })).rejects.toThrow(/ENOENT/);
  });
});
