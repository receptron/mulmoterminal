// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseCodexRolloutHead,
  parseCodexSessionMeta,
  isResumableThread,
  listCodexSessions,
  codexRolloutExists,
  metaCacheSize,
} from "../../../server/agents/codex-sessions.js";

const UUID_A = "019f251d-001c-7542-b13e-9a627effce52";
const UUID_B = "019db01d-aaa3-7ba2-b597-b29a7fca488f";

const metaLine = (id: string, cwd: string | null, threadSource?: string): string =>
  JSON.stringify({
    type: "session_meta",
    payload: { id, cwd, originator: "codex-tui", ...(threadSource === undefined ? {} : { thread_source: threadSource }) },
  });
const userMsgLine = (message: string): string => JSON.stringify({ type: "event_msg", payload: { type: "user_message", message } });
// The environment context codex injects first is a response_item/message (role user), NOT an
// event_msg/user_message — the parser must skip it and use the real prompt.
const envContextLine = (): string =>
  JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>…</environment_context>" }] },
  });

describe("parseCodexRolloutHead", () => {
  it("extracts id, cwd, and the first real user message as title", () => {
    const head = [metaLine(UUID_A, "/work"), envContextLine(), userMsgLine("fix the login bug")].join("\n");
    expect(parseCodexRolloutHead(head)).toEqual({ id: UUID_A, cwd: "/work", title: "fix the login bug" });
  });
  it("falls back to a generic title when there's no user message yet", () => {
    expect(parseCodexRolloutHead(metaLine(UUID_A, "/work"))).toEqual({ id: UUID_A, cwd: "/work", title: "Codex session" });
  });
  it("returns null without a session_meta", () => {
    expect(parseCodexRolloutHead(userMsgLine("hi"))).toBeNull();
  });
  it("ignores a truncated trailing line", () => {
    const head = `${metaLine(UUID_A, "/work")}\n${userMsgLine("do a thing")}\n{"type":"event_ms`;
    expect(parseCodexRolloutHead(head)?.title).toBe("do a thing");
  });
  it("collapses whitespace and caps the title length", () => {
    const long = "a".repeat(200);
    const head = [metaLine(UUID_A, "/work"), userMsgLine(`  multi\n  line\t${long}`)].join("\n");
    const title = parseCodexRolloutHead(head)?.title ?? "";
    expect(title).toHaveLength(60);
    expect(title.startsWith("multi line a")).toBe(true);
  });
});

describe("listCodexSessions", () => {
  let root: string;
  const dayDir = (r: string): string => path.join(r, "2026", "07", "08");
  // `stamp` is the ISO-ish timestamp the filename carries, which is what the scan orders by — kept
  // separate from `mtime` so a test can make the two disagree the way a resumed session does.
  interface SessionFixture {
    id: string;
    cwd: string;
    msg: string;
    mtime: Date;
    stamp?: string;
    threadSource?: string;
  }
  function writeSessionOn({ id, cwd, msg, mtime, stamp = "2026-07-08T00-00-00", threadSource }: SessionFixture): void {
    const dir = dayDir(root);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-${stamp}-${id}.jsonl`);
    writeFileSync(file, [metaLine(id, cwd, threadSource), userMsgLine(msg)].join("\n") + "\n");
    utimesSync(file, mtime, mtime);
  }
  function writeSession(id: string, cwd: string, msg: string, mtime: Date): void {
    writeSessionOn({ id, cwd, msg, mtime });
  }
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-sess-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists sessions for the cwd, newest first", async () => {
    writeSession(UUID_A, "/work", "older", new Date(2026, 6, 8, 10));
    writeSession(UUID_B, "/work", "newer", new Date(2026, 6, 8, 11));
    const list = await listCodexSessions(root, "/work", 10);
    expect(list.map((s) => s.id)).toEqual([UUID_B, UUID_A]);
    expect(list[0].title).toBe("newer");
  });
  it("excludes sessions from other cwds", async () => {
    writeSession(UUID_A, "/work", "mine", new Date(2026, 6, 8, 10));
    writeSession(UUID_B, "/other", "theirs", new Date(2026, 6, 8, 11));
    const list = await listCodexSessions(root, "/work", 10);
    expect(list.map((s) => s.id)).toEqual([UUID_A]);
  });
  it("returns nothing for an empty store", async () => {
    expect(await listCodexSessions(root, "/work", 10)).toEqual([]);
  });

  // #1777: the cwd filter used to run AFTER a global newest-200 window, so a directory whose
  // rollouts were older than 200 others answered empty however many it owned. On a real store that
  // silenced 138 of 159 directories.
  it("finds a session that sits far outside the old 200-file window", async () => {
    writeSession(UUID_A, "/work", "the one I want", new Date(2026, 6, 8, 9));
    for (let i = 0; i < 250; i++) {
      const id = `019f251d-001c-7542-b13e-${i.toString().padStart(12, "0")}`;
      writeSessionOn({
        id,
        cwd: "/elsewhere",
        msg: `noise ${i}`,
        mtime: new Date(2026, 6, 9, 10),
        stamp: `2026-07-09T00-00-${(i % 60).toString().padStart(2, "0")}`,
      });
    }
    const list = await listCodexSessions(root, "/work", 10);
    expect(list.map((s) => s.title)).toEqual(["the one I want"]);
  });

  // Subagent threads carry the PARENT's cwd, so without the filter they match and fill the list.
  it("suppresses subagent and automation threads but keeps unknown and absent ones", async () => {
    writeSession(UUID_A, "/work", "mine", new Date(2026, 6, 8, 10));
    const thread = (suffix: string, msg: string, threadSource: string, hour: number): void =>
      writeSessionOn({
        id: `019f251d-001c-7542-b13e-0000000${suffix}`,
        cwd: "/work",
        msg,
        mtime: new Date(2026, 6, 8, hour),
        stamp: "2026-07-08T00-00-01",
        threadSource,
      });
    thread("0aaa1", "sub", "subagent", 11);
    thread("0aaa2", "auto", "automation", 12);
    thread("0aaa3", "voice", "realtime_voice", 13);
    thread("0aaa4", "explicit user", "user", 14);
    const titles = (await listCodexSessions(root, "/work", 10)).map((s) => s.title);
    expect(titles).toEqual(["explicit user", "voice", "mine"]);
  });

  // The window used to be picked by the filename's timestamp and only then sorted by mtime, so a
  // session created long ago and used today was cut from the window by its NAME and never reached
  // the sort. A session is appended to for as long as it is open — measured up to 7h past its
  // creation stamp — so this is the row a user most wants and the one most likely to be dropped.
  it("keeps a session whose name is old but which was written to most recently", async () => {
    writeSessionOn({ id: UUID_A, cwd: "/work", msg: "old name, used today", mtime: new Date(2026, 6, 8, 20), stamp: "2026-07-08T01-00-00" });
    for (let i = 0; i < 250; i++) {
      const id = `019f251d-001c-7542-b13e-${(700000000000 + i).toString().padStart(12, "0")}`;
      writeSessionOn({
        id,
        cwd: "/elsewhere",
        msg: `noise ${i}`,
        mtime: new Date(2026, 6, 8, 12),
        stamp: `2026-07-08T12-00-${(i % 60).toString().padStart(2, "0")}`,
      });
    }
    writeSessionOn({ id: UUID_B, cwd: "/work", msg: "new name, used earlier", mtime: new Date(2026, 6, 8, 10), stamp: "2026-07-08T23-00-00" });
    expect((await listCodexSessions(root, "/work", 10)).map((s) => s.title)).toEqual(["old name, used today", "new name, used earlier"]);
  });

  // codex writes ~20KB of session_meta and a preamble before the first prompt; the old 64KB head
  // stopped short of it on every `codex exec` rollout measured, so every row read "Codex session".
  it("finds a title that sits past the old 64KB head window", async () => {
    const filler = Array.from({ length: 40 }, (_, i) => JSON.stringify({ type: "response_item", payload: { pad: "p".repeat(2000), i } }));
    const dir = dayDir(root);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-07-08T00-00-00-${UUID_A}.jsonl`);
    writeFileSync(file, [metaLine(UUID_A, "/work"), ...filler, userMsgLine("buried prompt")].join("\n") + "\n");
    expect(statSync(file).size).toBeGreaterThan(64 * 1024);
    expect((await listCodexSessions(root, "/work", 10)).map((s) => s.title)).toEqual(["buried prompt"]);
  });

  it("honours the limit, keeping the most recently written", async () => {
    writeSession(UUID_A, "/work", "older", new Date(2026, 6, 8, 10));
    writeSession(UUID_B, "/work", "newer", new Date(2026, 6, 8, 11));
    expect((await listCodexSessions(root, "/work", 1)).map((s) => s.title)).toEqual(["newer"]);
  });

  it("ignores a rollout whose first line is not a session_meta", async () => {
    const dir = dayDir(root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `rollout-2026-07-08T00-00-00-${UUID_A}.jsonl`), [userMsgLine("no meta here"), metaLine(UUID_A, "/work")].join("\n"));
    expect(await listCodexSessions(root, "/work", 10)).toEqual([]);
  });

  // The listing is fetched exactly when sessions are being started, so it routinely sees a rollout
  // codex has created but not yet written. Memoising that "no" would hide the session until the
  // process restarts — the same silent-disappearance shape this PR exists to remove.
  // (Observed during Claude review, not flagged by either bot.)
  it("picks up a rollout that was still empty when it was first scanned", async () => {
    const dir = dayDir(root);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-07-08T00-00-00-${UUID_A}.jsonl`);
    writeFileSync(file, "");
    expect(await listCodexSessions(root, "/work", 10)).toEqual([]);

    writeFileSync(file, [metaLine(UUID_A, "/work"), userMsgLine("written a moment later")].join("\n") + "\n");
    expect((await listCodexSessions(root, "/work", 10)).map((s) => s.title)).toEqual(["written a moment later"]);
  });

  // Codex flagged the other half of the same shape on #1782: a first record that is non-empty but
  // half-written parses as nothing, and remembering THAT hides the session once codex finishes it.
  it("picks up a rollout whose first record was still being written when it was first scanned", async () => {
    const dir = dayDir(root);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-07-08T00-00-00-${UUID_A}.jsonl`);
    const full = metaLine(UUID_A, "/work");
    writeFileSync(file, full.slice(0, 40)); // mid-record: non-empty, unterminated, unparseable
    expect(await listCodexSessions(root, "/work", 10)).toEqual([]);

    writeFileSync(file, [full, userMsgLine("finished a moment later")].join("\n") + "\n");
    expect((await listCodexSessions(root, "/work", 10)).map((s) => s.title)).toEqual(["finished a moment later"]);
  });

  // The cache remembers a path's answer, which never goes stale — but a pruned rollout simply stops
  // appearing in the scan, so without pruning the map would grow with every rollout this process
  // has ever seen rather than with the files on disk (CodeRabbit on #1782).
  it("forgets rollouts the store no longer has", async () => {
    writeSession(UUID_A, "/work", "kept", new Date(2026, 6, 8, 10));
    writeSession(UUID_B, "/work", "removed later", new Date(2026, 6, 8, 11));
    expect((await listCodexSessions(root, "/work", 10)).map((s) => s.title)).toEqual(["removed later", "kept"]);
    const before = metaCacheSize();

    rmSync(path.join(dayDir(root), `rollout-2026-07-08T00-00-00-${UUID_B}.jsonl`));
    expect((await listCodexSessions(root, "/work", 10)).map((s) => s.title)).toEqual(["kept"]);
    expect(metaCacheSize()).toBe(before - 1);
  });

  // codex prunes day directories while we walk them, and the scan now enumerates every day rather
  // than stopping at a fixed 200 files — so it meets more of them per request. An unguarded
  // readdirSync throws out of the whole scan and the route answers 500: NO sessions, rather than
  // the ones that were readable. (Observed during Claude review, not flagged by either bot.)
  it("keeps listing when one day directory cannot be read", async () => {
    writeSession(UUID_A, "/work", "readable day", new Date(2026, 6, 8, 10));
    const blocked = path.join(root, "2026", "07", "09");
    mkdirSync(blocked, { recursive: true });
    chmodSync(blocked, 0o000);
    try {
      expect((await listCodexSessions(root, "/work", 10)).map((s) => s.title)).toEqual(["readable day"]);
    } finally {
      chmodSync(blocked, 0o755);
    }
  });

  it.each([
    ["an empty file", ""],
    ["a non-JSON first line", "not json\n"],
    ["a session_meta without an id", `${JSON.stringify({ type: "session_meta", payload: { cwd: "/work" } })}\n`],
  ])("skips %s rather than failing the whole listing", async (_label, body) => {
    writeSession(UUID_A, "/work", "good one", new Date(2026, 6, 8, 10));
    const dir = dayDir(root);
    writeFileSync(path.join(dir, `rollout-2026-07-08T23-00-00-${UUID_B}.jsonl`), body);
    expect((await listCodexSessions(root, "/work", 10)).map((s) => s.title)).toEqual(["good one"]);
  });
});

describe("parseCodexSessionMeta", () => {
  it("reads id, cwd and thread_source from line 1", () => {
    const line = JSON.stringify({ type: "session_meta", payload: { id: UUID_A, cwd: "/work", thread_source: "user" } });
    expect(parseCodexSessionMeta(line)).toEqual({ id: UUID_A, cwd: "/work", threadSource: "user" });
  });
  it("reports a missing cwd and thread_source as null rather than dropping the row", () => {
    expect(parseCodexSessionMeta(JSON.stringify({ type: "session_meta", payload: { id: UUID_A } }))).toEqual({ id: UUID_A, cwd: null, threadSource: null });
  });
  it.each([
    ["a user_message row", JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "hi" } })],
    ["a session_meta with no id", JSON.stringify({ type: "session_meta", payload: { cwd: "/work" } })],
    ["a session_meta whose id is not a uuid", JSON.stringify({ type: "session_meta", payload: { id: "nope" } })],
    ["a session_meta whose payload is not an object", JSON.stringify({ type: "session_meta", payload: "x" })],
    ["a non-object row", '"just a string"'],
    ["an array row", "[1,2,3]"],
    ["malformed JSON", "{trunc"],
    ["an empty line", ""],
  ])("returns null for %s", (_label, line) => {
    expect(parseCodexSessionMeta(line)).toBeNull();
  });
});

describe("isResumableThread", () => {
  const meta = (threadSource: string | null) => ({ id: UUID_A, cwd: "/work", threadSource });
  it.each(["subagent", "automation"])("suppresses %s", (source) => {
    expect(isResumableThread(meta(source))).toBe(false);
  });
  // A deny-list on purpose: an allow-list of "user" would make each new codex thread kind vanish
  // from the listing silently, which is the failure mode this whole issue is about.
  it.each(["user", "realtime_voice", "some_future_kind", ""])("keeps %j", (source) => {
    expect(isResumableThread(meta(source))).toBe(true);
  });
  it("keeps a rollout written before codex recorded thread_source", () => {
    expect(isResumableThread(meta(null))).toBe(true);
  });
});

describe("codexRolloutExists", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-ex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds a rollout by its id, rejects unknown ids and non-uuids", () => {
    const dir = path.join(root, "2026", "07", "08");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `rollout-2026-07-08T00-00-00-${UUID_A}.jsonl`), metaLine(UUID_A, "/work") + "\n");
    expect(codexRolloutExists(root, UUID_A)).toBe(true);
    expect(codexRolloutExists(root, UUID_B)).toBe(false);
    expect(codexRolloutExists(root, "not-a-uuid")).toBe(false);
  });
});
