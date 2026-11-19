// @vitest-environment node
//
// The durable half of the /clear fix (#1085). The in-memory set is what the readers ask, but the
// window it covers outlives one process — tmux keeps the session's claude running across a server
// restart — so what is pinned here is that the mark comes back, and that it comes back ONLY while
// a transcript it describes is still on disk.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearedAtOf,
  clearedClaudeIdOf,
  clearedTranscripts,
  forgetClearedTranscript,
  hydrateClearedTranscripts,
  MARK_SIZE_NEVER_REACHED,
  markTranscriptCleared,
  parseClearedMark,
} from "../../../../server/session/transcript/cleared-transcripts.js";
import { projectSessionsDir } from "../../../../server/session/project-dir.js";

const SESSION = "11111111-2222-4333-8444-555555555555";
// What claude re-mints itself as at a `/clear` (#1749).
const CLAUDE_ID = "99999999-8888-4777-8666-555555555555";

// The marks live in their own directory (injected), the transcripts under a temp HOME — the same
// arrangement session-title.spec.ts uses, since both read claude's real on-disk layout.
let home = "";
let cwd = "";
let marksDir = "";
let realHome: string | undefined;

const markerFile = () => path.join(marksDir, `${SESSION}.json`);
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

async function writeTranscript(text: string, id: string = SESSION) {
  const dir = projectSessionsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.jsonl`), text);
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-cleared-"));
  realHome = process.env.HOME;
  process.env.HOME = home;
  vi.spyOn(os, "homedir").mockReturnValue(home);
  cwd = path.join(home, "ws");
  marksDir = path.join(home, "marks");
  await fs.mkdir(cwd, { recursive: true });
  clearedTranscripts.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  await fs.rm(home, { recursive: true, force: true });
  clearedTranscripts.clear();
});

describe("markTranscriptCleared", () => {
  // An older server sharing this home parses the mark only with a size, and expires it once the
  // file outgrows that size — which claude's post-hook cost-state append always does.
  it("writes a size no transcript reaches, so an older server keeps the mark", async () => {
    await writeTranscript("a".repeat(120));
    await markTranscriptCleared(SESSION, cwd, undefined, marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(true);
    const written: unknown = JSON.parse(await fs.readFile(markerFile(), "utf8"));
    expect(written).toEqual(expect.objectContaining({ cwd, size: MARK_SIZE_NEVER_REACHED }));
    const parsed = parseClearedMark(written);
    expect(parsed).not.toBeNull();
    // The rule an older server applies at boot (`currentSize <= mark.size`), after the append.
    await writeTranscript("a".repeat(120) + '{"type":"cost-state"}\n');
    const grown = (await fs.stat(path.join(projectSessionsDir(cwd), `${SESSION}.jsonl`))).size;
    expect(grown <= (parsed?.size ?? -1)).toBe(true);
  });

  // A mark's write landing after a later unmark's removal would restore the successor at boot.
  it("leaves no marker when an unmark is called while the mark is still being written", async () => {
    const realWrite = fs.writeFile.bind(fs);
    const released: { release: () => void } = { release: () => {} };
    const gate = new Promise<void>((resolve) => {
      released.release = resolve;
    });
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      await gate;
      return realWrite(...args);
    });

    const marking = markTranscriptCleared(SESSION, cwd, CLAUDE_ID, marksDir);
    const unmarking = forgetClearedTranscript(SESSION, marksDir);
    released.release();
    await marking;
    expect(await unmarking).toBe(true);
    expect(await exists(markerFile())).toBe(false);
    expect(clearedTranscripts.has(SESSION)).toBe(false);
  });

  it("stays in memory only when the hook reported no cwd", async () => {
    await markTranscriptCleared(SESSION, undefined, undefined, marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(true);
    expect(await exists(markerFile())).toBe(false);
  });
});

describe("hydrateClearedTranscripts", () => {
  it("brings the mark back after a restart", async () => {
    await writeTranscript("a".repeat(120));
    await markTranscriptCleared(SESSION, cwd, undefined, marksDir);
    clearedTranscripts.clear(); // the restart

    await hydrateClearedTranscripts(marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(true);
  });

  // Claude appends a cost-state line to the transcript it leaves AFTER the hook that announced the
  // clear, so the file is always bigger than the recorded size by the next boot. Expiring on growth
  // dropped every mark and resumed the conversation the user ended (#3325).
  // Written on disk only, with the size measured at the clear as an earlier server recorded it, so
  // both assertions come from hydration rather than from state the mark left in memory.
  it("keeps a mark whose transcript has grown since the clear", async () => {
    await writeTranscript("a".repeat(200));
    await fs.mkdir(marksDir, { recursive: true });
    await fs.writeFile(markerFile(), JSON.stringify({ cwd, size: 120, at: 5, claudeId: CLAUDE_ID }));

    await hydrateClearedTranscripts(marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(true);
    expect(clearedClaudeIdOf(SESSION)).toBe(CLAUDE_ID);
  });

  // A cell that moved before its first turn was written has no file of its own.
  it("keeps a mark when only the successor's transcript is on disk", async () => {
    await writeTranscript("{}\n", CLAUDE_ID);
    await markTranscriptCleared(SESSION, cwd, CLAUDE_ID, marksDir);
    clearedTranscripts.clear();

    await hydrateClearedTranscripts(marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(true);
  });

  // A permission or I/O failure says nothing about the file; dropping the mark on it loses the
  // successor for good.
  it("keeps a mark when the transcript check fails for a reason other than a missing file", async () => {
    await markTranscriptCleared(SESSION, cwd, CLAUDE_ID, marksDir);
    clearedTranscripts.clear();
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
    vi.spyOn(fs, "stat").mockRejectedValue(denied);

    await hydrateClearedTranscripts(marksDir);
    vi.mocked(fs.stat).mockRestore();
    expect(clearedTranscripts.has(SESSION)).toBe(true);
    expect(await exists(markerFile())).toBe(true);
  });

  it.each([
    ["with a successor id", CLAUDE_ID],
    ["without one", undefined],
  ])("prunes a mark when no transcript it describes is on disk (%s)", async (_label, claudeId) => {
    await markTranscriptCleared(SESSION, cwd, claudeId, marksDir);
    clearedTranscripts.clear();

    await hydrateClearedTranscripts(marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(false);
    expect(await exists(markerFile())).toBe(false);
  });

  it("discards a corrupt marker instead of trusting it", async () => {
    await fs.mkdir(marksDir, { recursive: true });
    await fs.writeFile(markerFile(), "{ not json");

    await hydrateClearedTranscripts(marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(false);
    expect(await exists(markerFile())).toBe(false);
  });

  it("ignores a file that is not named after a session, and leaves it alone", async () => {
    await fs.mkdir(marksDir, { recursive: true });
    const stray = path.join(marksDir, "notes.txt");
    await fs.writeFile(stray, "x");

    await hydrateClearedTranscripts(marksDir);
    expect(clearedTranscripts.size).toBe(0);
    expect(await exists(stray)).toBe(true);
  });

  it("finds nothing on a first run, where the directory does not exist", async () => {
    await hydrateClearedTranscripts(path.join(home, "never-written"));
    expect(clearedTranscripts.size).toBe(0);
  });
});

describe("forgetClearedTranscript", () => {
  it("drops the mark from memory and from disk", async () => {
    await writeTranscript("a".repeat(10));
    await markTranscriptCleared(SESSION, cwd, undefined, marksDir);

    expect(await forgetClearedTranscript(SESSION, marksDir)).toBe(true);
    expect(clearedTranscripts.has(SESSION)).toBe(false);
    expect(await exists(markerFile())).toBe(false);
  });

  it("succeeds for a mark that was never written to disk", async () => {
    await markTranscriptCleared(SESSION, undefined, CLAUDE_ID, marksDir);
    expect(await forgetClearedTranscript(SESSION, marksDir)).toBe(true);
    expect(clearedTranscripts.has(SESSION)).toBe(false);
  });

  // This process must resume our own transcript at once; only the disk copy can be left behind.
  it("drops the mark from memory and reports a removal that fails", async () => {
    await writeTranscript("a".repeat(10));
    await markTranscriptCleared(SESSION, cwd, CLAUDE_ID, marksDir);
    await fs.rm(markerFile());
    await fs.mkdir(path.join(markerFile(), "blocker"), { recursive: true }); // rm without recursive refuses a directory
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await forgetClearedTranscript(SESSION, marksDir)).toBe(false);
    expect(clearedTranscripts.has(SESSION)).toBe(false);
    expect(clearedClaudeIdOf(SESSION)).toBeUndefined();
    expect(await exists(markerFile())).toBe(true);
  });
});

describe("parseClearedMark", () => {
  it("accepts a well-formed mark", () => {
    expect(parseClearedMark({ cwd: "/ws", size: 12 })).toEqual({ cwd: "/ws", size: 12 });
  });

  // A hand-edited or truncated file must read as "no mark". The size is required because an older
  // server requires it, so a mark this one accepts is one that one accepts too.
  it.each([[null], [undefined], ["x"], [{ cwd: "/ws" }], [{ size: 3 }], [{ cwd: "", size: 3 }], [{ cwd: "/ws", size: -1 }], [{ cwd: "/ws", size: "3" }]])(
    "rejects %s",
    (raw) => {
      expect(parseClearedMark(raw)).toBeNull();
    },
  );
});

// The prompts pane draws its line at the MOMENT of the clear: claude's own prompt history is one
// file per user, so a cleared conversation leaves no seam in it and only the time separates the two
// (#1749). It rides this mark rather than living in memory, because the boundary has to survive the
// restart the mark itself exists for (Codex).
describe("when the clear happened", () => {
  it("is remembered, and written into the mark", async () => {
    await writeTranscript("{}\n");
    const before = Date.now();
    await markTranscriptCleared(SESSION, cwd, undefined, marksDir);
    const at = clearedAtOf(SESSION);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    expect(JSON.parse(await fs.readFile(markerFile(), "utf8")).at).toBe(at);
  });

  it("is remembered even when there is no cwd to freeze a file for", async () => {
    await markTranscriptCleared(SESSION, undefined, undefined, marksDir);
    expect(clearedAtOf(SESSION)).toBeGreaterThan(0);
    expect(await exists(markerFile())).toBe(false); // memory only, as before
  });

  it("comes back from disk on hydration", async () => {
    await writeTranscript("{}\n");
    await fs.mkdir(marksDir, { recursive: true });
    await fs.writeFile(markerFile(), JSON.stringify({ cwd, size: 3, at: 1234567890 }));
    await hydrateClearedTranscripts(marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(true);
    expect(clearedAtOf(SESSION)).toBe(1234567890);
  });

  // Codex, #1749: the boundary alone is not enough after a restart. Claude's new id is where the
  // POST-clear prompts are filed, so a pane that remembers only when the clear happened shows
  // nothing until the next hook re-teaches it.
  it("writes the id claude took at the clear into the mark", async () => {
    await writeTranscript("{}\n");
    await markTranscriptCleared(SESSION, cwd, CLAUDE_ID, marksDir);
    expect(clearedClaudeIdOf(SESSION)).toBe(CLAUDE_ID);
    expect(JSON.parse(await fs.readFile(markerFile(), "utf8")).claudeId).toBe(CLAUDE_ID);
  });

  it("brings that id back on hydration, which is the restart the mark exists for", async () => {
    await writeTranscript("{}\n");
    await fs.mkdir(marksDir, { recursive: true });
    await fs.writeFile(markerFile(), JSON.stringify({ cwd, size: 3, at: 5, claudeId: CLAUDE_ID }));

    await hydrateClearedTranscripts(marksDir);
    expect(clearedAtOf(SESSION)).toBe(5);
    expect(clearedClaudeIdOf(SESSION)).toBe(CLAUDE_ID);
  });

  it("keeps no id when the clear hook named none", async () => {
    await writeTranscript("{}\n");
    await markTranscriptCleared(SESSION, cwd, undefined, marksDir);
    expect(clearedClaudeIdOf(SESSION)).toBeUndefined();
    expect(JSON.parse(await fs.readFile(markerFile(), "utf8")).claudeId).toBeUndefined();
  });

  // It is read back off a file and then used to select rows out of claude's history, so it crosses
  // the same shape check every other id does.
  it("ignores a claudeId that is not a session id, keeping the freeze", () => {
    expect(parseClearedMark({ cwd: "/x", size: 5, at: 1, claudeId: "../etc/passwd" })).toEqual({ cwd: "/x", size: 5, at: 1 });
    expect(parseClearedMark({ cwd: "/x", size: 5, at: 1, claudeId: 42 })).toEqual({ cwd: "/x", size: 5, at: 1 });
    expect(parseClearedMark({ cwd: "/x", size: 5, at: 1, claudeId: CLAUDE_ID })).toEqual({ cwd: "/x", size: 5, at: 1, claudeId: CLAUDE_ID });
  });

  it("is dropped with the mark", async () => {
    await markTranscriptCleared(SESSION, cwd, undefined, marksDir);
    await forgetClearedTranscript(SESSION, marksDir);
    expect(clearedAtOf(SESSION)).toBeUndefined();
  });

  // An older mark has no time. It must still freeze the transcript — losing that over a missing
  // field would resurrect a whole conversation — and simply draws no line.
  it("reads a mark written before the time existed as frozen, with no boundary", async () => {
    expect(parseClearedMark({ cwd: "/x", size: 5 })).toEqual({ cwd: "/x", size: 5 });
    expect(parseClearedMark({ cwd: "/x", size: 5, at: "yesterday" })).toEqual({ cwd: "/x", size: 5 });
    expect(parseClearedMark({ cwd: "/x", size: 5, at: -1 })).toEqual({ cwd: "/x", size: 5 });
    expect(parseClearedMark({ cwd: "/x", size: 5, at: 7 })).toEqual({ cwd: "/x", size: 5, at: 7 });
  });

  // The spawn resumes the successor, so it must come back even when the time did not.
  it.each([
    ["absent", undefined],
    ["malformed", "yesterday"],
  ])("brings the successor back when the time is %s", async (_label, at) => {
    await writeTranscript("{}\n", CLAUDE_ID);
    await fs.mkdir(marksDir, { recursive: true });
    await fs.writeFile(markerFile(), JSON.stringify({ cwd, size: 0, at, claudeId: CLAUDE_ID }));

    await hydrateClearedTranscripts(marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(true);
    expect(clearedClaudeIdOf(SESSION)).toBe(CLAUDE_ID);
    expect(clearedAtOf(SESSION)).toBeUndefined();
  });
});
