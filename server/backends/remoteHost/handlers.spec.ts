// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRemoteHostHandlers } from "./handlers/index.js";
import type { SessionScreen } from "./terminalScreen.js";
import type { TranscriptView } from "../../../common/transcriptView.js";
import { initCollectionsBackend } from "../collections/collections.js";
import type { AnswerFailure, AnswerResult } from "../../../common/askQuestion.js";

const unusedTerminalDeps = {
  mobileFileStager: { stage: async () => ({ storagePath: "unused", expiresAtMs: 0 }), sweepExpired: async () => undefined },
  spawnIssueSeed: async () => ({ sessionId: "unused-session", agent: "claude" as const, seedRuns: false }),
  listTerminalSessions: async () => ({ sessions: [], icons: {} }),
  captureTerminalScreen: async () => ({ screen: "", suggestion: "", quickCommands: [] }),
  captureTerminalTranscript: async () => ({ status: "none" as const }),
  listPastSessions: async () => ({ cwd: "", sessions: [] }),
  readPastTranscript: async () => ({ view: { status: "none" as const }, older: null }),
  writeToSession: () => false,
  canClearBox: () => false,
  submitSequence: () => "\r",
  sessionAgent: () => "claude" as const,
  launchTerminal: async () => ({ ok: true }) as const,
  openQuestion: async () => null,
  answerQuestion: async (): Promise<AnswerResult> => ({ ok: true }),
};

describe("createRemoteHostHandlers", () => {
  let ws: string;
  let spawned: string[];
  let ingested: string[][];
  let cleanedUp: string[][];
  let handlers: ReturnType<typeof createRemoteHostHandlers>;

  beforeEach(() => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-rh-"));
    spawned = [];
    ingested = [];
    cleanedUp = [];
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: (message) => {
        spawned.push(message);
        return { chatId: `chat-${spawned.length}` };
      },
      // Fake ingest: record the storage ids, echo a saved path per file, and a no-op
      // staging cleanup (tracked so a test can assert it runs after a successful spawn).
      ingest: async (storageIds) => {
        ingested.push(storageIds);
        return {
          attachments: storageIds.map((id) => ({ path: `data/attachments/${id}.jpg`, mimeType: "image/jpeg" })),
          cleanupStaging: async () => {
            cleanedUp.push(storageIds);
          },
        };
      },
      ...unusedTerminalDeps,
    });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("exposes every expected handler", () => {
    for (const name of [
      "listCollections",
      "getCollection",
      "listFeeds",
      "getFeed",
      "listShortcuts",
      "listSkills",
      "listAccountingBooks",
      "startChat",
      "listIssues",
      "startIssueWork",
      "getRemoteView",
      "getRemoteViewItems",
      "mutateRemoteViewItem",
      "google.calendar.createEvent",
      "google.calendar.listEvents",
      "google.calendar.listCalendars",
      "google.calendar.colors",
    ]) {
      expect(typeof handlers[name]).toBe("function");
    }
  });

  it("startChat seeds a visible chat with the trimmed message and returns the chatId", async () => {
    const result = await handlers.startChat({ message: "  hello world  " });
    expect(spawned).toEqual(["hello world"]);
    expect(result).toEqual({ started: true, chatId: "chat-1" });
  });

  it("startChat rejects an empty message without spawning", async () => {
    await expect(handlers.startChat({ message: "   " })).rejects.toThrow(/message is required/);
    expect(spawned).toEqual([]);
  });

  it("serves the phone's file commands (#2911)", () => {
    expect(Object.keys(handlers)).toEqual(expect.arrayContaining(["listMobileFileProjects", "listMobileFiles", "getMobileFile"]));
  });

  it("startChat ingests attachments and references their saved paths in the prompt", async () => {
    const result = await handlers.startChat({ message: "look at this", attachments: [{ storage_id: "abc" }, { storage_id: "def" }] });
    expect(ingested).toEqual([["abc", "def"]]);
    expect(spawned[0]).toContain("look at this");
    expect(spawned[0]).toContain("data/attachments/abc.jpg");
    expect(spawned[0]).toContain("data/attachments/def.jpg");
    expect(result).toEqual({ started: true, chatId: "chat-1" });
  });

  // Regression (#746): staging is reaped only AFTER a successful spawn.
  it("startChat cleans up staging after spawning succeeds", async () => {
    await handlers.startChat({ message: "hi", attachments: [{ storage_id: "abc" }] });
    expect(spawned).toHaveLength(1);
    expect(cleanedUp).toEqual([["abc"]]); // cleanup ran, once, after spawn
  });

  // Regression (#746 Codex review): the chat already started, so a cleanupStaging rejection
  // must NOT turn the successful start into a reported failure (which the phone would retry,
  // spawning a duplicate chat). The rejection is isolated at the handler boundary.
  it("startChat still succeeds when staging cleanup rejects (chat already spawned)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: (message) => {
        spawned.push(message);
        return { chatId: "chat-ok" };
      },
      ingest: async () => ({
        attachments: [],
        cleanupStaging: async () => {
          throw new Error("storage offline");
        },
      }),
      ...unusedTerminalDeps,
    });
    const result = await handlers.startChat({ message: "hi", attachments: [{ storage_id: "abc" }] });
    expect(result).toEqual({ started: true, chatId: "chat-ok" });
    expect(spawned).toHaveLength(1); // spawned exactly once — no false failure, no retry
    warn.mockRestore();
  });

  // Regression (#746): if the spawn throws, staging is NOT deleted, so the phone can retry
  // with the same storage_ids and still find its uploads.
  it("startChat does NOT clean up staging when the spawn fails", async () => {
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: () => {
        throw new Error("no provider token");
      },
      ingest: async (storageIds) => ({
        attachments: storageIds.map((id) => ({ path: `data/attachments/${id}.jpg`, mimeType: "image/jpeg" })),
        cleanupStaging: async () => {
          cleanedUp.push(storageIds);
        },
      }),
      ...unusedTerminalDeps,
    });
    await expect(handlers.startChat({ message: "hi", attachments: [{ storage_id: "abc" }] })).rejects.toThrow(/no provider token/);
    expect(cleanedUp).toEqual([]); // staging survives for a retry
  });

  it("startChat rejects a malformed attachments param without spawning", async () => {
    await expect(handlers.startChat({ message: "hi", attachments: [{ nope: 1 }] })).rejects.toThrow(/storage_id/);
    expect(spawned).toEqual([]);
  });

  it("listShortcuts returns the pinned shortcuts read from the workspace", async () => {
    mkdirSync(path.join(ws, "config"), { recursive: true });
    writeFileSync(
      path.join(ws, "config", "shortcuts.json"),
      JSON.stringify({ shortcuts: [{ kind: "collection", slug: "tasks", title: "Tasks", icon: "check" }] }),
    );
    const result = (await handlers.listShortcuts({})) as unknown as { shortcuts: unknown[] };
    expect(result.shortcuts).toEqual([{ kind: "collection", slug: "tasks", title: "Tasks", icon: "check" }]);
  });

  it("listShortcuts returns an empty list when no shortcuts file exists", async () => {
    const result = (await handlers.listShortcuts({})) as unknown as { shortcuts: unknown[] };
    expect(result.shortcuts).toEqual([]);
  });
});

// listSkills leans on the globally-configured collection host (discoverCollections)
// to subtract collection slugs, so it gets its own block that wires that host at a
// tmp workspace. Assertions use contains/not-contains because the user scope scans
// the developer's real ~/.claude/skills, which the test can't control.
describe("createRemoteHostHandlers · listSkills", () => {
  let ws: string;
  let handlers: ReturnType<typeof createRemoteHostHandlers>;

  const COL_SCHEMA = {
    title: "My Collection",
    icon: "star",
    dataPath: "data/mycol/items",
    primaryKey: "id",
    fields: { id: { type: "string", label: "ID", primary: true, required: true } },
  };

  beforeEach(() => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-rh-skills-"));
    // A plain skill (SKILL.md only) — should be listed.
    mkdirSync(path.join(ws, ".claude", "skills", "mt-plain-skill"), { recursive: true });
    writeFileSync(path.join(ws, ".claude", "skills", "mt-plain-skill", "SKILL.md"), "---\ndescription: a plain skill\n---\n\nbody");
    // A collection that ALSO ships a SKILL.md — appears in the raw skill scan but
    // must be subtracted (listCollections serves it), so it should NOT be listed.
    mkdirSync(path.join(ws, ".claude", "skills", "mt-collection"), { recursive: true });
    writeFileSync(path.join(ws, ".claude", "skills", "mt-collection", "schema.json"), JSON.stringify(COL_SCHEMA));
    writeFileSync(path.join(ws, ".claude", "skills", "mt-collection", "SKILL.md"), "---\ndescription: a collection\n---\n\nbody");
    mkdirSync(path.join(ws, "data", "mycol", "items"), { recursive: true });

    initCollectionsBackend({ workspace: ws });
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: () => ({ chatId: "x" }),
      ingest: async () => ({ attachments: [], cleanupStaging: async () => {} }),
      ...unusedTerminalDeps,
    });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("lists plain skill ids and subtracts collection slugs", async () => {
    const { skills } = (await handlers.listSkills({})) as unknown as { skills: string[] };
    expect(skills).toContain("mt-plain-skill");
    expect(skills).not.toContain("mt-collection");
  });
});

// The phone's per-session view (#786, mulmoserver#107) reads the session's dir, branch,
// summary and prompt off this response, so the handler has to forward whatever the host
// could answer instead of trimming the payload back to screen + suggestion.
// Real session ids are UUIDs (SESSION_ID_RE), and every handler in this file now refuses anything
// else — so a readable stand-in like "a" would make these pass by being rejected (#2192).
const SESSION = "11111111-2222-4333-8444-555555555555";

describe("getTerminalScreen", () => {
  const handlersFor = (screen: SessionScreen) =>
    createRemoteHostHandlers({
      workspace: "/nowhere",
      spawnChat: () => ({ chatId: "x" }),
      ingest: async () => ({ attachments: [], cleanupStaging: async () => {} }),
      ...unusedTerminalDeps,
      captureTerminalScreen: async () => screen,
    });

  it("forwards the session's cwd, branch, summary and prompt beside the screen", async () => {
    const handlers = handlersFor({
      screen: "$ ",
      suggestion: "",
      quickCommands: [],
      cwd: "/repo",
      branch: "main",
      summary: "Fix the parser",
      prompt: "fix it",
    });
    expect(await handlers.getTerminalScreen({ sessionId: SESSION })).toEqual({
      screen: "$ ",
      suggestion: "",
      quickCommands: [],
      cwd: "/repo",
      branch: "main",
      summary: "Fix the parser",
      prompt: "fix it",
    });
  });

  it("forwards a screen the host had no metadata for unchanged", async () => {
    const handlers = handlersFor({ screen: "$ ", suggestion: "ls", quickCommands: [] });
    expect(await handlers.getTerminalScreen({ sessionId: SESSION })).toEqual({ screen: "$ ", suggestion: "ls", quickCommands: [] });
  });

  it("rejects a request with no session id", async () => {
    await expect(handlersFor({ screen: "", suggestion: "", quickCommands: [] }).getTerminalScreen({})).rejects.toThrow(/sessionId is required/);
  });
  // The hole this closed (#2192). tmux resolves `-t NAME` by PREFIX, so before the check a phone
  // could send a LEADING FRAGMENT of somebody else's id and be handed their screen — the opposite
  // of the promise this whole area rests on, that the phone names a session and the host looks up
  // everything else. The transcript handler checked its id because it built a path; this one built
  // a tmux target, which was assumed to be safe and was not.
  it("refuses an id that is not a session id, before anything is built out of it", async () => {
    let asked: string | null = null;
    const handlers = createRemoteHostHandlers({
      workspace: "/nowhere",
      spawnChat: () => ({ chatId: "x" }),
      ingest: async () => ({ attachments: [], cleanupStaging: async () => {} }),
      ...unusedTerminalDeps,
      captureTerminalScreen: async (sessionId: string) => {
        asked = sessionId;
        return { screen: "", suggestion: "", quickCommands: [] };
      },
    });
    const rejected = [SESSION.slice(0, 8), SESSION.slice(0, -1), `${SESSION}-suffix`, "../../etc/passwd", "not-a-uuid"];
    await Promise.all(rejected.map((sessionId) => expect(handlers.getTerminalScreen({ sessionId })).rejects.toThrow(/not a session id/)));
    expect(asked).toBeNull();
  });
});

// The class, asserted over the SOURCE rather than handler by handler. Every command in that file
// takes a `sessionId` from the phone, and the defect was one of them reading it without a shape
// check while its neighbour did (#2192) — a per-handler judgement call, made once per handler,
// which is exactly the kind that is eventually made wrong. A new command that reads the raw field
// fails here instead.
const HANDLER_SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "handlers", "terminalSession.ts"), "utf8");

// `launchTerminal` is the documented exception: the shape is checked further in by
// `sessionExistsHere` (#2190), and `decideLaunchTerminal` owns the wording of every refusal it
// gives, so a second check here would answer one of them twice.
const RAW_ID_ALLOWED = "launchTerminal(params.agent, params.sessionId)";

// The reader's own body is the one place the raw field is read on purpose; scanning it would make
// the sweep complain about the fix.
const READER_START = "const sessionIdOf = (params: JsonObject): string => {";
const READER_END = "};";

describe("every phone command reads its session id through one checked reader", () => {
  it("leaves no handler reading params.sessionId raw", () => {
    const [beforeReader, rest] = HANDLER_SOURCE.split(READER_START);
    const afterReader = rest?.slice(rest.indexOf(READER_END) + READER_END.length) ?? "";
    const raw = `${beforeReader}${afterReader}`
      .split("\n")
      .map((text) => text.trim())
      .filter((text) => text.includes("params.sessionId") && !text.includes(RAW_ID_ALLOWED));
    expect(raw).toEqual([]);
  });

  // Finding nothing must not be how this passes.
  it("finds the reader and every handler that uses it", () => {
    expect(HANDLER_SOURCE).toContain("const sessionIdOf = (params: JsonObject): string =>");
    expect(HANDLER_SOURCE.split("sessionIdOf(params)").length - 1).toBeGreaterThanOrEqual(5);
  });
});

// The phone's transcript view (#1751). Two things are pinned here rather than in the reader's own
// spec: that the FOUR statuses survive the wire (a boolean would leave "not written yet", "ended
// with /clear" and "too big" as the same blank screen), and that the id's SHAPE is checked — this
// is the handler that turns one into a file path, and for a while the only one that checked.
describe("getTerminalTranscript", () => {
  const handlersFor = (transcript: TranscriptView) =>
    createRemoteHostHandlers({
      workspace: "/nowhere",
      spawnChat: () => ({ chatId: "x" }),
      ingest: async () => ({ attachments: [], cleanupStaging: async () => {} }),
      ...unusedTerminalDeps,
      captureTerminalTranscript: async () => transcript,
    });

  it("forwards the turns and the truncated flag", async () => {
    const view: TranscriptView = {
      status: "ok",
      turns: [
        {
          at: "2026-08-18T00:00:00.000Z",
          rows: [
            { kind: "user", text: "fix it" },
            { kind: "tool", text: "Bash", clipped: true },
          ],
        },
      ],
      truncated: true,
    };
    expect(await handlersFor(view).getTerminalTranscript({ sessionId: SESSION })).toEqual(view);
  });

  it("keeps the four answers apart", async () => {
    const statuses = ["none", "cleared", "too-large"] as const;
    const answers = await Promise.all(statuses.map((status) => handlersFor({ status }).getTerminalTranscript({ sessionId: SESSION })));
    expect(answers).toEqual([{ status: "none" }, { status: "cleared" }, { status: "too-large" }]);
  });

  it("rejects a request with no session id", async () => {
    await expect(handlersFor({ status: "none" }).getTerminalTranscript({})).rejects.toThrow(/sessionId is required/);
  });

  it("rejects an id that is not a session id, which is what keeps it inside the project's directory", async () => {
    const rejected = ["../../../../etc/passwd", `${SESSION}/../${SESSION}`, `${SESSION}.jsonl`, "not-a-uuid"];
    await Promise.all(
      rejected.map((sessionId) => expect(handlersFor({ status: "none" }).getTerminalTranscript({ sessionId })).rejects.toThrow(/not a session id/)),
    );
  });
});

// The phone's half of #1685. What matters here is the SEAM: the phone sends option indexes and a
// dialog id, the host answers, and a refusal becomes a sentence the phone can show. The keystrokes
// themselves are session/answerQuestion.ts's business and are pinned there.
describe("question commands", () => {
  const OPEN = {
    sessionId: SESSION,
    toolUseId: "t1",
    questions: [{ question: "Red or blue?", header: "Color", options: [{ label: "Red" }, { label: "Blue" }], multiSelect: false }],
  };

  const handlersWith = (over: Partial<Parameters<typeof createRemoteHostHandlers>[0]>) =>
    createRemoteHostHandlers({
      workspace: "/ws",
      spawnChat: () => ({ chatId: "x" }),
      ingest: async () => ({ attachments: [], cleanupStaging: async () => {} }),
      ...unusedTerminalDeps,
      ...over,
    });

  it("forwards the open question, and null when there is none", async () => {
    expect(await handlersWith({ openQuestion: async () => OPEN }).getOpenQuestion({ sessionId: SESSION })).toEqual({ question: OPEN });
    expect(await handlersWith({ openQuestion: async () => null }).getOpenQuestion({ sessionId: SESSION })).toEqual({ question: null });
  });

  it("hands the picks through untouched — the host decides what they mean", async () => {
    const seen: unknown[] = [];
    const handlers = handlersWith({
      answerQuestion: async (sessionId: string, toolUseId: string, picks: unknown): Promise<AnswerResult> => {
        seen.push({ sessionId, toolUseId, picks });
        return { ok: true };
      },
    });

    expect(await handlers.answerQuestion({ sessionId: SESSION, toolUseId: "t1", picks: [[1]] })).toEqual({ ok: true });
    expect(seen).toEqual([{ sessionId: SESSION, toolUseId: "t1", picks: [[1]] }]);
  });

  // Thrown rather than returned: the command layer turns a rejection into the message the phone
  // shows, and each of these is something the person holding it can act on.
  it("turns each refusal into a sentence the phone can show", async () => {
    const refusing = (reason: AnswerFailure) => handlersWith({ answerQuestion: async () => ({ ok: false, reason }) });

    await expect(refusing("closed").answerQuestion({ sessionId: SESSION, toolUseId: "t1", picks: [] })).rejects.toThrow(/already answered/);
    await expect(refusing("bad-picks").answerQuestion({ sessionId: SESSION, toolUseId: "t1", picks: [] })).rejects.toThrow(/do not match/);
    await expect(refusing("unwritable").answerQuestion({ sessionId: SESSION, toolUseId: "t1", picks: [] })).rejects.toThrow(/outlived a server restart/);
    await expect(refusing("partial").answerQuestion({ sessionId: SESSION, toolUseId: "t1", picks: [] })).rejects.toThrow(/Finish it in the terminal/);
  });

  // Answering in words from the phone (#1693): the text rides the same command, and the host is
  // what sanitizes it and types it into the dialog's own field.
  it("passes words through", async () => {
    const seen: unknown[] = [];
    const handlers = handlersWith({
      answerQuestion: async (_sessionId, _toolUseId, picks, text): Promise<AnswerResult> => {
        seen.push({ picks, text });
        return { ok: true };
      },
    });

    await handlers.answerQuestion({ sessionId: SESSION, toolUseId: "t1", text: "green please" });
    expect(seen).toEqual([{ picks: undefined, text: "green please" }]);
  });

  it("rejects a request missing either id, saying which one", async () => {
    const handlers = handlersWith({});
    await expect(handlers.getOpenQuestion({})).rejects.toThrow(/sessionId is required/);
    await expect(handlers.answerQuestion({ sessionId: SESSION })).rejects.toThrow(/toolUseId is required/);
    await expect(handlers.answerQuestion({ toolUseId: "t1" })).rejects.toThrow(/sessionId is required/);
  });
});

// The launch command is the one place a refusal has to become a THROW: the command layer turns a
// rejection into the sentence the phone shows, so a handler that returned the refusal instead
// would report success and the user would watch for a cell that never opens. Nothing else covers
// it — the rule and the binding have their own specs and neither goes through the handler
// (Codex review, PR #2190 round 5).
describe("launchTerminal", () => {
  const handlersFor = (launchTerminal: (agent: unknown, sessionId: unknown) => Promise<{ ok: true } | { ok: false; error: string }>) =>
    createRemoteHostHandlers({
      workspace: "/nowhere",
      spawnChat: () => ({ chatId: "x" }),
      ingest: async () => ({ attachments: [], cleanupStaging: async () => {} }),
      ...unusedTerminalDeps,
      launchTerminal,
    });

  it("hands the agent and session straight to the host and answers ok", async () => {
    const seen: unknown[][] = [];
    const handlers = handlersFor(async (agent, sessionId) => {
      seen.push([agent, sessionId]);
      return { ok: true };
    });
    expect(await handlers.launchTerminal({ agent: "shell", sessionId: "s1" })).toEqual({ ok: true });
    expect(seen).toEqual([["shell", "s1"]]);
  });

  // Awaiting the host is what makes this work: a promise is truthy, so an un-awaited refusal reads
  // as `ok` and the phone would be told the terminal opened.
  it("turns a refusal into a throw carrying the host's reason", async () => {
    const handlers = handlersFor(async () => ({ ok: false, error: "no working directory known for session 's1'" }));
    await expect(handlers.launchTerminal({ agent: "shell", sessionId: "s1" })).rejects.toThrow(/no working directory known/);
  });

  it("reports a session that is gone with the host's own wording", async () => {
    const handlers = handlersFor(async () => ({ ok: false, error: "session 's1' is no longer running here" }));
    await expect(handlers.launchTerminal({ agent: "shell", sessionId: "s1" })).rejects.toThrow(/no longer running here/);
  });
});
