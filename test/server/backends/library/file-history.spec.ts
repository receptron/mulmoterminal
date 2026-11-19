// @vitest-environment node
// The files a conversation changed (#3330): folding Claude Code's file-history records, and reading
// one kept copy or the file as it is now — bounded, never binary, never outside the session's own copies.
import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { foldFileHistory, isBackupFileName, trackedFileOf } from "../../../../server/backends/library/file-history";
import { readBoundedText, readFileHistory, readKeptCopy } from "../../../../server/backends/library/file-history-read";
import { LIBRARY_FILE_TEXT_MAX } from "../../../../common/libraryFiles";

const backup = (name: string | null, version: number, time = "2026-11-19T05:00:00.000Z", dir = "/w/app/src") => ({
  backupFileName: name,
  version,
  backupTime: time,
  realParentDir: dir,
});
const snapshot = (files: Record<string, unknown>) => ({ type: "file-history-snapshot", snapshot: { trackedFileBackups: files } });
const delta = (trackingPath: string, kept: unknown) => ({ type: "file-history-delta", trackingPath, backup: kept });

describe("foldFileHistory", () => {
  it("joins the delta's first copy to the snapshots' later ones, each version once, in order", () => {
    const files = foldFileHistory([
      delta("src/a.ts", backup("aaaaaaaaaaaaaaaa@v1", 1)),
      snapshot({ "src/a.ts": backup("aaaaaaaaaaaaaaaa@v2", 2, "2026-11-19T06:00:00.000Z") }),
      snapshot({ "src/a.ts": backup("aaaaaaaaaaaaaaaa@v2", 2, "2026-11-19T06:00:00.000Z"), "/abs/b.md": backup(null, 2, undefined, "/abs") }),
      snapshot({ "src/a.ts": backup("aaaaaaaaaaaaaaaa@v3", 3, "2026-11-19T07:00:00.000Z") }),
    ]);
    expect(files.map(trackedFileOf)).toEqual([
      {
        trackingPath: "src/a.ts",
        path: "/w/app/src/a.ts",
        versions: [
          { version: 1, at: Date.parse("2026-11-19T05:00:00.000Z"), exists: true },
          { version: 2, at: Date.parse("2026-11-19T06:00:00.000Z"), exists: true },
          { version: 3, at: Date.parse("2026-11-19T07:00:00.000Z"), exists: true },
        ],
      },
      { trackingPath: "/abs/b.md", path: "/abs/b.md", versions: [{ version: 2, at: Date.parse("2026-11-19T05:00:00.000Z"), exists: false }] },
    ]);
  });

  it("skips what is not a file-history record or not a well-formed copy", () => {
    const files = foldFileHistory([
      null,
      "text",
      { type: "user" },
      snapshot({ "a.ts": { backupFileName: null, version: 0 }, "b.ts": { backupFileName: null, version: 1.5 }, "c.ts": { backupFileName: 7, version: 1 } }),
      delta("d.ts", "nope"),
      { type: "file-history-snapshot", snapshot: null },
    ]);
    expect(files).toEqual([]);
  });

  it("keeps the first copy of a version that a later record repeats", () => {
    const [file] = foldFileHistory([
      snapshot({ "a.ts": backup("aaaaaaaaaaaaaaaa@v2", 2, "2026-11-19T06:00:00.000Z") }),
      snapshot({ "a.ts": backup("bbbbbbbbbbbbbbbb@v2", 2, "2026-11-19T09:00:00.000Z") }),
    ]);
    expect(file?.backups).toEqual([{ version: 2, at: Date.parse("2026-11-19T06:00:00.000Z"), backupFileName: "aaaaaaaaaaaaaaaa@v2" }]);
  });

  it("places a relative file under the conversation's directory when the record names no directory", () => {
    const record = snapshot({ "src/a.ts": { backupFileName: null, version: 2, backupTime: "2026-11-19T05:00:00.000Z" } });
    expect(foldFileHistory([record], "/w/app")[0]?.path).toBe(path.resolve("/w/app", "src/a.ts"));
    expect(foldFileHistory([record], "relative")[0]?.path).toBeNull();
  });

  it("has no disk path for a relative file whose directory was not recorded, and no time for an unreadable one", () => {
    const [file] = foldFileHistory([snapshot({ "a.ts": { backupFileName: null, version: 2, backupTime: "never", realParentDir: "relative/dir" } })]);
    expect(file?.path).toBeNull();
    expect(file?.backups[0]?.at).toBeNull();
  });
});

describe("isBackupFileName", () => {
  it.each([
    ["09baa5dd69711a41@v1", true],
    ["09baa5dd69711a41@v12", true],
    ["09baa5dd69711a41@v0", false],
    ["../09baa5dd69711a41@v1", false],
    ["09BAA5DD69711A41@v1", false],
    ["09baa5dd69711a4@v1", false],
    ["09baa5dd69711a41", false],
    ["09baa5dd69711a41@v1/x", false],
  ])("%s → %s", (name, ok) => {
    expect(isBackupFileName(name)).toBe(ok);
  });
});

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const scratch = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-file-history-"));
  dirs.push(dir);
  return dir;
};

describe("reading", () => {
  it("reads text, and refuses a binary file, one past the cap, a directory and a missing one", async () => {
    const dir = scratch();
    writeFileSync(path.join(dir, "ok.txt"), "hello");
    writeFileSync(path.join(dir, "bin"), Buffer.from([104, 0, 105]));
    writeFileSync(path.join(dir, "edge.txt"), "x".repeat(LIBRARY_FILE_TEXT_MAX));
    writeFileSync(path.join(dir, "big.txt"), "x".repeat(LIBRARY_FILE_TEXT_MAX + 1));
    expect(await readBoundedText(path.join(dir, "ok.txt"))).toEqual({ text: "hello" });
    expect(await readBoundedText(path.join(dir, "bin"))).toEqual({ text: null, reason: "binary" });
    expect((await readBoundedText(path.join(dir, "edge.txt"))).text).toHaveLength(LIBRARY_FILE_TEXT_MAX);
    expect(await readBoundedText(path.join(dir, "big.txt"))).toEqual({ text: null, reason: "too-large" });
    expect(await readBoundedText(dir)).toEqual({ text: null, reason: "unreadable" });
    expect(await readBoundedText(path.join(dir, "gone"))).toEqual({ text: null, reason: "absent" });
  });

  it.skipIf(process.platform === "win32")("does not read through a link, either side", async () => {
    const root = scratch();
    writeFileSync(path.join(root, "untracked.txt"), "never shown");
    symlinkSync(path.join(root, "untracked.txt"), path.join(root, "tracked.ts"));
    expect(await readBoundedText(path.join(root, "tracked.ts"))).toEqual({ text: null, reason: "unreadable" });
    mkdirSync(path.join(root, "s1"));
    symlinkSync(path.join(root, "untracked.txt"), path.join(root, "s1", "aaaaaaaaaaaaaaaa@v1"));
    expect(await readKeptCopy(root, "s1", "aaaaaaaaaaaaaaaa@v1")).toEqual({ text: null, reason: "unreadable" });
  });

  it("reads a kept copy only by a well-formed name in the session's own directory", async () => {
    const root = scratch();
    mkdirSync(path.join(root, "s1"));
    writeFileSync(path.join(root, "s1", "aaaaaaaaaaaaaaaa@v1"), "before");
    writeFileSync(path.join(root, "secret"), "not a copy");
    expect(await readKeptCopy(root, "s1", "aaaaaaaaaaaaaaaa@v1")).toEqual({ text: "before" });
    expect(await readKeptCopy(root, "s1", null)).toEqual({ text: null, reason: "absent" });
    expect(await readKeptCopy(root, "s1", "../secret")).toEqual({ text: null, reason: "unreadable" });
    // Named but gone (cleaned up): not "the file did not exist", which would draw it all as created.
    expect(await readKeptCopy(root, "s1", "bbbbbbbbbbbbbbbb@v1")).toEqual({ text: null, reason: "unreadable" });
  });

  it("shares one read between requests that arrive together, and keeps no failed one", async () => {
    const dir = scratch();
    const transcript = path.join(dir, "s2.jsonl");
    writeFileSync(transcript, `${JSON.stringify(delta("a.ts", backup(null, 1)))}\n`);
    const [first, second] = await Promise.all([readFileHistory(transcript), readFileHistory(transcript)]);
    expect(first).toBe(second);
    unlinkSync(transcript);
    await expect(readFileHistory(transcript)).rejects.toThrow();
  });

  // The stamp is size and mtime, which a permission change leaves alone: a kept failure would be
  // answered again once the file is readable.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("reads again after a read that failed", async () => {
    const dir = scratch();
    const transcript = path.join(dir, "s3.jsonl");
    writeFileSync(transcript, `${JSON.stringify(delta("a.ts", backup(null, 1)))}\n`);
    chmodSync(transcript, 0o000);
    await expect(readFileHistory(transcript)).rejects.toThrow();
    chmodSync(transcript, 0o600);
    expect((await readFileHistory(transcript)).map((file) => file.trackingPath)).toEqual(["a.ts"]);
  });

  it("reads a transcript's file history again only when the transcript changes", async () => {
    const dir = scratch();
    const transcript = path.join(dir, "s1.jsonl");
    const line = (record: unknown): string => `${JSON.stringify(record)}\n`;
    writeFileSync(transcript, line({ type: "user", message: { content: "file-history- in a prompt" } }) + line(delta("a.ts", backup(null, 1))) + "{not json\n");
    expect((await readFileHistory(transcript)).map((file) => file.trackingPath)).toEqual(["a.ts"]);
    writeFileSync(transcript, line(delta("a.ts", backup(null, 1))) + line(delta("b.ts", backup(null, 1))));
    expect((await readFileHistory(transcript)).map((file) => file.trackingPath)).toEqual(["a.ts", "b.ts"]);
  });
});
