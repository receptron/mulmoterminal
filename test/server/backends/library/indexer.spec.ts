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
import {
  conversationOfRow,
  findConversation,
  listConversations,
  memorySource,
  memorySourceQuery,
  prCreators,
  prCreatorsQuery,
  retrospectiveRows,
  retrospectiveSpendInputs,
  skillUsage,
  skillUsageQuery,
  skillConversations,
  skillConversationsQuery,
} from "../../../../server/backends/library/index-queries";
import { retrospective } from "../../../../server/backends/library/retrospective";
import { splitSpend } from "../../../../server/backends/library/spend-split";
import { searchLibrary } from "../../../../server/backends/library/library-search";
import { runIndexPass, type IndexPassDeps } from "../../../../server/backends/library/indexer";
import { HEAD_BYTES } from "../../../../server/backends/library/opened-file";
import { SCAN_BATCH_ITEMS } from "../../../../server/backends/library/scan-batches";

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

  it("finds the copy of a session in the project asked for, else the newest", async () => {
    const { db, deps, transcript } = setup();
    const later = line({ type: "user", cwd: "/w/other", timestamp: "2026-11-19T08:00:00.000Z", message: { content: "moved" } });
    transcript("s1", prompt("first here"));
    transcript("s1", later, "-w-other"); // the same session id, copied into another project and run on
    await runIndexPass(deps);
    expect(conversationOfRow(findConversation(db, "s1") ?? {}).cwd).toBe("/w/other");
    expect(conversationOfRow(findConversation(db, "s1", "/w/app") ?? {}).cwd).toBe("/w/app");
    expect(conversationOfRow(findConversation(db, "s1", "/w/nowhere") ?? {}).cwd).toBe("/w/other");
  });

  it("names the conversation that made each PR asked about: the earliest begun that recorded it", async () => {
    const { db, deps, transcript } = setup();
    const at = (day: number, text: string): string =>
      line({ type: "user", cwd: "/w/app", timestamp: `2026-11-${String(day)}T08:00:00.000Z`, message: { content: text } });
    const prLink = (number: number, repository: string): string =>
      line({ type: "pr-link", prNumber: number, prUrl: `https://github.com/${repository}/pull/${String(number)}`, prRepository: repository });
    transcript("later", at(18, "came back to it") + prLink(5, "receptron/mulmoterminal") + prLink(6, "receptron/mulmoterminal"));
    transcript("opener", at(10, "opened it") + prLink(5, "Receptron/MulmoTerminal"));
    transcript("elsewhere", at(9, "another repo") + prLink(5, "receptron/other") + prLink(6, "receptron/other"));
    transcript("none", at(12, "no PR"));
    await runIndexPass(deps);
    const creators = (numbers: number[]): [number, string][] =>
      prCreators(db, "receptron/mulmoterminal", numbers).map((row) => [Number(row.pr_number), conversationOfRow(row).id]);
    expect(creators([5, 6, 7])).toEqual([
      [5, "opener"],
      [6, "later"],
    ]);
    expect(creators([6])).toEqual([[6, "later"]]);
    expect(creators([])).toEqual([]);
  });

  it("passes over a run the Library does not list, even when it recorded the PR first", async () => {
    const { db, deps, transcript } = setup();
    const link = line({ type: "pr-link", prNumber: 9, prUrl: "https://github.com/o/r/pull/9", prRepository: "o/r" });
    const opened = (day: number, entrypoint: string): string =>
      line({ type: "user", cwd: "/w/app", entrypoint, timestamp: `2026-11-${String(day)}T08:00:00.000Z`, message: { content: "x" } });
    transcript("scripted", opened(10, "sdk-cli") + link);
    transcript("by-hand", opened(11, "cli") + link);
    await runIndexPass(deps);
    expect(prCreators(db, "o/r", [9]).map((row) => conversationOfRow(row).id)).toEqual(["by-hand"]);
  });

  it("reads only the conversations that recorded a PR, through the partial index", () => {
    const { db } = setup();
    const query = prCreatorsQuery("o/r", [1]);
    const plan = db
      .prepare(`explain query plan ${query.sql}`)
      .all(...query.params)
      .map((row) => String(row.detail));
    expect(plan.join("\n")).toContain("USING INDEX conversations_with_prs");
  });

  it("finds the conversation that last wrote a memory, of those the Library lists, and follows what is appended", async () => {
    const { db, deps, transcript } = setup();
    const opened = (day: number, entrypoint = "cli"): string =>
      line({ type: "user", cwd: "/w/app", entrypoint, timestamp: `2026-11-${String(day)}T08:00:00.000Z`, message: { content: "x" } });
    const writes = (file: string, tool = "Write"): string =>
      line({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t", name: tool, input: { file_path: `/h/.claude/projects/-w-app/memory/${file}` } }] },
      });
    transcript("early", opened(10) + writes("a.md"));
    const late = transcript("late", opened(12) + writes("a.md", "Edit"));
    transcript("scripted", opened(14, "sdk-cli") + writes("a.md"));
    const elsewhere = line({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t", name: "Write", input: { file_path: "/tmp/projects/-w-app/memory/c.md" } }] },
    });
    transcript("lookalike", opened(13) + elsewhere);
    await runIndexPass(deps);
    const source = (file: string) => memorySource(db, `/h/.claude/projects/-w-app/memory/${file}`)?.id ?? null;
    expect(source("a.md")).toBe("late");
    expect([source("b.md"), source("MEMORY.md")]).toEqual([null, null]);
    // A folder elsewhere that only looks like a memory folder is not this one.
    expect(source("c.md")).toBeNull();
    expect(memorySource(db, "/tmp/projects/-w-app/memory/c.md")?.id).toBe("lookalike");
    appendFileSync(late, writes("b.md"));
    await runIndexPass(deps);
    expect(source("b.md")).toBe("late");
  });

  it("looks a memory's writer up through the partial index", () => {
    const { db } = setup();
    const query = memorySourceQuery("/h/.claude/projects/-w-app/memory/a.md");
    const plan = db
      .prepare(`explain query plan ${query.sql}`)
      .all(...query.params)
      .map((row) => String(row.detail));
    expect(plan.join("\n")).toContain("conversations_with_memory");
  });

  describe("skill usage", () => {
    const opened = (day: number, entrypoint = "cli", cwd = "/w/app"): string =>
      line({ type: "user", cwd, entrypoint, timestamp: `2026-11-${String(day)}T08:00:00.000Z`, message: { content: "x" } });
    const ran = (skill: string, day: number): string =>
      line({
        type: "assistant",
        attributionSkill: skill,
        timestamp: `2026-11-${String(day)}T09:00:00.000Z`,
        message: { content: [{ type: "text", text: "ok" }] },
      });

    it("counts each skill once per conversation the Library lists, with when the last of them ended", async () => {
      const { db, deps, transcript } = setup();
      transcript("a", opened(10) + ran("publish", 10) + ran("publish", 10) + ran("tne:route", 10));
      transcript("b", opened(12) + ran("publish", 12));
      transcript("scripted", opened(14, "sdk-cli") + ran("publish", 14));
      transcript("scratch", opened(15, "cli", "/tmp/x") + ran("publish", 15), "-tmp-x");
      transcript("plain", opened(16));
      await runIndexPass(deps);
      expect(skillUsage(db)).toEqual([
        { id: "publish", conversations: 2, lastUsedAt: Date.parse("2026-11-12T09:00:00.000Z") },
        { id: "tne:route", conversations: 1, lastUsedAt: Date.parse("2026-11-10T09:00:00.000Z") },
      ]);
    });

    it("answers nothing when no conversation ran a skill", async () => {
      const { db, deps, transcript } = setup();
      transcript("plain", opened(16));
      await runIndexPass(deps);
      expect(skillUsage(db)).toEqual([]);
    });

    it("reads only the rows that ran one, through the partial index", () => {
      const { db } = setup();
      const query = skillUsageQuery();
      const plan = db
        .prepare(`explain query plan ${query.sql}`)
        .all(...query.params)
        .map((row) => String(row.detail));
      expect(plan.join("\n")).toContain("conversations_with_skills");
    });

    it("answers the conversations that ran a skill, the newest the Library lists first, up to the limit, within a folder when one is given", async () => {
      const { db, deps, transcript } = setup();
      transcript("old", opened(10) + ran("weekly", 10));
      transcript("new", opened(12) + ran("weekly", 12));
      transcript("elsewhere", opened(13, "cli", "/w/other") + ran("weekly", 13), "-w-other");
      transcript("other-skill", opened(14) + ran("weekly-2", 14));
      transcript("scripted", opened(15, "sdk-cli") + ran("weekly", 15));
      await runIndexPass(deps);
      const names = (paths: string[]): string[] => paths.map((file) => path.basename(file, ".jsonl"));
      expect(names(skillConversations(db, "weekly", null, 5))).toEqual(["elsewhere", "new", "old"]);
      expect(names(skillConversations(db, "weekly", "/w/app", 5))).toEqual(["new", "old"]);
      expect(names(skillConversations(db, "weekly", null, 1))).toEqual(["elsewhere"]);
      expect(skillConversations(db, "nobody", null, 5)).toEqual([]);
    });

    it("looks the conversations that ran a skill up through the partial index", () => {
      const { db } = setup();
      const query = skillConversationsQuery("weekly", null, 5);
      const plan = db
        .prepare(`explain query plan ${query.sql}`)
        .all(...query.params)
        .map((row) => String(row.detail));
      expect(plan.join("\n")).toContain("conversations_with_skills");
    });
  });

  describe("what was spent", () => {
    const NOW = Date.parse("2026-11-21T12:00:00");
    const opened = (iso: string): string => line({ type: "user", cwd: "/w/app", entrypoint: "cli", timestamp: iso, message: { content: "x" } });
    const answer = (iso: string, id: string, output: number): string =>
      line({
        type: "assistant",
        timestamp: iso,
        message: { id, model: "claude-opus-5", content: [{ type: "text", text: id }], usage: { output_tokens: output } },
      });
    const cost = (startTime: number, usd: number, output: number): string =>
      line({ type: "cost-state", startTime, totalCostUSD: usd, modelUsage: { "claude-opus-5[1m]": { costUSD: usd, outputTokens: output } } });
    const totalsOf = (db: DatabaseSync) => retrospective(retrospectiveRows(db, 0), splitSpend(retrospectiveSpendInputs(db, 0)), NOW);

    it("adds up to every count's highest cost-state, each share in the week its replies were written", async () => {
      const { db, deps, transcript } = setup();
      const reply1 = answer("2026-11-04T08:00:00", "m1", 100);
      transcript("one", opened("2026-11-04T07:00:00") + reply1 + reply1 + answer("2026-11-12T08:00:00", "m2", 300) + cost(1, 4, 400));
      transcript(
        "two",
        opened("2026-11-19T08:00:00") +
          line({ type: "cost-state", totalCostUSD: 2.5 }) +
          line({ type: "pr-link", prNumber: 4, prUrl: "u4", prRepository: "o/r" }),
      );
      await runIndexPass(deps);
      const after = (file: string, body: string): void => appendFileSync(path.join(deps.projectsRoot, "-w-app", `${file}.jsonl`), body);
      after("one", answer("2026-11-18T08:00:00", "m3", 100) + cost(2, 1, 100)); // Claude Code started counting again
      await runIndexPass(deps);
      const totals = totalsOf(db);
      expect(totals.weeks.slice(-3).map((week) => week.costUsd)).toEqual([1, 3, 1 + 2.5]);
      expect(totals.total).toEqual({ costUsd: 4 + 1 + 2.5, conversations: 2, prs: 1, tokens: { input: 0, output: 500, cacheRead: 0, cacheWrite: 0 } });
      expect(totals.models).toEqual([
        { model: "claude-opus-5", costUsd: 5, tokens: { input: 0, output: 500, cacheRead: 0, cacheWrite: 0 } },
        { model: "", costUsd: 2.5, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      ]);
      expect(conversationOfRow(findConversation(db, "one") ?? {}).costUsd).toBe(5);
      const since_ms = Date.parse("2026-11-09T00:00:00");
      const recent = splitSpend(retrospectiveSpendInputs(db, since_ms)).reduce((sum, share) => sum + share.costUsd, 0);
      expect(recent).toBeCloseTo(3 + 1 + 2.5, 9); // the first week's dollar stays outside, weighed against the whole
    });

    it("keeps one weight per reply however far apart its records are, the newest standing", async () => {
      const { db, deps, transcript } = setup();
      const others = Array.from({ length: 40 }, (_, n) => answer("2026-11-10T09:00:00", `o${String(n)}`, 1)).join("");
      const file = transcript("one", opened("2026-11-10T07:00:00") + answer("2026-11-10T08:00:00", "m1", 10) + others);
      await runIndexPass(deps);
      appendFileSync(file, answer("2026-11-10T08:00:00", "m1", 30));
      await runIndexPass(deps);
      expect(
        db
          .prepare("select weight from replies where id = 'm1'")
          .all()
          .map((row) => row.weight),
      ).toEqual([150]);
    });

    it("counts a transcript read again from the start once", async () => {
      const { db, deps, transcript } = setup();
      const rest = answer("2026-11-10T08:00:00", "m1", 100) + cost(1, 2, 100);
      const file = transcript("one", opened("2026-11-10T07:00:00") + rest);
      await runIndexPass(deps);
      writeFileSync(file, opened("2026-11-10T07:30:00") + rest + opened("2026-11-11T08:00:00"));
      await runIndexPass(deps);
      expect(totalsOf(db).total.costUsd).toBe(2);
      expect(totalsOf(db).weeks.at(-2)?.costUsd).toBe(2);
    });

    it("forgets the replies of a transcript replaced by another", async () => {
      const { db, deps, transcript } = setup();
      const file = transcript("one", opened("2026-11-10T07:00:00") + answer("2026-11-10T08:00:00", "m1", 100));
      await runIndexPass(deps);
      writeFileSync(file, opened("2026-11-12T07:00:00") + answer("2026-11-12T08:00:00", "m2", 100));
      await runIndexPass(deps);
      expect(
        db
          .prepare("select id from replies")
          .all()
          .map((row) => row.id),
      ).toEqual(["m2"]);
    });
  });

  it("does not prefer a copy with no project recorded when no project is asked for", async () => {
    const { db, deps, transcript } = setup();
    transcript("s1", line({ type: "user", timestamp: "2026-11-18T08:00:00.000Z", message: { content: "no cwd" } }));
    transcript("s1", line({ type: "user", cwd: "/w/other", timestamp: "2026-11-19T08:00:00.000Z", message: { content: "newer" } }), "-w-other");
    await runIndexPass(deps);
    expect(conversationOfRow(findConversation(db, "s1") ?? {}).cwd).toBe("/w/other");
    expect(conversationOfRow(findConversation(db, "s1", "/w/app") ?? {}).cwd).toBe("/w/other"); // nothing there: the newest
  });

  it("reads only what was appended on the next pass", async () => {
    const { db, deps, transcript } = setup();
    // The title sits between the bytes that identify the file and the ones where the read stopped,
    // so rewriting it is not detected as a replacement.
    const filler = (word: string): string => prompt(`${word} ${"x".repeat(HEAD_BYTES)}`);
    const file = transcript("s1", filler("first") + line({ type: "ai-title", aiTitle: "AAAA" }) + filler("middle"));
    await runIndexPass(deps);
    // Rewrite the already-read title in place (same length), then append. A pass that re-read the
    // file would pick up "BBBB"; one that resumed never sees it.
    writeFileSync(file, readFileSync(file, "utf8").replace("AAAA", "BBBB"));
    appendFileSync(file, prompt("second") + reply("appended reply"));
    await runIndexPass(deps);
    expect(conversationOfRow(findConversation(db, "s1") ?? {})).toMatchObject({ title: "AAAA", userTurns: 3 });
    expect(hits(db, "appended")).toEqual(["s1"]);
    expect(hits(db, "first")).toEqual(["s1"]);
    expect(readFileMark(db, file)?.scannedTo).toBe(statSync(file).size);
  });

  it("reads a file again from the start when it was replaced by one that is longer", async () => {
    const { db, deps, transcript } = setup();
    const file = transcript("s1", prompt("original words"));
    await runIndexPass(deps);
    writeFileSync(file, prompt("replacement words") + reply("and a reply that makes it longer"));
    await runIndexPass(deps);
    expect(hits(db, "original")).toEqual([]);
    expect(hits(db, "replacement")).toEqual(["s1"]);
  });

  it("reads a file again from the start when the bytes where the last read stopped were rewritten", async () => {
    const { db, deps, transcript } = setup();
    const file = transcript("s1", prompt(`opening ${"x".repeat(HEAD_BYTES)}`) + prompt("closing words"));
    await runIndexPass(deps);
    writeFileSync(file, readFileSync(file, "utf8").replace("closing", "revised") + prompt("appended"));
    await runIndexPass(deps);
    expect(hits(db, "closing")).toEqual([]);
    expect(hits(db, "revised")).toEqual(["s1"]);
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

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("deletes nothing when a project directory could not be read", async () => {
    const { deps, transcript, ids } = setup();
    transcript("s1", prompt("in a project that turns unreadable"));
    transcript("s2", prompt("elsewhere"), "-w-other");
    await runIndexPass(deps);
    const projectDir = path.join(deps.projectsRoot, "-w-app");
    chmodSync(projectDir, 0o000);
    try {
      await runIndexPass({ ...deps, now_ms: () => 100_000 });
    } finally {
      chmodSync(projectDir, 0o700);
    }
    expect(ids().sort()).toEqual(["s1", "s2"]);
  });

  it("indexes a file with more prose turns than one batch holds", async () => {
    const { db, deps, transcript } = setup();
    const count = SCAN_BATCH_ITEMS * 2 + 3;
    transcript("s1", Array.from({ length: count }, (_, i) => prompt(`turn number ${String(i)}`)).join(""));
    await runIndexPass(deps);
    expect(Number(db.prepare("select count(*) as n from turns where conv = 's1'").get()?.n)).toBe(count);
    expect(conversationOfRow(findConversation(db, "s1") ?? {}).userTurns).toBe(count);
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

  it("forgets the prompt history once its file is deleted", async () => {
    const { db, deps, transcript } = setup();
    transcript("s1", prompt("kept transcript"));
    writeFileSync(deps.historyFile, line({ display: "typed then deleted", sessionId: "s1", timestamp: 5 }));
    await runIndexPass(deps);
    expect(hits(db, "then deleted")).toEqual(["s1"]);
    rmSync(deps.historyFile);
    await runIndexPass({ ...deps, now_ms: () => 100_000 });
    expect(hits(db, "then deleted")).toEqual([]);
    expect(hits(db, "kept transcript")).toEqual(["s1"]);
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

  // Another process takes over part-way, indexes a file this pass never listed, and finishes. This
  // pass then finds the lease free; it must stop rather than take it again and delete that file.
  it("stops for good once it has lost the lease part-way, even if the lease is free again", async () => {
    const { db, deps, transcript } = setup();
    transcript("s1", prompt("a"));
    transcript("s2", prompt("b"));
    let calls = 0;
    const handOver = () => {
      db.prepare("update lease set owner = null, expires_ms = null where id = 1").run();
      db.prepare("insert into files (path, kind, size, mtime_ms, scanned_to, head) values ('/elsewhere/new.jsonl', 'transcript', 1, 1, 1, 'h')").run();
    };
    const now_ms = (): number => {
      calls += 1;
      if (calls === 2) handOver();
      return 1000;
    };
    expect(await runIndexPass({ ...deps, now_ms })).toBe(false);
    expect(readFileMark(db, "/elsewhere/new.jsonl")).not.toBeNull();
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
