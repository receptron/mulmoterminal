// @vitest-environment node
// An index pass over real files on disk (#3328): the first pass, a pass that reads only what was
// appended, a half-written last line, a file that shrank or went away, temp projects, subagents,
// the prompt history, and a pass that is not this process's to run.
import { describe, it, expect, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareLibraryStore, readFileMark, takeLease } from "../../../../server/backends/library/index-store";
import { conversationOfRow, findConversation, listConversations } from "../../../../server/backends/library/index-queries";
import { searchLibrary } from "../../../../server/backends/library/library-search";
import { runIndexPass, type IndexPassDeps } from "../../../../server/backends/library/indexer";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const line = (record: Record<string, unknown>): string => `${JSON.stringify(record)}\n`;
const prompt = (text: string, cwd = "/w/app"): string => line({ type: "user", cwd, timestamp: "2026-11-18T08:00:00.000Z", message: { content: text } });
const reply = (text: string): string => line({ type: "assistant", message: { content: [{ type: "text", text }] } });

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "mt-library-"));
  dirs.push(root);
  const projects = path.join(root, "projects");
  mkdirSync(path.join(projects, "-w-app"), { recursive: true });
  const db = new DatabaseSync(":memory:");
  prepareLibraryStore(db);
  const deps: IndexPassDeps = {
    db,
    projectsRoot: projects,
    historyFile: path.join(root, "history.jsonl"),
    temporaryRoots: ["/tmp"],
    owner: "me",
    now_ms: () => 1000,
  };
  const transcript = (name: string, body: string, project = "-w-app"): string => {
    mkdirSync(path.join(projects, project, path.dirname(name)), { recursive: true });
    const file = path.join(projects, project, `${name}.jsonl`);
    writeFileSync(file, body);
    return file;
  };
  return { db, deps, transcript, ids: () => listConversations(db, { includeTemporary: true, includeSidechains: true }, 0, 50).map((row) => row.id) };
}

const hits = (db: DatabaseSync, query: string): string[] => searchLibrary(db, query, { includeSidechains: true }, 50).map((hit) => hit.conversation.id);

describe("runIndexPass", () => {
  it("indexes every transcript on the first pass", async () => {
    const { db, deps, transcript, ids } = setup();
    transcript("s1", prompt("subtitles please") + reply("burning them") + line({ type: "ai-title", aiTitle: "Subtitles" }));
    transcript("s2", prompt("another"), "-w-other");
    expect(await runIndexPass(deps)).toBe(true);
    expect(ids().sort()).toEqual(["s1", "s2"]);
    expect(conversationOfRow(findConversation(db, "s1") ?? {})).toMatchObject({ title: "Subtitles", cwd: "/w/app", userTurns: 1 });
    expect(hits(db, "burning")).toEqual(["s1"]);
  });

  it("reads only what was appended on the next pass", async () => {
    const { db, deps, transcript } = setup();
    const file = transcript("s1", line({ type: "ai-title", aiTitle: "AAAA" }) + prompt("first"));
    await runIndexPass(deps);
    // Rewrite the already-read title in place (same length), then append. A pass that re-read the
    // file would pick up "BBBB"; one that resumed never sees it.
    writeFileSync(file, readFileSync(file, "utf8").replace("AAAA", "BBBB"));
    appendFileSync(file, prompt("second") + reply("appended reply"));
    await runIndexPass(deps);
    expect(conversationOfRow(findConversation(db, "s1") ?? {})).toMatchObject({ title: "AAAA", userTurns: 2 });
    expect(hits(db, "appended")).toEqual(["s1"]);
    expect(hits(db, "first")).toEqual(["s1"]);
    expect(readFileMark(db, file)?.scannedTo).toBe(statSync(file).size);
  });

  it("does not read a file again when nothing changed", async () => {
    const { db, deps, transcript } = setup();
    transcript("s1", prompt("only once"));
    await runIndexPass(deps);
    await runIndexPass(deps);
    expect(Number(db.prepare("select count(*) as n from turns").get()?.n)).toBe(1);
  });

  it("leaves a half-written last line for the pass that finds it finished", async () => {
    const { db, deps, transcript } = setup();
    const whole = reply("finished later");
    const file = transcript("s1", prompt("start") + whole.slice(0, 20));
    await runIndexPass(deps);
    expect(hits(db, "finished later")).toEqual([]);
    appendFileSync(file, whole.slice(20));
    await runIndexPass(deps);
    expect(hits(db, "finished later")).toEqual(["s1"]);
  });

  it("reads a file again from the start when it shrank or was rewritten at the same size", async () => {
    const { db, deps, transcript } = setup();
    const file = transcript("s1", prompt("long original text"));
    await runIndexPass(deps);
    writeFileSync(file, prompt("short"));
    await runIndexPass(deps);
    expect(hits(db, "original")).toEqual([]);
    expect(hits(db, "short")).toEqual(["s1"]);
    writeFileSync(file, prompt("shxrt"));
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    await runIndexPass(deps);
    expect(hits(db, "shxrt")).toEqual(["s1"]);
    expect(hits(db, "short")).toEqual([]);
  });

  it("drops a transcript that was deleted", async () => {
    const { deps, transcript, ids } = setup();
    const file = transcript("s1", prompt("a"));
    transcript("s2", prompt("b"));
    await runIndexPass(deps);
    rmSync(file);
    await runIndexPass(deps);
    expect(ids()).toEqual(["s2"]);
  });

  // A lock held by another server, or a read that broke off, is not a deleted conversation.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("keeps a conversation whose file could not be read this pass", async () => {
    const { deps, transcript, ids } = setup();
    const file = transcript("s1", prompt("still here"));
    await runIndexPass(deps);
    appendFileSync(file, prompt("more"));
    chmodSync(file, 0o000);
    try {
      await runIndexPass(deps);
    } finally {
      chmodSync(file, 0o600);
    }
    expect(ids()).toEqual(["s1"]);
  });

  it("keeps a temp project's summary but not its text, and links a subagent to its parent", async () => {
    const { db, deps, transcript } = setup();
    transcript("t1", prompt("fixture words", "/tmp/fixture"), "-tmp-fixture");
    transcript("s1/subagents/agent-1", line({ type: "user", isSidechain: true, message: { content: "subagent words" } }));
    await runIndexPass(deps);
    expect(conversationOfRow(findConversation(db, "t1") ?? {})).toMatchObject({ isTemporary: true });
    expect(hits(db, "fixture words")).toEqual([]);
    expect(conversationOfRow(findConversation(db, "agent-1") ?? {})).toMatchObject({ parentId: "s1", isSidechain: true });
    expect(hits(db, "subagent words")).toEqual(["agent-1"]);
  });

  it("searches the prompt history, and catches up on what was appended to it", async () => {
    const { db, deps, transcript } = setup();
    transcript("s1", prompt("in the transcript"));
    writeFileSync(deps.historyFile, line({ display: "typed while running", sessionId: "s1", timestamp: 5 }) + line({ display: "no session" }));
    await runIndexPass(deps);
    expect(hits(db, "while running")).toEqual(["s1"]);
    appendFileSync(deps.historyFile, line({ display: "typed later", sessionId: "s1", timestamp: 6 }));
    await runIndexPass(deps);
    expect(hits(db, "typed later")).toEqual(["s1"]);
    expect(Number(db.prepare("select count(*) as n from turns where role = 'prompt'").get()?.n)).toBe(2);
  });

  it("builds the same index again from nothing", async () => {
    const first = setup();
    first.transcript("s1", prompt("rebuild me") + reply("again"));
    await runIndexPass(first.deps);
    const db = new DatabaseSync(":memory:");
    prepareLibraryStore(db);
    await runIndexPass({ ...first.deps, db });
    expect(listConversations(db, {}, 0, 10).map(conversationOfRow)).toEqual(listConversations(first.db, {}, 0, 10).map(conversationOfRow));
    expect(hits(db, "rebuild")).toEqual(["s1"]);
  });

  it("does nothing while another process holds the lease", async () => {
    const { db, deps, transcript, ids } = setup();
    transcript("s1", prompt("a"));
    takeLease(db, "someone-else", 1000, 60_000);
    expect(await runIndexPass(deps)).toBe(false);
    expect(ids()).toEqual([]);
  });

  it("answers an empty index for a projects root that does not exist", async () => {
    const { deps, ids } = setup();
    expect(await runIndexPass({ ...deps, projectsRoot: path.join(deps.projectsRoot, "absent") })).toBe(true);
    expect(ids()).toEqual([]);
  });
});
