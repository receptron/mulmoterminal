// @vitest-environment node
// The routes for the files a Library conversation changed (#3330): what they answer, and that a request
// can reach only what the conversation's transcript tracked.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall } from "../../helpers/routeCall";
import { mountLibraryRoutes } from "../../../server/routes/library-routes";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A session `s1` that kept `src/a.ts` at v1 and v2, created `new.md`, and lives in `work`. */
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "mt-file-routes-"));
  dirs.push(root);
  const work = path.join(root, "work", "src");
  const history = path.join(root, "file-history");
  mkdirSync(work, { recursive: true });
  mkdirSync(path.join(history, "s1"), { recursive: true });
  writeFileSync(path.join(history, "s1", "aaaaaaaaaaaaaaaa@v1"), "one\n");
  writeFileSync(path.join(history, "s1", "aaaaaaaaaaaaaaaa@v2"), "two\n");
  writeFileSync(path.join(work, "a.ts"), "three\n");
  writeFileSync(path.join(root, "secret.txt"), "not tracked");
  const kept = (name: string | null, version: number, dir: string) => ({
    backupFileName: name,
    version,
    backupTime: "2026-11-19T05:00:00.000Z",
    realParentDir: dir,
  });
  const transcript = path.join(root, "s1.jsonl");
  writeFileSync(
    transcript,
    [
      { type: "file-history-delta", trackingPath: "src/a.ts", backup: kept("aaaaaaaaaaaaaaaa@v1", 1, work) },
      { type: "file-history-snapshot", snapshot: { trackedFileBackups: { "src/a.ts": kept("aaaaaaaaaaaaaaaa@v2", 2, work), "new.md": kept(null, 2, root) } } },
    ]
      .map((record) => `${JSON.stringify(record)}\n`)
      .join(""),
  );
  const asked: unknown[][] = [];
  const app = express();
  mountLibraryRoutes(app, {
    call: (method, args) => (asked.push([method, ...args]), Promise.resolve(args[0] === "s1" ? transcript : null)),
    fileHistoryRoot: history,
  });
  return { call: routeCall(app), asked, root };
}

describe("/api/library/conversations/:id/files", () => {
  it("lists the files the conversation kept, in the project asked for", async () => {
    const { call, asked } = setup();
    const files = (await call("/api/library/conversations/s1/files?cwd=%2Fw")).body.files;
    expect(files).toEqual([
      expect.objectContaining({
        trackingPath: "src/a.ts",
        versions: [expect.objectContaining({ version: 1, exists: true }), expect.objectContaining({ version: 2, exists: true })],
      }),
      expect.objectContaining({ trackingPath: "new.md", versions: [expect.objectContaining({ version: 2, exists: false })] }),
    ]);
    expect(asked).toEqual([["transcriptPath", "s1", "/w"]]);
  });

  it("answers 404 for an unknown conversation and 400 for an id that is not one", async () => {
    const { call } = setup();
    expect((await call("/api/library/conversations/nope/files")).status).toBe(404);
    expect((await call("/api/library/conversations/..%2Fx/files")).status).toBe(400);
  });
});

describe("/api/library/conversations/:id/file", () => {
  it("answers each kept version, and the file as it is now", async () => {
    const { call } = setup();
    const version = async (v: string) => (await call(`/api/library/conversations/s1/file?file=src%2Fa.ts&version=${v}`)).body;
    expect(await version("1")).toEqual({ text: "one\n" });
    expect(await version("2")).toEqual({ text: "two\n" });
    expect(await version("now")).toEqual({ text: "three\n" });
    expect((await call("/api/library/conversations/s1/file?file=new.md&version=2")).body).toEqual({ text: null, reason: "absent" });
  });

  it("reaches nothing the conversation did not track", async () => {
    const { call, root } = setup();
    const status = async (query: string) => (await call(`/api/library/conversations/s1/file?${query}`)).status;
    expect(await status(`file=${encodeURIComponent(path.join(root, "secret.txt"))}&version=now`)).toBe(404);
    expect(await status("file=..%2Fsecret.txt&version=now")).toBe(404);
    expect(await status("file=src%2Fa.ts&version=7")).toBe(404);
    expect(await status("file=src%2Fa.ts&version=0")).toBe(400);
    expect(await status("file=src%2Fa.ts&version=..%2F..%2Fsecret")).toBe(400);
    expect(await status("version=now")).toBe(400);
  });
});
