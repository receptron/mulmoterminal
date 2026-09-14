// @vitest-environment node
// Reading cursor's own record of a chat: which directory it belongs to, and what to call it.
//
// The interesting part is the ATTRIBUTION. Cursor's project directory is a slug of the working
// directory that is truncated and hashed for long paths, so it cannot be derived — the directory
// records its own path in `.workspace-trusted`, and a directory that does not is OMITTED. These
// pin that the failure mode is omission rather than another directory's chats.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cursorTranscriptTitle, cursorSessionExists, cursorSessionExistsForCwd, listCursorSessionsForCwd } from "../../../server/agents/cursor-sessions.js";

let home: string;
const CWD = "/Users/someone/project";
const OTHER = "/Users/someone/elsewhere";

/** A project directory as cursor lays one out, with a deliberately UNDERIVABLE slug. */
function project(slug: string, workspacePath: string | null): string {
  const dir = path.join(home, "projects", slug);
  mkdirSync(path.join(dir, "agent-transcripts"), { recursive: true });
  if (workspacePath !== null) writeFileSync(path.join(dir, ".workspace-trusted"), JSON.stringify({ trustedAt: "2026-09-14T00:00:00Z", workspacePath }), "utf8");
  return dir;
}

function chat(dir: string, id: string, firstUserText: string | null): void {
  mkdirSync(path.join(dir, "agent-transcripts", id), { recursive: true });
  const lines = firstUserText === null ? "" : JSON.stringify({ role: "user", message: { content: [{ type: "text", text: firstUserText }] } }) + "\n";
  writeFileSync(path.join(dir, "agent-transcripts", id, `${id}.jsonl`), lines, "utf8");
}

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "cursor-store-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("cursorTranscriptTitle", () => {
  it("unwraps the <user_query> cursor prepends a timestamp block to", () => {
    const line = JSON.stringify({
      role: "user",
      message: { content: [{ type: "text", text: "<timestamp>Monday</timestamp>\n<user_query>\nRun the tests\n</user_query>" }] },
    });
    expect(cursorTranscriptTitle(line)).toBe("Run the tests");
  });

  it("falls back to the whole text when there is no query wrapper", () => {
    expect(cursorTranscriptTitle(JSON.stringify({ role: "user", message: { content: [{ type: "text", text: " plain " }] } }))).toBe("plain");
  });

  it("reads nothing out of an assistant line, a truncated line, or an empty head", () => {
    expect(cursorTranscriptTitle(JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "hi" }] } }))).toBe("");
    expect(cursorTranscriptTitle('{"role":"user","message":{"content":[{"type":"te')).toBe("");
    expect(cursorTranscriptTitle("")).toBe("");
  });
});

describe("cursorSessionExists", () => {
  it("finds a chat under any project directory — the survivor guard has no cwd to check against", async () => {
    chat(project("some-opaque-slug-abc1234", CWD), "chat-1", "hello");
    expect(cursorSessionExists("chat-1", home)).toBe(true);
    expect(cursorSessionExists("chat-missing", home)).toBe(false);
  });

  it("answers false rather than throwing on a machine with no cursor at all", () => {
    expect(cursorSessionExists("chat-1", path.join(home, "nothing-here"))).toBe(false);
  });
});

describe("cursorSessionExistsForCwd", () => {
  it("resumes a chat only in the directory that recorded it", async () => {
    chat(project("slug-a-111", CWD), "chat-1", "hello");
    chat(project("slug-b-222", OTHER), "chat-2", "hello");
    expect(await cursorSessionExistsForCwd("chat-1", CWD, home)).toBe(true);
    expect(await cursorSessionExistsForCwd("chat-2", CWD, home)).toBe(false);
  });

  it("declines when the project directory records no path — omission, never another directory's chat", async () => {
    chat(project("slug-unattributable-333", null), "chat-3", "hello");
    expect(await cursorSessionExistsForCwd("chat-3", CWD, home)).toBe(false);
  });
});

describe("listCursorSessionsForCwd", () => {
  it("lists only this directory's chats, titled by the first thing the user said", async () => {
    const dir = project("slug-a-111", CWD);
    chat(dir, "chat-1", "<user_query>\nFix the build\n</user_query>");
    chat(project("slug-b-222", OTHER), "chat-2", "Something else");
    const metas = await listCursorSessionsForCwd(CWD, home);
    expect(metas.map((m) => m.id)).toEqual(["chat-1"]);
    expect(metas[0].title).toBe("Fix the build");
    expect(metas[0].mtimeMs).toBeGreaterThan(0);
  });

  it("is empty for a directory cursor has never seen", async () => {
    project("slug-a-111", CWD);
    expect(await listCursorSessionsForCwd(OTHER, home)).toEqual([]);
  });

  it("skips a chat directory that has no transcript yet rather than failing the listing", async () => {
    const dir = project("slug-a-111", CWD);
    chat(dir, "chat-1", "hello");
    mkdirSync(path.join(dir, "agent-transcripts", "chat-empty"), { recursive: true });
    expect((await listCursorSessionsForCwd(CWD, home)).map((m) => m.id)).toEqual(["chat-1"]);
  });
});

describe("more than one project directory for one cwd", () => {
  // Cursor's directory name is a truncated-and-hashed slug, so two can record the same workspace.
  // The first one found is not necessarily the one holding the chats, and an empty duplicate that
  // shadowed a real one made a conversation invisible to BOTH the listing and the resume probe —
  // a cell that quietly starts a new chat instead of resuming (Codex round 2 of #2065).
  it("resumes a chat that lives in the SECOND directory recording this cwd", async () => {
    project("slug-empty-aaa1111", CWD); // an empty duplicate, found first
    chat(project("slug-real-bbb2222", CWD), "chat-1", "hello");
    expect(await cursorSessionExistsForCwd("chat-1", CWD, home)).toBe(true);
  });

  it("lists chats from every directory recording this cwd", async () => {
    chat(project("slug-a-aaa1111", CWD), "chat-1", "first");
    chat(project("slug-b-bbb2222", CWD), "chat-2", "second");
    const ids = (await listCursorSessionsForCwd(CWD, home)).map((m) => m.id);
    expect([...ids].sort()).toEqual(["chat-1", "chat-2"]);
  });

  it("reports one row for a chat id present under two of them", async () => {
    chat(project("slug-a-aaa1111", CWD), "chat-1", "first");
    chat(project("slug-b-bbb2222", CWD), "chat-1", "the same conversation");
    expect((await listCursorSessionsForCwd(CWD, home)).map((m) => m.id)).toEqual(["chat-1"]);
  });

  it("still lists nothing for a directory none of them records", async () => {
    chat(project("slug-a-aaa1111", CWD), "chat-1", "first");
    chat(project("slug-b-bbb2222", CWD), "chat-2", "second");
    expect(await listCursorSessionsForCwd(OTHER, home)).toEqual([]);
  });
});

describe("the listing's limit is the helper's business", () => {
  // Not the route's, because it decides how much I/O happens: every chat is stat'ed to be sorted,
  // but a TITLE is an open and a read, and only the rows that will be SHOWN need one. Reading all
  // of them and slicing afterwards was the first shape, and on a directory with a few hundred
  // chats it was hundreds of opens nobody would see the result of (CodeRabbit on #2065).
  it("returns the newest `limit` chats, and no more", async () => {
    const dir = project("slug-a-aaa1111", CWD);
    for (const n of [1, 2, 3, 4, 5]) chat(dir, `chat-${n}`, `turn ${n}`);
    // mtimes are whatever the filesystem gave them; ask for two and assert the COUNT and that both
    // are real ids, which is what the limit promises without pinning the clock.
    const two = await listCursorSessionsForCwd(CWD, home, 2);
    expect(two).toHaveLength(2);
    for (const meta of two) expect(meta.id).toMatch(/^chat-[1-5]$/);
    expect(await listCursorSessionsForCwd(CWD, home)).toHaveLength(5);
  });

  it("still titles the rows it does return", async () => {
    const dir = project("slug-a-aaa1111", CWD);
    chat(dir, "chat-1", "<user_query>\nthe only one\n</user_query>");
    const [only] = await listCursorSessionsForCwd(CWD, home, 1);
    expect(only.title).toBe("the only one");
  });
});
