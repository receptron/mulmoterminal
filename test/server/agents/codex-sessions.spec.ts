import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCodexRolloutHead, listCodexSessions, codexRolloutExists } from "../../../server/agents/../../server/agents/codex-sessions.js";

const UUID_A = "019f251d-001c-7542-b13e-9a627effce52";
const UUID_B = "019db01d-aaa3-7ba2-b597-b29a7fca488f";

const metaLine = (id: string, cwd: string | null): string => JSON.stringify({ type: "session_meta", payload: { id, cwd, originator: "codex-tui" } });
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
  function writeSession(id: string, cwd: string, msg: string, mtime: Date): void {
    const dir = dayDir(root);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-07-08T00-00-00-${id}.jsonl`);
    writeFileSync(file, [metaLine(id, cwd), userMsgLine(msg)].join("\n") + "\n");
    utimesSync(file, mtime, mtime);
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
