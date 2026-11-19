// @vitest-environment node
//
// Which log GET /api/session/:id reads the session's OWN WORDS from (#2121).
//
// `?agent=` already decided where the two header badges come from (#1465); `lastPrompt` and
// `lastResponse` were read from claude's per-project transcript whatever it said. A codex session
// has no file there — codex mints its own id and writes a rollout under $CODEX_HOME — so the route
// answered nulls and the cockpit roster's `prompt` and `reply` lines were blank for every codex
// cell while the claude cell beside it was filled. (The `summary` line is claude's own `ai-title`,
// which codex writes nowhere; it stays empty and is not what this fixes.)
//
// Pinned at the ROUTE rather than at `sessionLastTurn`, which had the branch all along: what was
// broken is that this handler never asked it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { mountSessionRoutes } from "../../../server/routes/session-routes";
import { projectSessionsDir } from "../../../server/session/project-dir";
import { lastPrompts, lastResponses } from "../../../server/session/registry";
import { clearedTranscripts, forgetClearedTranscript, markTranscriptCleared } from "../../../server/session/transcript/cleared-transcripts";
import { clearAgentTitleCache } from "../../../server/agents/agent-session-title";

// A codex session is addressed by the id codex minted for itself — what the sidebar hands over for
// a resumed one, and what the spawn mapping resolves to for a fresh one.
const SESSION = "01a0b1ce-52ce-7ee3-96b3-6ae19313a77b";

const freshenRosterTitle = vi.fn();
const app = express();
mountSessionRoutes(app, { freshenRosterTitle, publishActivity: () => {}, agentOfSession: () => null });
const call = routeCall(app);
const detail = (query: Record<string, string>) => call(`/api/session/${SESSION}?${new URLSearchParams(query)}`);

let home = "";
let cwd = "";

const line = (record: unknown): string => `${JSON.stringify(record)}\n`;

/** A rollout where codex really keeps one: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl */
async function writeRollout(prompt: string, reply: string): Promise<void> {
  const dir = path.join(home, ".codex", "sessions", "2026", "09", "18");
  await fs.mkdir(dir, { recursive: true });
  const turnId = "01a0b1ce-9ed3-7991-b78d-04c65b3fd59a";
  const body =
    line({ type: "session_meta", payload: { id: SESSION, cwd } }) +
    line({ type: "event_msg", payload: { type: "task_started", turn_id: turnId } }) +
    line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } }) +
    line({ type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: reply } });
  await fs.writeFile(path.join(dir, `rollout-2026-09-18T08-58-04-${SESSION}.jsonl`), body);
}

async function writeClaudeTranscript(prompt: string, reply: string, id: string = SESSION): Promise<void> {
  const dir = projectSessionsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const body =
    line({ type: "user", message: { role: "user", content: prompt } }) +
    line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply }], stop_reason: "end_turn" } });
  await fs.writeFile(path.join(dir, `${id}.jsonl`), body);
}

/** The same, plus the two fields that are NOT the exchange: the title Claude Code writes for
 *  itself, and a tool call the work-phase classifier reads. */
async function writeTitledClaudeTranscript(): Promise<void> {
  const dir = projectSessionsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${SESSION}.jsonl`),
    line({ type: "ai-title", aiTitle: "claude's own title" }) +
      line({ type: "user", message: { role: "user", content: "claude prompt" } }) +
      line({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "a.ts" } }], stop_reason: "tool_use" },
      }),
  );
}

beforeEach(async () => {
  freshenRosterTitle.mockClear();
  clearAgentTitleCache();
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-session-detail-agent-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  cwd = path.join(home, "ws");
  await fs.mkdir(cwd, { recursive: true });
  // The live maps outrank the disk read (sessionDetailView), and they are process-wide. A value
  // another spec left behind would answer this one's assertions without any file being read.
  lastPrompts.delete(SESSION);
  lastResponses.delete(SESSION);
});

afterEach(async () => {
  vi.restoreAllMocks();
  lastPrompts.delete(SESSION);
  lastResponses.delete(SESSION);
  await fs.rm(home, { recursive: true, force: true });
});

describe("GET /api/session/:id — the exchange comes from the agent's own log", () => {
  it("answers a codex cell from its rollout, where claude has no file for the id", async () => {
    await writeRollout("what did the roster show?", "nothing at all");
    const res = await detail({ cwd, agent: "codex" });
    expect(res.status).toBe(200);
    expect(res.body.lastPrompt).toBe("what did the roster show?");
    expect(res.body.lastResponse).toBe("nothing at all");
  });

  // The control for the assertion above: it must fail because the ROLLOUT was not read, not because
  // the fixture is unreachable. Claude is also what a client that sends no `?agent=` gets.
  it.each([{ cwd }, { cwd, agent: "claude" }])("leaves the same rollout unread when asked as claude (%j)", async (query) => {
    await writeRollout("what did the roster show?", "nothing at all");
    const res = await detail(query);
    expect(res.status).toBe(200);
    expect(res.body.lastPrompt).toBeNull();
    expect(res.body.lastResponse).toBeNull();
  });

  // The other direction: reading the agent's log must not reroute claude, whose pair still comes
  // out of the summary fold this route already runs.
  it("still answers a claude cell from claude's transcript", async () => {
    await writeClaudeTranscript("claude's prompt", "claude's reply");
    const res = await detail({ cwd, agent: "claude" });
    expect(res.status).toBe(200);
    expect(res.body.lastPrompt).toBe("claude's prompt");
    expect(res.body.lastResponse).toBe("claude's reply");
  });

  // An agent whose own log has no reader yet answers with nulls — NOT with claude's transcript
  // under its name, which is the collision `sessionLastTurn` states as "not claude" to avoid.
  it("does not hand an unparsed agent claude's transcript for the same id", async () => {
    await writeClaudeTranscript("claude's prompt", "claude's reply");
    const res = await detail({ cwd, agent: "grok" });
    expect(res.status).toBe(200);
    expect(res.body.lastPrompt).toBeNull();
    expect(res.body.lastResponse).toBeNull();
  });

  // The exchange was only ONE of the three things this route took from claude's transcript
  // regardless of agent, and fixing it alone left the other two — observed during Claude review,
  // not flagged by Codex. Measured on this fixture before the fix: a grok session came back with
  // `workPhase: "implementing"`, and the title manager was handed claude's own `ai-title` and
  // claude's user-turn count, which is what puts a title on the roster row.
  it("takes NOTHING from claude's transcript for another agent — not the phase, not the title", async () => {
    await writeTitledClaudeTranscript();
    const res = await detail({ cwd, agent: "grok" });
    expect(res.status).toBe(200);
    expect(res.body.workPhase).toBeNull();
    expect(freshenRosterTitle).not.toHaveBeenCalled();
  });

  // #2123: the roster's third line. The route answers what the agent's OWN store calls the session,
  // in a field of its own — `aiTitle` stays the value this server manages in memory, which is what
  // carries the /clear sentinel and is claude's alone.
  it("answers what codex's own store calls the session, beside the exchange", async () => {
    await writeRollout("what did the roster show?", "nothing at all");
    const res = await detail({ cwd, agent: "codex" });
    expect(res.status).toBe(200);
    expect(res.body.agentTitle).toBe("what did the roster show?");
    expect(res.body.aiTitle).toBeNull();
  });

  it("answers null for claude, whose title comes from the fold instead", async () => {
    await writeTitledClaudeTranscript();
    const res = await detail({ cwd, agent: "claude" });
    expect(res.status).toBe(200);
    expect(res.body.agentTitle).toBeNull();
  });

  // An agent whose store cannot answer for one id yet says nothing, rather than the route failing
  // or borrowing another agent's value.
  it("answers null for an agent whose store has no per-id title", async () => {
    const res = await detail({ cwd, agent: "grok" });
    expect(res.status).toBe(200);
    expect(res.body.agentTitle).toBeNull();
  });

  // The wire has three states and they mean three things: a string, an explicit null ("the store has
  // nothing"), and the field ABSENT ("the store could not be read"). The client keeps what it shows
  // on the third, which is why a locked sqlite file must not erase a correct summary (Codex, round 4).
  it("omits agentTitle entirely when the agent's store could not be read", async () => {
    // A muse index that EXISTS and is not a database: the read fails rather than finding nothing.
    // (A store that is simply absent means "no sessions here" and answers null — see the reader spec.)
    const museHome = path.join(home, "muse");
    await fs.mkdir(museHome, { recursive: true });
    await fs.writeFile(path.join(museHome, "session-index.db"), "this is not sqlite");
    process.env.MUSE_HOME = museHome;
    try {
      const res = await detail({ cwd, agent: "muse" });
      expect(res.status).toBe(200);
      expect("agentTitle" in res.body).toBe(false);
    } finally {
      delete process.env.MUSE_HOME;
    }
  });

  // #3229: the name `/rename` gave is read off the same fold, and only claude's transcript can say it.
  it("answers the /rename name for claude, and none for another agent or a cleared session", async () => {
    const dir = projectSessionsDir(cwd);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${SESSION}.jsonl`),
      line({ type: "user", message: { role: "user", content: "claude prompt" } }) +
        line({ type: "custom-title", customTitle: "Parser rewrite", sessionId: SESSION }),
    );
    expect((await detail({ cwd, agent: "claude" })).body.customTitle).toBe("Parser rewrite");
    expect((await detail({ cwd, agent: "grok" })).body.customTitle).toBeNull();
    clearedTranscripts.add(SESSION);
    try {
      expect((await detail({ cwd, agent: "claude" })).body.customTitle).toBeNull();
    } finally {
      clearedTranscripts.delete(SESSION);
    }
  });

  // After a `/clear` or an in-session `/resume` the cell is in the successor's conversation, so the
  // exchange, the title and the badges come from that transcript, never the frozen one (#3347).
  it("answers a moved claude session from its successor's transcript", async () => {
    const successor = "02b0c2df-63df-4ff4-a7b4-7bf2a424b88c";
    await writeClaudeTranscript("the conversation the cell left", "old reply");
    await writeClaudeTranscript("the picked conversation", "picked reply", successor);
    await markTranscriptCleared(SESSION, undefined, successor);
    try {
      const { body } = await detail({ cwd, agent: "claude" });
      expect(body.lastPrompt).toBe("the picked conversation");
      expect(body.lastResponse).toBe("picked reply");
    } finally {
      await forgetClearedTranscript(SESSION, path.join(home, "marks"));
    }
  });

  // The control: claude's own session still gets all three, or the gate above is simply an outage.
  it("still reads the phase and the title for claude itself", async () => {
    await writeTitledClaudeTranscript();
    const res = await detail({ cwd, agent: "claude" });
    expect(res.status).toBe(200);
    expect(res.body.workPhase).toBe("implementing");
    expect(freshenRosterTitle).toHaveBeenCalledWith(SESSION, cwd, 1, "claude's own title");
  });
});
