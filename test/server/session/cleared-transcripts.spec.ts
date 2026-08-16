// @vitest-environment node
//
// The durable half of the /clear fix (#1085). The in-memory set is what the readers ask, but the
// window it covers outlives one process — tmux keeps the session's claude running across a server
// restart — so what is pinned here is that the mark comes back, and that it comes back ONLY while
// the transcript is still the frozen one.
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
  markStillHolds,
  markTranscriptCleared,
  parseClearedMark,
} from "../../../server/session/cleared-transcripts.js";
import { projectSessionsDir } from "../../../server/session/project-dir.js";

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

async function writeTranscript(text: string) {
  const dir = projectSessionsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${SESSION}.jsonl`), text);
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
  it("marks the session and records the transcript's size at the clear", async () => {
    await writeTranscript("a".repeat(120));
    await markTranscriptCleared(SESSION, cwd, undefined, marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(true);
    // objectContaining, because the mark also carries WHEN the clear happened (#1749); the size is
    // what this test is about and what the expiry rule reads.
    expect(JSON.parse(await fs.readFile(markerFile(), "utf8"))).toEqual(expect.objectContaining({ cwd, size: 120 }));
  });

  // A session cleared before its first turn was written has no file to size; 0 is the honest
  // answer and still expires the moment claude writes anything to that id.
  it("records size 0 when there is no transcript yet", async () => {
    await markTranscriptCleared(SESSION, cwd, undefined, marksDir);
    expect(JSON.parse(await fs.readFile(markerFile(), "utf8")).size).toBe(0);
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

  // The one thing that un-freezes a transcript: claude picked it back up (`--resume`) and is
  // appending again. Without this, a server killed before reap would silence that session's
  // summary for good.
  it("drops a mark whose transcript has grown since the clear", async () => {
    await writeTranscript("a".repeat(120));
    await markTranscriptCleared(SESSION, cwd, undefined, marksDir);
    clearedTranscripts.clear();
    await writeTranscript("a".repeat(200)); // resumed, and writing to that file again

    await hydrateClearedTranscripts(marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(false);
    expect(await exists(markerFile())).toBe(false); // and the marker is cleaned up
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

    forgetClearedTranscript(SESSION, marksDir);
    expect(clearedTranscripts.has(SESSION)).toBe(false);
    await vi.waitFor(async () => expect(await exists(markerFile())).toBe(false));
  });
});

describe("parseClearedMark", () => {
  it("accepts a well-formed mark", () => {
    expect(parseClearedMark({ cwd: "/ws", size: 12 })).toEqual({ cwd: "/ws", size: 12 });
  });

  // A hand-edited or truncated file must read as "no mark", not as a mark with a nonsense size —
  // a negative or missing size would make markStillHolds answer for a file it never described.
  it.each([[null], [undefined], ["x"], [{ cwd: "/ws" }], [{ size: 3 }], [{ cwd: "", size: 3 }], [{ cwd: "/ws", size: -1 }], [{ cwd: "/ws", size: "3" }]])(
    "rejects %s",
    (raw) => {
      expect(parseClearedMark(raw)).toBeNull();
    },
  );
});

describe("markStillHolds", () => {
  it("holds while the transcript is no bigger than it was at the clear", () => {
    expect(markStillHolds({ cwd: "/ws", size: 100 }, 100)).toBe(true);
    // Smaller than recorded is not a resume — a truncated or replaced file says nothing was
    // appended, so the frozen conversation is still all there is to read.
    expect(markStillHolds({ cwd: "/ws", size: 100 }, 40)).toBe(true);
  });

  it("stops holding once anything has been appended", () => {
    expect(markStillHolds({ cwd: "/ws", size: 100 }, 101)).toBe(false);
  });
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
    forgetClearedTranscript(SESSION, marksDir);
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
});
