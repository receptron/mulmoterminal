import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseSessionMetaLine,
  readSessionMeta,
  listRecentRollouts,
  snapshotSessions,
  pickFreshSession,
  watchForCodexSession,
} from "../../../server/agents/codex-session.js";

const UUID_A = "019f251d-001c-7542-b13e-9a627effce52";
const UUID_B = "019db01d-aaa3-7ba2-b597-b29a7fca488f";

const pad = (n: number): string => String(n).padStart(2, "0");
const todayDir = (root: string): string => {
  const d = new Date();
  return path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
};
const metaLine = (id: string, cwd: string | null): string =>
  JSON.stringify({ timestamp: "t", type: "session_meta", payload: { id, cwd, originator: "codex-tui", source: "cli" } });

function writeRollout(root: string, id: string, cwd: string | null, extraLines: string[] = []): string {
  const dir = todayDir(root);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-x-${id}.jsonl`);
  writeFileSync(file, [metaLine(id, cwd), ...extraLines].join("\n") + "\n");
  return file;
}

describe("parseSessionMetaLine", () => {
  it("extracts id + cwd from a session_meta line", () => {
    expect(parseSessionMetaLine(metaLine(UUID_A, "/work"))).toEqual({ id: UUID_A, cwd: "/work" });
  });
  it("returns null for a non-session_meta record", () => {
    expect(parseSessionMetaLine(JSON.stringify({ type: "message", payload: { id: UUID_A } }))).toBeNull();
  });
  it("returns null for invalid JSON", () => {
    expect(parseSessionMetaLine("not json{")).toBeNull();
  });
  it("returns null when the id is not a uuid", () => {
    expect(parseSessionMetaLine(metaLine("nope", "/work"))).toBeNull();
  });
  it("keeps cwd null when absent", () => {
    expect(parseSessionMetaLine(JSON.stringify({ type: "session_meta", payload: { id: UUID_A } }))).toEqual({ id: UUID_A, cwd: null });
  });
});

describe("codex-session fs helpers", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the meta from the first line of a multi-line rollout", () => {
    const file = writeRollout(root, UUID_A, "/work", ['{"type":"message"}', '{"type":"message"}']);
    expect(readSessionMeta(file)).toEqual({ id: UUID_A, cwd: "/work" });
  });
  it("returns null reading a missing file", () => {
    expect(readSessionMeta(path.join(root, "nope.jsonl"))).toBeNull();
  });
  it("lists rollouts under today's day dir", () => {
    writeRollout(root, UUID_A, "/work");
    expect(listRecentRollouts(root)).toHaveLength(1);
  });
});

describe("pickFreshSession", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns null when nothing appeared after the snapshot", () => {
    writeRollout(root, UUID_A, "/a");
    const before = snapshotSessions(root);
    expect(pickFreshSession(root, before, null)).toBeNull();
  });
  it("attributes a single fresh rollout (unambiguous)", () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/a");
    expect(pickFreshSession(root, before, "/anything")?.id).toBe(UUID_A);
  });
  it("attributes the unique cwd match when several are fresh", () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/a");
    writeRollout(root, UUID_B, "/b");
    expect(pickFreshSession(root, before, "/b")?.id).toBe(UUID_B);
  });
  it("refuses to guess when several fresh rollouts share the cwd", () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/same");
    writeRollout(root, UUID_B, "/same");
    expect(pickFreshSession(root, before, "/same")).toBeNull();
  });
  it("refuses to guess when several are fresh and none matches the cwd", () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/a");
    writeRollout(root, UUID_B, "/b");
    expect(pickFreshSession(root, before, "/other")).toBeNull();
  });
  it("skips a rollout already claimed by another session", () => {
    const before = snapshotSessions(root);
    const a = writeRollout(root, UUID_A, "/same");
    writeRollout(root, UUID_B, "/same");
    expect(pickFreshSession(root, before, "/same", new Set([a]))?.id).toBe(UUID_B);
  });
  it("returns null when the only fresh rollout is already claimed", () => {
    const before = snapshotSessions(root);
    const a = writeRollout(root, UUID_A, "/a");
    expect(pickFreshSession(root, before, null, new Set([a]))).toBeNull();
  });
});

describe("watchForCodexSession", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves the session once its rollout is present", async () => {
    const before = snapshotSessions(root);
    writeRollout(root, UUID_A, "/work");
    const found = await watchForCodexSession(root, before, { pollMs: 10, maxWaitMs: 500 });
    expect(found?.id).toBe(UUID_A);
    expect(found?.cwd).toBe("/work");
  });
  it("stops immediately when cancelled", async () => {
    const before = snapshotSessions(root);
    const found = await watchForCodexSession(root, before, { pollMs: 10, maxWaitMs: 5000, isCancelled: () => true });
    expect(found).toBeNull();
  });
  it("resolves null when nothing appears before the timeout", async () => {
    const before = snapshotSessions(root);
    const found = await watchForCodexSession(root, before, { pollMs: 10, maxWaitMs: 40 });
    expect(found).toBeNull();
  });
});
