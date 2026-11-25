// @vitest-environment node
// What makes a set of test tasks the same set (#3491): `cases.json` and the files the tasks start from, read off
// a real folder, with a set that has none keeping the hash its runs were recorded with.
import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setHash, type StartingFile } from "../../../../server/backends/skillEval/setHash";
import { readEvalSet, textHash } from "../../../../server/backends/skillEval/evalStore";

const CASES = JSON.stringify({
  version: 1,
  skill: "weekly",
  cases: [{ id: "plain", title: "Plain", kind: "use", prompt: "Write the report", check: { type: "command", command: "true" } }],
});
const file = (filePath: string, digest = "d", kind: StartingFile["kind"] = "file"): StartingFile => ({ path: filePath, kind, digest });

describe("setHash", () => {
  it("is the hash of cases.json alone when no task has starting files", () => {
    expect(setHash(CASES, [])).toBe(textHash(CASES));
  });

  it("changes with a starting file's content, path or kind, and with one added or removed", () => {
    const base = setHash(CASES, [file("a/notes.md")]);
    expect(base).not.toBe(textHash(CASES));
    expect(setHash(CASES, [file("a/notes.md", "other")])).not.toBe(base);
    expect(setHash(CASES, [file("b/notes.md")])).not.toBe(base);
    expect(setHash(CASES, [file("a/notes.md", "d", "link")])).not.toBe(base);
    expect(setHash(CASES, [file("a/notes.md"), file("a/more.md")])).not.toBe(base);
    expect(setHash(`${CASES} `, [file("a/notes.md")])).not.toBe(base);
  });

  it("does not depend on the order the files were found in", () => {
    expect(setHash(CASES, [file("a/x"), file("b/y")])).toBe(setHash(CASES, [file("b/y"), file("a/x")]));
  });

  it("does not let a path run into its digest", () => {
    expect(setHash(CASES, [file("a", "bc")])).not.toBe(setHash(CASES, [file("ab", "c")]));
  });
});

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function evalDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-set-hash-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "cases.json"), CASES);
  return dir;
}
const hashOf = async (dir: string): Promise<string | null> => {
  const read = await readEvalSet(dir, "weekly");
  return read.kind === "ok" ? read.hash : null;
};

describe("reading a set's hash off its folder", () => {
  it("keeps the hash of cases.json alone with no files folder, or an empty one", async () => {
    const dir = evalDir();
    expect(await hashOf(dir)).toBe(textHash(CASES));
    mkdirSync(path.join(dir, "files", "plain"), { recursive: true });
    expect(await hashOf(dir)).toBe(textHash(CASES));
  });

  it("changes when a task's starting file is edited, added or moved, nested folders included", async () => {
    const dir = evalDir();
    mkdirSync(path.join(dir, "files", "plain", "notes"), { recursive: true });
    writeFileSync(path.join(dir, "files", "plain", "notes", "week.md"), "Monday: met the team");
    const first = await hashOf(dir);
    expect(first).not.toBe(textHash(CASES));
    writeFileSync(path.join(dir, "files", "plain", "notes", "week.md"), "Monday: met the client");
    const edited = await hashOf(dir);
    expect(edited).not.toBe(first);
    writeFileSync(path.join(dir, "files", "plain", "extra.md"), "");
    expect(await hashOf(dir)).not.toBe(edited);
    expect(await hashOf(dir)).toBe(await hashOf(dir));
  });

  it.skipIf(process.platform === "win32")("counts a link as where it points, without reading what is there", async () => {
    const dir = evalDir();
    mkdirSync(path.join(dir, "files", "plain"), { recursive: true });
    const target = path.join(evalDir(), "outside.md");
    writeFileSync(target, "one");
    symlinkSync(target, path.join(dir, "files", "plain", "linked.md"));
    const linked = await hashOf(dir);
    writeFileSync(target, "two");
    expect(await hashOf(dir)).toBe(linked);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("refuses a set whose starting files cannot be read", async () => {
    const dir = evalDir();
    mkdirSync(path.join(dir, "files", "plain"), { recursive: true });
    const locked = path.join(dir, "files", "plain", "locked.md");
    writeFileSync(locked, "x");
    chmodSync(locked, 0o000);
    const read = await readEvalSet(dir, "weekly");
    chmodSync(locked, 0o600);
    expect(read).toMatchObject({ kind: "invalid" });
    expect(read.kind === "invalid" ? read.error : "").toContain("could not be read");
  });
});
