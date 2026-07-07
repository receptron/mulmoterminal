import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSessionMetaLine, readSessionMeta, listRecentRollouts, snapshotSessions, findNewRollout, discoverCodexSession } from "./codex-session.js";

const UUID_A = "019f251d-001c-7542-b13e-9a627effce52";
const UUID_B = "019db01d-aaa3-7ba2-b597-b29a7fca488f";

const pad = (n: number): string => String(n).padStart(2, "0");
const dayPath = (root: string, d: Date): string => path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
const metaLine = (id: string, cwd: string | null): string =>
  JSON.stringify({ timestamp: "2026-07-08T00:00:00Z", type: "session_meta", payload: { id, cwd, originator: "codex-tui", source: "cli" } });

function writeRollout(dir: string, id: string, cwd: string | null, extraLines: string[] = []): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-07-08T00-00-00-${id}.jsonl`);
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

describe("readSessionMeta", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the meta from the first line of a multi-line rollout", () => {
    const file = writeRollout(dayPath(root, new Date(2026, 6, 8)), UUID_A, "/work", ['{"type":"message"}', '{"type":"message"}']);
    expect(readSessionMeta(file)).toEqual({ id: UUID_A, cwd: "/work" });
  });
  it("returns null for a missing file", () => {
    expect(readSessionMeta(path.join(root, "nope.jsonl"))).toBeNull();
  });
});

describe("snapshot / findNewRollout", () => {
  let root: string;
  const now = new Date(2026, 6, 8, 12, 0, 0);
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists rollouts under today's day dir", () => {
    writeRollout(dayPath(root, now), UUID_A, "/work");
    expect(listRecentRollouts(root, now)).toHaveLength(1);
  });
  it("finds the file that appeared after the snapshot", () => {
    writeRollout(dayPath(root, now), UUID_A, "/work");
    const before = snapshotSessions(root, now);
    const fresh = writeRollout(dayPath(root, now), UUID_B, "/work");
    expect(findNewRollout(root, before, now)).toBe(fresh);
  });
  it("returns null when nothing new appeared", () => {
    writeRollout(dayPath(root, now), UUID_A, "/work");
    const before = snapshotSessions(root, now);
    expect(findNewRollout(root, before, now)).toBeNull();
  });
  it("picks the newest by mtime when several are fresh", () => {
    const older = writeRollout(dayPath(root, now), UUID_A, "/work");
    const newer = writeRollout(dayPath(root, now), UUID_B, "/work");
    utimesSync(older, new Date(2026, 6, 8, 10), new Date(2026, 6, 8, 10));
    utimesSync(newer, new Date(2026, 6, 8, 11), new Date(2026, 6, 8, 11));
    expect(findNewRollout(root, new Set(), now)).toBe(newer);
  });
});

describe("discoverCodexSession", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "mt-codex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the id of a rollout that appears after the snapshot", async () => {
    const before = snapshotSessions(root);
    writeRollout(dayPath(root, new Date()), UUID_A, "/work");
    const found = await discoverCodexSession(root, before, { timeoutMs: 500, intervalMs: 10 });
    expect(found?.id).toBe(UUID_A);
    expect(found?.cwd).toBe("/work");
  });
  it("resolves null when no new session appears before the timeout", async () => {
    const before = snapshotSessions(root);
    const found = await discoverCodexSession(root, before, { timeoutMs: 60, intervalMs: 10 });
    expect(found).toBeNull();
  });
});
