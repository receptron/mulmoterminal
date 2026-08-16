// @vitest-environment node
//
// That a session's prompts are found however far back in the history file they sit.
//
// The bug this pins was mine and shipped past two bots: `sessionPrompts` read claude's prompt
// history with `readTailRecords`, the bounded tail every OTHER reader here uses. That is right for
// a transcript — one file per session, so its last 4 MB really are that session's recent turns —
// and wrong for this file, which is one per USER. Its last 4 MB are EVERYONE's recent prompts, so a
// session whose activity is a few days old falls outside the window and the pane shows nothing.
//
// Measured on the owner's real machine before the fix: 254 sessions had prompts on disk that the
// pane reported as 0, the worst of them 848 prompts. Found by the owner opening the pane (#1749).
//
// A pure-function test could not have caught it: the rule was right and the READ was wrong. So this
// one writes a file bigger than the window and puts the target's prompts at the far end of it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionPrompts } from "../../../server/session/session-reads.js";
import { codexPromptScan, foldCodexPrompt, PROMPT_SCAN_LIMIT } from "../../../server/session/prompt-history.js";
import { forEachJsonlRecord } from "../../../server/infra/jsonl-file.js";

const SESSION = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

// Comfortably past DEFAULT_TAIL_BYTES (4 MB) in jsonl-file.ts, so the oldest rows cannot be in the
// window under any rounding.
const PADDING_BYTES = 5 * 1024 * 1024;

let home = "";
let realHome: string | undefined;

const line = (sessionId: string, display: string) =>
  `${JSON.stringify({ display, pastedContents: {}, timestamp: 1_700_000_000_000, project: "/ws", sessionId })}\n`;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-prompt-window-"));
  realHome = process.env.HOME;
  process.env.HOME = home;
  vi.spyOn(os, "homedir").mockReturnValue(home);
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  await fs.rm(home, { recursive: true, force: true });
});

/** Our session's prompts first, then enough of everyone else's to push them past the tail window. */
async function writeHistoryWithOursAtTheFront(): Promise<void> {
  const parts = [line(SESSION, "the prompt that fell out of the window"), line(SESSION, "and this one too")];
  const filler = line(OTHER, "x".repeat(400));
  let bytes = 0;
  while (bytes < PADDING_BYTES) {
    parts.push(filler);
    bytes += filler.length;
  }
  await fs.writeFile(path.join(home, ".claude", "history.jsonl"), parts.join(""));
}

describe("sessionPrompts reads the whole prompt history, not its tail", () => {
  it("finds prompts that sit more than a tail-window back", async () => {
    await writeHistoryWithOursAtTheFront();
    const { prompts } = await sessionPrompts("/ws", SESSION, "claude");
    expect(prompts.map((p) => p.text)).toEqual(["the prompt that fell out of the window", "and this one too"]);
  });

  it("still ignores every other session's prompts, however many there are", async () => {
    await writeHistoryWithOursAtTheFront();
    const { prompts } = await sessionPrompts("/ws", OTHER, "claude");
    // The filler IS that session's, so this checks the scope holds rather than expecting nothing.
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((p) => p.text.startsWith("x"))).toBe(true);
  });

  it("answers empty for a session with nothing in the file, rather than someone else's rows", async () => {
    await writeHistoryWithOursAtTheFront();
    const { prompts } = await sessionPrompts("/ws", "22222222-3333-4444-8555-666666666666", "claude");
    expect(prompts).toEqual([]);
  });
});

// The same window trap on the codex side. A rollout is one file per conversation, so a tail read at
// least stays inside the right session — but a long one still drops its early prompts. Three of the
// 2,586 rollouts on the owner's machine are past 4 MB; the largest holds 9 prompts, of which a tail
// read would find 5 (#1749).
describe("a codex rollout is streamed too", () => {
  it("finds a prompt written before the last tail-window of the rollout", async () => {
    const rollout = path.join(home, "rollout.jsonl");
    const userMessage = (message: string) =>
      `${JSON.stringify({ type: "event_msg", timestamp: "2026-08-16T02:31:02.318Z", payload: { type: "user_message", message } })}\n`;
    // A reasoning row is what actually bulks a rollout out; the shape does not matter, the bytes do.
    const filler = `${JSON.stringify({ type: "event_msg", payload: { type: "reasoning", text: "y".repeat(400) } })}\n`;
    const parts = [userMessage("the codex prompt at the very start")];
    let bytes = 0;
    while (bytes < PADDING_BYTES) {
      parts.push(filler);
      bytes += filler.length;
    }
    parts.push(userMessage("and one at the end"));
    await fs.writeFile(rollout, parts.join(""));

    const scan = codexPromptScan(PROMPT_SCAN_LIMIT);
    await forEachJsonlRecord(rollout, (record) => foldCodexPrompt(scan, record));
    expect(scan.found.map((p) => p.text)).toEqual(["the codex prompt at the very start", "and one at the end"]);
  });
});
