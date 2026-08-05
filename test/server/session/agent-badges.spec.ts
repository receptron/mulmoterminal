// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { agentBadges, ANTIGRAVITY_MODEL_LABEL, type BadgeRoots } from "../../../server/session/agent-badges.js";
import { rememberAntigravityConversation } from "../../../server/session/registry.js";

// The header badges for a session that is not Claude (#1465). Each agent is asked the question the
// same way and answers as much of it as its own log can: codex both badges, grok the model, agy a
// constant. What must NOT happen is a number nobody wrote down.

const ROLLOUT_ID = "019fcb3a-a33c-7e72-8364-57e44926dfed";
const GROK_ID = "150496cf-fb8d-4c35-b19b-e2826a4e7242";
const CWD = "/Users/x/my proj";

const tokenCountLine = JSON.stringify({
  timestamp: "2026-08-04T05:26:35.526Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: { input_tokens: 108_611, cached_input_tokens: 21_248, output_tokens: 6481, total_tokens: 115_092 },
      last_token_usage: { input_tokens: 55_447, cached_input_tokens: 16_768, output_tokens: 3215, total_tokens: 58_662 },
      model_context_window: 258_400,
    },
  },
});
const turnContextLine = JSON.stringify({ timestamp: "2026-08-04T05:24:19.315Z", type: "turn_context", payload: { turn_id: "t1", model: "gpt-5.5" } });

describe("agentBadges", () => {
  let home = "";
  // The roots are injected rather than pointed at by CODEX_HOME / GROK_HOME: those are read by
  // every other codex and grok reader in the process, and a spec that reassigns them owns the
  // environment of whatever else its worker runs.
  let roots: BadgeRoots = {};

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "mt-agent-badges-"));
    roots = {
      codexSessions: path.join(home, "codex", "sessions"),
      grokSessions: path.join(home, "grok", "sessions"),
      antigravityBrain: path.join(home, "antigravity", "brain"),
    };
  });

  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const writeRollout = (lines: string[]) => {
    const dir = path.join(home, "codex", "sessions", "2026", "08", "04");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `rollout-2026-08-04T05-24-05-${ROLLOUT_ID}.jsonl`), `${lines.join("\n")}\n`);
  };

  const writeGrokSummary = (summary: unknown) => {
    const dir = path.join(home, "grok", "sessions", encodeURIComponent(CWD), GROK_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary));
  };

  const writeAntigravityTranscript = (id: string, lines: string[]) => {
    const dir = path.join(home, "antigravity", "brain", id, ".system_generated", "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "transcript.jsonl"), `${lines.join("\n")}\n`);
  };

  it("reads a codex session's totals, context and window out of its rollout", async () => {
    writeRollout([turnContextLine, tokenCountLine]);
    const badges = await agentBadges(CWD, ROLLOUT_ID, "codex", roots);
    expect(badges.context).toEqual({ model: "gpt-5.5", contextTokens: 55_447, contextWindow: 258_400 });
    expect(badges.usage.inputTokens).toBe(108_611);
    expect(badges.usage.outputTokens).toBe(6481);
  });

  // The one field that is not cumulative: `turn_context` is written once, at the start of a turn,
  // so a turn bigger than the tail window leaves its model row outside it. Without the head
  // fallback the badge disappears on exactly the long sessions the bounded read is for.
  it("falls back to the head's model when a huge turn pushed turn_context out of the tail", async () => {
    const filler = JSON.stringify({ type: "response_item", payload: { junk: "x".repeat(200_000) } });
    writeRollout([turnContextLine, ...Array.from({ length: 30 }, () => filler), tokenCountLine]);
    const badges = await agentBadges(CWD, ROLLOUT_ID, "codex", roots);
    expect(badges.context.model).toBe("gpt-5.5"); // read from the head, not the 4 MB tail
    expect(badges.context.contextTokens).toBe(55_447); // and the numbers still come from the tail
  });

  // Nothing on disk to read is the ordinary state of a session that has just been launched, and it
  // has to be silence rather than zeroes presented as a reading.
  it("answers nothing for a codex session with no rollout", async () => {
    const badges = await agentBadges(CWD, ROLLOUT_ID, "codex", roots);
    expect(badges.context.model).toBeNull();
    expect(badges.usage.inputTokens).toBe(0);
  });

  it("names grok's model, and reports no tokens because grok records none", async () => {
    writeGrokSummary({ current_model_id: "grok-4.5", session_summary: "whatever" });
    const badges = await agentBadges(CWD, GROK_ID, "grok", roots);
    expect(badges.context.model).toBe("grok-4.5");
    expect(badges.context.contextTokens).toBe(0);
    expect(badges.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });

  // grok partitions by directory, so the cwd is part of the lookup: the same id under another
  // directory is a different conversation and must not answer for this one.
  it("does not read a grok conversation from another directory", async () => {
    writeGrokSummary({ current_model_id: "grok-4.5" });
    expect((await agentBadges("/Users/x/elsewhere", GROK_ID, "grok", roots)).context.model).toBeNull();
  });

  it("reads an antigravity session model from its user turn settings metadata", async () => {
    const userInput = JSON.stringify({
      type: "USER_INPUT",
      content:
        "<USER_REQUEST>\nhello\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.6 Flash (High). No need to comment on this change if the user doesn't ask about it.\n</USER_SETTINGS_CHANGE>",
    });
    writeAntigravityTranscript("agy-123", [userInput]);
    const badges = await agentBadges(CWD, "agy-123", "antigravity", roots);
    expect(badges.context).toEqual({ model: "Gemini 3.6 Flash (High)", contextTokens: 0 });
    expect(badges.usage.inputTokens).toBe(0);
  });

  it("reads an antigravity session model when session key is mapped to a conversationId", async () => {
    const userInput = JSON.stringify({
      type: "USER_INPUT",
      content:
        "<USER_REQUEST>\nhello\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.6 Flash (High). No need to comment on this change if the user doesn't ask about it.\n</USER_SETTINGS_CHANGE>",
    });
    const sessionKey = "a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6";
    const conversationId = "f6e5d4c3-b2a1-4098-8765-43210fedcba9";
    rememberAntigravityConversation(sessionKey, conversationId, CWD);
    writeAntigravityTranscript(conversationId, [userInput]);

    const badges = await agentBadges(CWD, sessionKey, "antigravity", roots);
    expect(badges.context).toEqual({ model: "Gemini 3.6 Flash (High)", contextTokens: 0 });
  });

  it("falls back to default label for an antigravity session without model recorded or missing file", async () => {
    const badges = await agentBadges(CWD, "non-existent-id", "antigravity", roots);
    expect(badges.context).toEqual({ model: ANTIGRAVITY_MODEL_LABEL, contextTokens: 0 });
    expect(badges.usage.inputTokens).toBe(0);
  });
});
