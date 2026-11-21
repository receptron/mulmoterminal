// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readRelay, RELAY_MAX_PAGES } from "../../../../server/session/transcript/relay-read.js";
import { relayFingerprint, type RelayLimits } from "../../../../server/session/transcript/relay-range.js";
import type { TranscriptPage, TranscriptTurn } from "../../../../common/transcriptView.js";

const LIMITS: RelayLimits = { promptMaxChars: 600, totalMaxChars: 10_000 };
const viewTurn = (prompt: string): TranscriptTurn => ({
  at: null,
  rows: [
    { kind: "user", text: prompt },
    { kind: "assistant", text: `answer to ${prompt}` },
  ],
});
const markOf = (prompt: string) => relayFingerprint({ prompt, promptClipped: false, replies: [`answer to ${prompt}`], at: null });

/** A conversation split into pages of `perPage`, newest page first, with numeric cursors. */
function pagedReader(prompts: string[], perPage: number) {
  const reads: (string | null)[] = [];
  const readPage = async (before: string | null): Promise<TranscriptPage> => {
    reads.push(before);
    const end = before === null ? prompts.length : Number(before);
    const start = Math.max(0, end - perPage);
    return { view: { status: "ok", turns: prompts.slice(start, end).map(viewTurn), truncated: start > 0 }, older: start > 0 ? String(start) : null };
  };
  return { readPage, reads };
}

const promptsOf = (selection: Awaited<ReturnType<typeof readRelay>>) => (selection.status === "ok" ? selection.turns.map((t) => t.prompt) : selection.status);
const range = (count: number) => Array.from({ length: count }, (_unused, index) => `p${index}`);

describe("readRelay", () => {
  it("pages back until the marker, and sends what follows it", async () => {
    const reader = pagedReader(range(10), 3);
    const selection = await readRelay({ readPage: reader.readPage, lastCompletedPrompt: async () => "p9" }, markOf("p4"), LIMITS);
    expect(promptsOf(selection)).toEqual(["p5", "p6", "p7", "p8", "p9"]);
    expect(reader.reads).toEqual([null, "7"]);
  });

  it("reads to the start on a first relay, and sends everything that fits", async () => {
    const reader = pagedReader(range(5), 2);
    const selection = await readRelay({ readPage: reader.readPage, lastCompletedPrompt: async () => "p4" }, null, LIMITS);
    expect(promptsOf(selection)).toEqual(range(5));
    expect(selection).toMatchObject({ moreBefore: false });
  });

  it("leaves out the running turn", async () => {
    const reader = pagedReader(range(4), 10);
    expect(promptsOf(await readRelay({ readPage: reader.readPage, lastCompletedPrompt: async () => "p2" }, markOf("p0"), LIMITS))).toEqual(["p1", "p2"]);
  });

  it("stops at the page limit and says earlier exchanges were left out", async () => {
    const reader = pagedReader(range(100), 1);
    const selection = await readRelay({ readPage: reader.readPage, lastCompletedPrompt: async () => "p99" }, markOf("p0"), LIMITS);
    expect(reader.reads).toHaveLength(RELAY_MAX_PAGES);
    expect(selection).toMatchObject({ status: "ok", moreBefore: true, markLost: false });
  });

  it("stops once the budget is spent", async () => {
    const reader = pagedReader(range(20), 2);
    await readRelay({ readPage: reader.readPage, lastCompletedPrompt: async () => "p19" }, null, { promptMaxChars: 600, totalMaxChars: 40 });
    expect(reader.reads).toEqual([null, "18"]);
  });

  it("falls back to the latest exchange when the marker is not in the conversation", async () => {
    const reader = pagedReader(range(3), 2);
    const selection = await readRelay({ readPage: reader.readPage, lastCompletedPrompt: async () => "p2" }, "0".repeat(64), LIMITS);
    expect(promptsOf(selection)).toEqual(["p2"]);
    expect(selection).toMatchObject({ markLost: true });
  });

  it("has nothing to send when the view is not readable", async () => {
    const selection = await readRelay(
      { readPage: async () => ({ view: { status: "none" }, older: null }), lastCompletedPrompt: async () => "p0" },
      null,
      LIMITS,
    );
    expect(selection).toEqual({ status: "no-turn" });
  });
});
