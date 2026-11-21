// @vitest-environment node
//
// Reading claude's transcript for the phone's view (#1751): which window is read, when it widens,
// and which of the four answers each on-disk situation produces.
//
// The transcripts live under a temp HOME, the same arrangement cleared-transcripts.spec.ts uses,
// because both exercise claude's real on-disk layout through projectSessionsDir.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearedTranscripts, forgetClearedTranscript, markTranscriptCleared } from "../../../../server/session/transcript/cleared-transcripts.js";
import { projectSessionsDir } from "../../../../server/session/project-dir.js";
import {
  UNREAD_SOURCES,
  hasReader,
  sessionTranscriptView,
  type TranscriptWindow,
  type UnreadSource,
} from "../../../../server/session/transcript/transcript-view-read.js";
import { TERMINAL_AGENTS } from "../../../../common/sessionAgent.js";

const SESSION = "11111111-2222-4333-8444-555555555555";

let home = "";
let cwd = "";

const line = (record: unknown): string => `${JSON.stringify(record)}\n`;

const userLine = (text: string) => line({ type: "user", timestamp: "2026-08-18T00:00:00.000Z", message: { role: "user", content: text } });
const assistantLine = (text: string) =>
  line({ type: "assistant", timestamp: "2026-08-18T00:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text }] } });

async function writeTranscriptOf(id: string, ...lines: string[]): Promise<void> {
  const dir = projectSessionsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.jsonl`), lines.join(""));
}

const writeTranscript = (...lines: string[]): Promise<void> => writeTranscriptOf(SESSION, ...lines);

// A window that starts `bytesInto` bytes past the START of the last `fromLast` lines — so the read
// deliberately begins mid-line, which is the case the whole widening rule exists for.
const windowFrom = (lines: string[], fromLast: number, bytesInto: number): TranscriptWindow => {
  const tail = lines.slice(lines.length - fromLast).join("");
  return { tailBytes: Buffer.byteLength(tail, "utf8") - bytesInto, maxTailBytes: 64 * 1024 };
};

const SMALL_WINDOW: TranscriptWindow = { tailBytes: 512, maxTailBytes: 64 * 1024 };

const rowTexts = (turn: { rows: { text: string }[] }): string[] => turn.rows.map((row) => row.text);

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-transcript-view-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  cwd = path.join(home, "ws");
  await fs.mkdir(cwd, { recursive: true });
  clearedTranscripts.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await forgetClearedTranscript(SESSION, path.join(home, "marks")); // memory too, successor included
  await fs.rm(home, { recursive: true, force: true });
  clearedTranscripts.clear();
});

describe("sessionTranscriptView", () => {
  it("reads the conversation as turns", async () => {
    await writeTranscript(userLine("first"), assistantLine("here you go"), userLine("second"), assistantLine("done"));
    const view = await sessionTranscriptView(cwd, SESSION);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.turns.map(rowTexts)).toEqual([
      ["first", "here you go"],
      ["second", "done"],
    ]);
    // The whole file fitted in one window, so nothing is missing.
    expect(view.truncated).toBe(false);
  });

  it("says truncated when the window did not reach the file's head", async () => {
    const lines = [userLine("first"), assistantLine("body"), userLine("second"), assistantLine("done")];
    await writeTranscript(...lines);
    // Starts ten bytes into the `second` prompt's line, so the fold sees only what follows it.
    const view = await sessionTranscriptView(cwd, SESSION, windowFrom(lines, 1, -10));
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.turns.map((turn) => turn.rows[0]?.text)).toEqual(["second"]);
    expect(view.truncated).toBe(true);
  });

  it("reads a final record whose newline has not landed yet", async () => {
    // Bounding the scan at the stat'd size is what stops it following the writer — but a range with
    // an explicit end never yields its last line, because at an arbitrary cut half a record and a
    // finished one look alike. At the SIZE they do not: JSON says which. Without that, a one-turn
    // session whose last write is still missing its newline shows nothing (Codex, PR #1776).
    await writeTranscript(userLine("hello"), assistantLine("hi").trimEnd());
    const view = await sessionTranscriptView(cwd, SESSION);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.turns.map(rowTexts)).toEqual([["hello", "hi"]]);
  });

  it("ignores a final record the writer is still in the middle of", async () => {
    await writeTranscript(userLine("hello"), assistantLine("hi"), '{"type":"assistant","mess');
    const view = await sessionTranscriptView(cwd, SESSION);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.turns.map(rowTexts)).toEqual([["hello", "hi"]]);
  });

  describe("the four answers", () => {
    it("none when there is no transcript at all", async () => {
      expect(await sessionTranscriptView(cwd, SESSION)).toEqual({ status: "none" });
    });

    it("none for a zero-byte transcript", async () => {
      await writeTranscript();
      expect(await sessionTranscriptView(cwd, SESSION)).toEqual({ status: "none" });
    });

    it("none when nothing in the file parses", async () => {
      await writeTranscript("not json\n", "{oops\n");
      expect(await sessionTranscriptView(cwd, SESSION)).toEqual({ status: "none" });
    });

    it("none when the WHOLE file was read and simply holds no turn — a size answer would be a lie", async () => {
      await writeTranscript(assistantLine("orphan"), assistantLine("another"));
      expect(await sessionTranscriptView(cwd, SESSION)).toEqual({ status: "none" });
    });

    it("cleared when the session moved with no successor recorded — the frozen file still exists", async () => {
      await writeTranscript(userLine("the conversation the user ended"), assistantLine("bye"));
      clearedTranscripts.add(SESSION);
      expect(await sessionTranscriptView(cwd, SESSION)).toEqual({ status: "cleared" });
    });

    // The cell is in the successor's conversation now, so that is what the view shows (#3347).
    it("reads the successor's transcript for a session that moved, never the frozen one", async () => {
      const successor = "22222222-3333-4444-8555-666666666666";
      await writeTranscript(userLine("the conversation the user left"), assistantLine("bye"));
      await writeTranscriptOf(successor, userLine("the picked conversation"), assistantLine("here it is"));
      await markTranscriptCleared(SESSION, undefined, successor);
      const view = await sessionTranscriptView(cwd, SESSION);
      expect(JSON.stringify(view)).toContain("the picked conversation");
      expect(JSON.stringify(view)).not.toContain("the conversation the user left");
    });

    it("too-large when the window widened to its ceiling without finding a turn", async () => {
      // One record far bigger than the ceiling, so every window opens inside it.
      await writeTranscript(userLine("the prompt, far away at the head"), assistantLine("x".repeat(8000)), assistantLine("small"));
      expect(await sessionTranscriptView(cwd, SESSION, { tailBytes: 512, maxTailBytes: 1024 })).toEqual({ status: "too-large" });
    });
  });

  describe("widening the window", () => {
    it("widens past a record bigger than the window, so the newest turn is not lost with it", async () => {
      // The whole point of decision 1: the newest turn is shown whatever it costs. A 4.5 MB single
      // record is not hypothetical (#1692) — the range fold drops the partial line it starts inside,
      // taking that record's turn with it unless the window grows.
      await writeTranscript(userLine("the prompt"), assistantLine("y".repeat(4000)));
      const view = await sessionTranscriptView(cwd, SESSION, SMALL_WINDOW);
      expect(view.status).toBe("ok");
      if (view.status !== "ok") return;
      expect(view.turns[0]?.rows[0]?.text).toBe("the prompt");
    });

    it("widens when the window holds RECORDS but no boundary", async () => {
      // `[record bigger than the window][a small assistant record]`: a reader that stopped at "I got
      // a record" would answer here, and its answer would be missing the turn it promised.
      const lines = [userLine("the prompt"), assistantLine("y".repeat(4000)), assistantLine("small")];
      await writeTranscript(...lines);
      const view = await sessionTranscriptView(cwd, SESSION, SMALL_WINDOW);
      expect(view.status).toBe("ok");
      if (view.status !== "ok") return;
      expect(view.turns.map(rowTexts)).toEqual([["the prompt", "y".repeat(4000), "small"]]);
    });

    // The range fold drops its first line unless told the range starts at one, because a window
    // picked by arithmetic almost always opens mid-line. When it opens exactly ON a line, the
    // dropped line is a whole record — and these two are what that costs (Codex, PR #1776).
    describe("when the window starts exactly at a line boundary", () => {
      it("keeps the prompt whose line it starts on, rather than losing that whole exchange", async () => {
        // The window opens exactly on `old`'s line and already holds a later boundary, so nothing
        // widens: dropping that line simply loses the turn, silently.
        const lines = [assistantLine("preamble"), userLine("old"), assistantLine("old body"), userLine("new"), assistantLine("answer")];
        await writeTranscript(...lines);
        const view = await sessionTranscriptView(cwd, SESSION, windowFrom(lines, 4, 0));
        expect(view.status).toBe("ok");
        if (view.status !== "ok") return;
        expect(view.turns.map(rowTexts)).toEqual([
          ["old", "old body"],
          ["new", "answer"],
        ]);
      });

      it("does not report a readable session as too-large when that line was the only boundary", async () => {
        const lines = [assistantLine("before"), userLine("the only prompt"), assistantLine("answer")];
        await writeTranscript(...lines);
        const view = await sessionTranscriptView(cwd, SESSION, { ...windowFrom(lines, 2, 0), maxTailBytes: 128 });
        expect(view.status).toBe("ok");
        if (view.status !== "ok") return;
        expect(view.turns.map(rowTexts)).toEqual([["the only prompt", "answer"]]);
      });
    });

    it("returns the newest turn COMPLETE once a boundary is in the window", async () => {
      // The stopping condition is "a boundary is in the window"; the guarantee is "the newest turn
      // is whole". They agree because nothing follows the LAST boundary except that turn's own
      // records — so a window holding any boundary holds the last one and everything after it.
      const lines = [userLine("old"), assistantLine("old body"), userLine("new"), assistantLine("part one"), assistantLine("part two")];
      await writeTranscript(...lines);
      const view = await sessionTranscriptView(cwd, SESSION, windowFrom(lines, 3, -20));
      expect(view.status).toBe("ok");
      if (view.status !== "ok") return;
      expect(view.turns.map(rowTexts)).toEqual([["new", "part one", "part two"]]);
    });
  });

  describe("what it refuses to read", () => {
    it("answers none for a session the host has no directory for, without reading its own", async () => {
      // projectSessionsDir("") resolves against the SERVER's working directory, so an unknown id
      // would otherwise be answered with whatever transcript of that name sits beside the server.
      const beside = projectSessionsDir(process.cwd());
      await fs.mkdir(beside, { recursive: true }).catch(() => {});
      await fs.writeFile(path.join(beside, `${SESSION}.jsonl`), userLine("not this session's conversation"));
      expect(await sessionTranscriptView("", SESSION)).toEqual({ status: "none" });
    });

    it("answers none for anything that is not a session id", async () => {
      await writeTranscript(userLine("hello"));
      const ids = ["", "../../../../etc/passwd", "not-a-uuid", `${SESSION}/../${SESSION}`, `${SESSION}.jsonl`];
      const answers = await Promise.all(ids.map((id) => sessionTranscriptView(cwd, id)));
      expect(answers).toEqual(ids.map(() => ({ status: "none" })));
    });
  });

  describe("the file handle", () => {
    // Polled every five seconds per open session, so one path that forgets to close is not one
    // leaked descriptor — it is a slow climb to EMFILE and a server that stops accepting anything.
    // Reading through a closed handle rejects with EBADF, which is the only way to ask a
    // FileHandle whether it is still open.
    const isClosed = async (handle: FileHandle): Promise<boolean> =>
      handle.read(Buffer.alloc(1), 0, 1, 0).then(
        () => false,
        () => true,
      );

    const closedHandles = (): Promise<boolean[]> => Promise.all(vi.mocked(fs.open).mock.results.map((result) => result.value.then(isClosed)));

    beforeEach(() => {
      vi.spyOn(fs, "open");
    });

    it("closes it after a normal read", async () => {
      await writeTranscript(userLine("hello"));
      await sessionTranscriptView(cwd, SESSION);
      expect(await closedHandles()).toEqual([true]);
    });

    it("closes it when it gives up with too-large", async () => {
      await writeTranscript(userLine("far away"), assistantLine("x".repeat(8000)));
      expect(await sessionTranscriptView(cwd, SESSION, { tailBytes: 512, maxTailBytes: 1024 })).toEqual({ status: "too-large" });
      expect(await closedHandles()).toEqual([true]);
    });

    it("does not open the file at all for a cleared session", async () => {
      await writeTranscript(userLine("ended"));
      clearedTranscripts.add(SESSION);
      await sessionTranscriptView(cwd, SESSION);
      expect(vi.mocked(fs.open)).not.toHaveBeenCalled();
    });

    it("stops at the size it stat'd, so what is appended DURING the read cannot extend the window", async () => {
      // The file is written while it is read — a live session appends every 2-17 seconds, in records
      // that reach megabytes — so a read that runs to EOF follows the writer instead of covering the
      // window it announced. The stat is the snapshot; here it reports the file as it was two lines
      // ago, and the third must not appear (Codex, PR #1776).
      const lines = [userLine("first"), assistantLine("body"), userLine("appended after the stat")];
      await writeTranscript(...lines);
      const handle = await fs.open(path.join(projectSessionsDir(cwd), `${SESSION}.jsonl`), "r");
      const real = await handle.stat();
      const snapshot = Buffer.byteLength(lines.slice(0, 2).join(""), "utf8");
      vi.spyOn(handle, "stat").mockResolvedValue(Object.assign(Object.create(Object.getPrototypeOf(real)) as Stats, real, { size: snapshot }));
      vi.mocked(fs.open).mockResolvedValueOnce(handle);
      const view = await sessionTranscriptView(cwd, SESSION);
      expect(view.status).toBe("ok");
      if (view.status !== "ok") return;
      expect(view.turns.map(rowTexts)).toEqual([["first", "body"]]);
    });

    it("still answers the conversation when CLOSING the handle fails", async () => {
      // An awaited throw inside `finally` replaces whatever the `try` produced, so a failing close
      // would turn a read that worked into an error on the phone (CodeRabbit, PR #1776).
      await writeTranscript(userLine("hello"), assistantLine("hi"));
      const failing = await fs.open(path.join(projectSessionsDir(cwd), `${SESSION}.jsonl`), "r");
      const close = vi.spyOn(failing, "close").mockRejectedValue(new Error("EIO"));
      vi.mocked(fs.open).mockResolvedValueOnce(failing);
      const warn = vi.spyOn(console, "error").mockImplementation(() => {});
      const view = await sessionTranscriptView(cwd, SESSION);
      expect(view.status).toBe("ok");
      expect(warn).toHaveBeenCalled(); // the failure is reported, not silent
      // The mocked close never closed anything, so this test owns the descriptor: `afterEach` rm's
      // this directory, and on Windows an unlink of a file still held open fails whatever `force`
      // says (CodeRabbit, PR #1776).
      close.mockRestore();
      await failing.close();
    });
  });
});

// ── choosing which agent's log answers (#1822) ────────────────────────────────────────────────
//
// The rule that had to survive the second reader: the AGENT IS NOT ASKED to choose one. A claude
// session that outlived a restart reports its agent as `shell`, so a reader picked by
// `agentOfSession` would lose the view on exactly those cells. Each source is asked whether IT has
// a file instead.
describe("which source answers", () => {
  const CODEX_SESSION = "99999999-8888-4777-8666-555555555555";

  const codexRollout = (...records: unknown[]): string => records.map((r) => `${JSON.stringify(r)}\n`).join("");
  const codexUser = (text: string) => ({
    timestamp: "2026-08-23T05:18:28.228Z",
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  });
  const codexAssistant = (text: string) => ({
    timestamp: "2026-08-23T05:18:30.000Z",
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
  });

  /** A rollout where codex really keeps one: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl */
  async function writeRollout(id: string, body: string): Promise<void> {
    const dir = path.join(home, ".codex", "sessions", "2026", "08", "23");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `rollout-2026-08-23T14-18-25-${id}.jsonl`), body);
  }

  it("reads a codex rollout when claude has no file for the session", async () => {
    await writeRollout(CODEX_SESSION, codexRollout(codexUser("what changed?"), codexAssistant("this and that")));
    const view = await sessionTranscriptView(cwd, CODEX_SESSION, {});
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.turns).toHaveLength(1);
    expect(view.turns[0]?.rows.map((row) => row.text)).toEqual(["what changed?", "this and that"]);
  });

  // The regression the file's original comment was written to prevent, now with two readers in play.
  it("still reads CLAUDE's transcript for a session whose agent reports as shell", async () => {
    await writeTranscript(userLine("hello"), assistantLine("hi"));
    const view = await sessionTranscriptView(cwd, SESSION, { agentOf: () => "shell" });
    expect(view.status).toBe("ok");
  });

  // A codex session whose rollout exists must not be answered by claude's empty read, and the other
  // way round: the first source with a FILE wins, not the first source asked.
  // Third source, and the one whose locate is the most expensive — a readdir of every cursor project
  // plus a read of each one's `.workspace-trusted`, because the slug a project directory is named by
  // is a truncated-and-hashed form of the path and cannot be reconstructed.
  it("reads a cursor chat when neither claude nor codex has a file", async () => {
    const CURSOR_SESSION = "33333333-4444-4555-8666-777777777777";
    const project = path.join(home, ".cursor", "projects", "some-slug");
    await fs.mkdir(path.join(project, "agent-transcripts", CURSOR_SESSION), { recursive: true });
    await fs.writeFile(path.join(project, ".workspace-trusted"), JSON.stringify({ workspacePath: cwd }));
    const records = [
      { role: "user", message: { content: [{ type: "text", text: "<user_query>\nwhat is this\n</user_query>" }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "a cursor chat" }] } },
      { type: "turn_ended", status: "success" },
    ];
    await fs.writeFile(
      path.join(project, "agent-transcripts", CURSOR_SESSION, `${CURSOR_SESSION}.jsonl`),
      records.map((r) => `${JSON.stringify(r)}\n`).join(""),
    );
    const view = await sessionTranscriptView(cwd, CURSOR_SESSION, {});
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.turns[0]?.rows.map((row) => row.text)).toEqual(["what is this", "a cursor chat"]);
  });

  // Grok files a conversation under the cwd it ran in, and the session key IS its conversation id,
  // so the path is one join (#3379).
  const GROK_SESSION = "e0977d25-42a5-41d3-b442-ee4de92b7163";
  const grokHistory = async (dirCwd: string, id: string, records: readonly object[]): Promise<void> => {
    const dir = path.join(home, ".grok", "sessions", encodeURIComponent(dirCwd), id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "chat_history.jsonl"), records.map((r) => `${JSON.stringify(r)}\n`).join(""));
  };
  const grokTurn = [
    { type: "user", content: [{ type: "text", text: "<system-reminder>skills</system-reminder>" }], synthetic_reason: "system_reminder" },
    { type: "user", content: [{ type: "text", text: "<user_query>\nwhat is this\n</user_query>" }], prompt_index: 0 },
    { type: "assistant", content: "a grok conversation" },
  ];

  it("reads a grok conversation filed under this cwd", async () => {
    await grokHistory(cwd, GROK_SESSION, grokTurn);
    const view = await sessionTranscriptView(cwd, GROK_SESSION, {});
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.turns.map((turn) => turn.rows.map((row) => row.text))).toEqual([["what is this", "a grok conversation"]]);
  });

  it("does not read a grok conversation filed under another directory", async () => {
    await grokHistory(path.join(home, "elsewhere"), GROK_SESSION, grokTurn);
    expect(await sessionTranscriptView(cwd, GROK_SESSION, { agentOf: () => null, unreadSources: [] })).toEqual({ status: "none" });
  });

  // Antigravity mints its own conversation id; a key with no recorded mapping is read as that id
  // itself, the path a session picked from the conversation list takes (#3379).
  it("reads an antigravity conversation by its conversation id", async () => {
    const AGY_SESSION = "77099efc-d0f0-4b6f-98cc-9a9ca4e9b50c";
    const dir = path.join(home, ".gemini", "antigravity-cli", "brain", AGY_SESSION, ".system_generated", "logs");
    await fs.mkdir(dir, { recursive: true });
    const steps = [
      {
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-21T03:36:21Z",
        content: "<USER_REQUEST>\nwhat is this\n</USER_REQUEST>",
      },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "an antigravity conversation" },
    ];
    await fs.writeFile(path.join(dir, "transcript.jsonl"), steps.map((r) => `${JSON.stringify(r)}\n`).join(""));
    const view = await sessionTranscriptView(cwd, AGY_SESSION, {});
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.turns.map((turn) => turn.rows.map((row) => row.text))).toEqual([["what is this", "an antigravity conversation"]]);
  });

  // The key is joined into a path. SESSION_ID_RE refuses this one before any source is asked; the
  // antigravity source's own shape check is the second line behind it, as claude's isInside is.
  it("does not read a transcript a key with ../ would point at outside agy's brain directory", async () => {
    const outside = path.join(home, ".gemini", "antigravity-cli", "evil", ".system_generated", "logs");
    await fs.mkdir(outside, { recursive: true });
    const steps = [
      { type: "USER_INPUT", status: "DONE", content: "<USER_REQUEST>\nq\n</USER_REQUEST>" },
      { source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "leaked" },
    ];
    await fs.writeFile(path.join(outside, "transcript.jsonl"), steps.map((r) => `${JSON.stringify(r)}\n`).join(""));
    expect(await sessionTranscriptView(cwd, "../evil", { agentOf: () => null, unreadSources: [] })).toEqual({ status: "none" });
  });

  it("does not let one source's miss end the search", async () => {
    await writeRollout(CODEX_SESSION, codexRollout(codexUser("ask codex"), codexAssistant("answered")));
    const view = await sessionTranscriptView(cwd, CODEX_SESSION, { agentOf: () => "codex" });
    expect(view.status).toBe("ok");
  });
});

// ── not-supported vs none (#1822) ─────────────────────────────────────────────────────────────
describe("an agent whose conversation this host cannot read", () => {
  const OTHER = "77777777-6666-4555-8444-333333333333";
  // One id per store test. The registry maps are module-level and outlive a test, so a session
  // planted in one would otherwise still be held in the next — which is how two of these first
  // asserted the answer they were written to rule out.
  const GROK_ID = "77777777-6666-4555-8444-333333330001";
  const MUSE_ID = "77777777-6666-4555-8444-333333330003";
  const SHELL_ID = "77777777-6666-4555-8444-333333330004";

  it("says not-supported for an agent with no reader here", async () => {
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => "muse" })).toEqual({ status: "not-supported" });
  });

  // A shell has no conversation and never will, so the screen IS its content. Telling a person it
  // is "not supported" would name a feature that is not coming.
  it("says none for a shell, not not-supported", async () => {
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => "shell" })).toEqual({ status: "none" });
  });

  // An agent WITH a reader that simply has not written anything is `none` — there is nothing to
  // implement, so there is nothing to say.
  it("says none for a wired agent that has written nothing", async () => {
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => "claude" })).toEqual({ status: "none" });
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => "codex" })).toEqual({ status: "none" });
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => "cursor" })).toEqual({ status: "none" });
    // Copilot joined the list in the same change that made a source able to be a QUERY rather than a
    // file. Nothing here says so twice: `hasReader` is derived from TRANSCRIPT_SOURCES, so this line
    // moving up from the not-supported test above IS the wiring being asserted.
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => "copilot" })).toEqual({ status: "none" });
    // Grok moved up the same way when it got a reader (#3379).
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => "grok" })).toEqual({ status: "none" });
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => "antigravity" })).toEqual({ status: "none" });
  });

  // #2116. The caller's resolver answers from the PROCESS — a live pty, or what tmux says the pane
  // is running — and both are gone once a session ends. From that moment these sessions were told
  // "nothing has been written yet", which is false: their conversation exists and this host cannot
  // read it. So when the process cannot say, the reader-less agents' own STORES are asked.
  // Grok has a reader now (#3379), so a grok conversation directory that holds no history yet is a
  // session with nothing written — `none` — and no longer one this host "cannot read".
  it("says none, not not-supported, for a grok session that has written nothing", async () => {
    await fs.mkdir(path.join(home, ".grok", "sessions", encodeURIComponent(cwd), GROK_ID), { recursive: true });
    expect(await sessionTranscriptView(cwd, GROK_ID, { agentOf: () => null })).toEqual({ status: "none" });
  });

  // The real antigravity and muse stores are maps this process hydrates from `~/.mulmoterminal`, so
  // planting one through production's own writer would append to the MACHINE's log — which is what
  // the first version of this test did. They are handed in instead.
  // NO ASSERTION HERE MAY DEPEND ON THE MACHINE'S OWN REGISTRY (Codex, round 1). Two of the three
  // production probes read maps hydrated from the real `~/.mulmoterminal` — this spec's temp home is
  // installed per test, long after those modules evaluated — so a test consulting them would assert
  // against whatever this machine happens to hold. The first version went further and WROTE there,
  // through production's own writer.
  //
  // So the registry-backed probes are handed in.
  const storeHolding = (agent: "muse", held: string): readonly UnreadSource[] => [{ agent, holds: (_cwd, id) => Promise.resolve(id === held) }];

  it("says not-supported for a muse session whose process is gone", async () => {
    const view = await sessionTranscriptView(cwd, MUSE_ID, { agentOf: () => null, unreadSources: storeHolding("muse", MUSE_ID) });
    expect(view).toEqual({ status: "not-supported" });
  });

  // The stores are asked ONLY when the process could not say. A live shell cell answers `shell` from
  // its own pty and must not be re-interpreted by whatever else happens to hold the id.
  it("still says none for a shell whose id a reader-less agent also holds", async () => {
    const view = await sessionTranscriptView(cwd, SHELL_ID, { agentOf: () => "shell", unreadSources: storeHolding("muse", SHELL_ID) });
    expect(view).toEqual({ status: "none" });
  });

  // The default path. What remains in production's list (muse) answers from a map hydrated off this
  // machine's own `~/.mulmoterminal`, which a test must not write into. So production's own muse
  // entry is swapped for one that holds a known id, for this test only, and the call passes no list —
  // it is answered only if the default really is production's list.
  it("uses the production store list when the caller passes none", async () => {
    const id = "77777777-6666-4555-8444-333333330006";
    const muse = UNREAD_SOURCES.find((source) => source.agent === "muse");
    if (!muse) throw new Error("muse is no longer in UNREAD_SOURCES; rewrite this test");
    const original = muse.holds;
    muse.holds = (_cwd, asked) => Promise.resolve(asked === id);
    try {
      expect(await sessionTranscriptView(cwd, id, { agentOf: () => null })).toEqual({ status: "not-supported" });
    } finally {
      muse.holds = original;
    }
  });

  // The list is only correct while it is exactly the complement of the readers. When #1822 wires one
  // of these, leaving it here would make a readable session report that it cannot be read.
  //
  // DERIVED FROM PRODUCTION'S OWN WIRING, not from a list kept here. The first version compared
  // against a hand-written set of readable agents, which passes in exactly the case it claims to
  // catch — Codex wired an inert grok reader, left grok in `UNREAD_SOURCES`, and watched this test
  // go green (round 2). A test can encode the wrong rule and still pass; this one now fails.
  it("asks exactly the agents that have no reader", () => {
    const asked = UNREAD_SOURCES.map((source) => source.agent).sort();
    // TERMINAL_AGENTS holds the agents only — `shell` is not one of them, and is answered before
    // this list is ever consulted.
    const readerless = TERMINAL_AGENTS.filter((agent) => !hasReader(agent)).sort();
    expect(asked).toEqual(readerless);
  });

  it("says none when neither the process nor any store knows the session", async () => {
    // An EMPTY store list is what "no store knows it" means here. Consulting the production list
    // would ask this MACHINE's own registry, which is not a fact this test gets to depend on.
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => null, unreadSources: [] })).toEqual({ status: "none" });
    expect(await sessionTranscriptView(cwd, OTHER, { unreadSources: [] })).toEqual({ status: "none" });
  });

  // `cleared` outranks it: the user ended that conversation, which is a better sentence than either.
  it("keeps cleared ahead of not-supported", async () => {
    clearedTranscripts.add(OTHER);
    expect(await sessionTranscriptView(cwd, OTHER, { agentOf: () => "grok" })).toEqual({ status: "cleared" });
  });
});
