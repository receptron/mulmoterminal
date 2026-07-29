import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConversationTurn } from "../../../server/session/transcript.js";
import { createTitleManager } from "../../../server/session/session-title.js";
import {
  aiTitles,
  lastTitleAttemptMs,
  lastTitledUserTurns,
  titleEpoch,
  titleInFlight,
  titlePending,
  titleTurnCounts,
} from "../../../server/session/registry.js";
import { clearedTranscripts } from "../../../server/session/cleared-transcripts.js";

const SESSION = "11111111-2222-3333-4444-555555555555";

// generateAndStoreTitle reads the transcript from ~/.claude/projects/<encoded-cwd>/, so
// the tests write a real one under a temp HOME rather than stubbing the reader.
let home = "";
let cwd = "";
let realHome: string | undefined;

async function writeTranscript(lines: string[]) {
  const { projectSessionsDir } = await import("../../../server/session/project-dir.js");
  const dir = projectSessionsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${SESSION}.jsonl`), lines.join("\n"));
}

const userTurn = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } });

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-title-"));
  realHome = process.env.HOME;
  process.env.HOME = home;
  vi.spyOn(os, "homedir").mockReturnValue(home);
  cwd = path.join(home, "ws");
  await fs.mkdir(cwd, { recursive: true });
  for (const m of [aiTitles, titleTurnCounts, titleEpoch, lastTitledUserTurns, lastTitleAttemptMs]) m.clear();
  titlePending.clear();
  titleInFlight.clear();
  clearedTranscripts.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  await fs.rm(home, { recursive: true, force: true });
});

// The real generator shells out to the claude CLI; the fake keeps these tests fast,
// deterministic, and runnable without an API key.
function setup(now = () => 1_000_000, generateTitle: (turns: ConversationTurn[]) => Promise<string | null> = async () => "Generated title") {
  const published: string[] = [];
  // Turns, not a raw transcript — the manager streams the file now (#998), so what the generator
  // receives is what came out of that stream.
  const summarized: ConversationTurn[][] = [];
  const mgr = createTitleManager({
    publishActivity: (id) => published.push(id),
    now,
    generateTitle: (turns) => {
      summarized.push(turns);
      return generateTitle(turns);
    },
  });
  return { ...mgr, published, summarized };
}

describe("noteTitleTurn", () => {
  it("flags a session that has no title yet", () => {
    const { noteTitleTurn } = setup();
    noteTitleTurn(SESSION, "add a retry to the uploader");
    expect(titlePending.has(SESSION)).toBe(true);
    expect(titleTurnCounts.get(SESSION)).toBe(1);
  });

  it("does not re-flag a titled session on an ordinary turn", () => {
    const { noteTitleTurn } = setup();
    aiTitles.set(SESSION, "Uploader retry");
    noteTitleTurn(SESSION, "and add a test for it");
    expect(titlePending.has(SESSION)).toBe(false);
  });

  it("re-flags a titled session when the prompt is a bare acknowledgement", () => {
    // "ok" tells you nothing about the session, so the title it produced is already
    // suspect — regenerate from the fuller history instead.
    const { noteTitleTurn } = setup();
    aiTitles.set(SESSION, "Uploader retry");
    noteTitleTurn(SESSION, "ok");
    expect(titlePending.has(SESSION)).toBe(true);
  });

  it("counts turns cumulatively across calls", () => {
    const { noteTitleTurn } = setup();
    aiTitles.set(SESSION, "T");
    for (const p of ["a", "b", "c"]) noteTitleTurn(SESSION, `do ${p} thoroughly`);
    expect(titleTurnCounts.get(SESSION)).toBe(3);
  });
});

describe("forgetTitle", () => {
  it("drops every trace of the title", () => {
    const { forgetTitle } = setup();
    aiTitles.set(SESSION, "T");
    titleTurnCounts.set(SESSION, 5);
    titlePending.add(SESSION);
    forgetTitle(SESSION);
    expect(aiTitles.has(SESSION)).toBe(false);
    expect(titleTurnCounts.has(SESSION)).toBe(false);
    expect(titlePending.has(SESSION)).toBe(false);
  });

  it("bumps the epoch, which is what voids a generation already in flight", () => {
    const { forgetTitle } = setup();
    expect(titleEpoch.get(SESSION) ?? 0).toBe(0);
    forgetTitle(SESSION);
    forgetTitle(SESSION);
    expect(titleEpoch.get(SESSION)).toBe(2);
  });
});

describe("maybeGenerateTitle", () => {
  it("stores and publishes a title for a flagged session", async () => {
    const { maybeGenerateTitle, published } = setup();
    await writeTranscript([userTurn("add a retry to the uploader")]);
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, cwd);
    expect(aiTitles.get(SESSION)).toBe("Generated title");
    expect(published).toEqual([SESSION]);
    expect(titlePending.has(SESSION)).toBe(false);
    expect(titleTurnCounts.get(SESSION)).toBe(0); // the counter restarts from the new title
  });

  it("does nothing when the session was never flagged", async () => {
    const { maybeGenerateTitle, published } = setup();
    await writeTranscript([userTurn("hello")]);
    await maybeGenerateTitle(SESSION, cwd);
    expect(aiTitles.has(SESSION)).toBe(false);
    expect(published).toEqual([]);
  });

  it("does nothing without a cwd, which is where the transcript lives", async () => {
    const { maybeGenerateTitle } = setup();
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, undefined);
    expect(titlePending.has(SESSION)).toBe(true); // still owed once a cwd is known
  });

  it("leaves the previous title alone when the summarizer returns nothing", async () => {
    // A failed or timed-out CLI call yields null; the roster keeps the title it had
    // rather than falling back to a blank header.
    const { maybeGenerateTitle, published } = setup(undefined, async () => null);
    await writeTranscript([userTurn("add a retry to the uploader")]);
    aiTitles.set(SESSION, "Previous title");
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, cwd);
    expect(aiTitles.get(SESSION)).toBe("Previous title");
    expect(published).toEqual([]);
  });

  it("does not summarize at all when there is no transcript to read", async () => {
    const { maybeGenerateTitle, summarized } = setup();
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, cwd); // nothing written
    expect(summarized).toEqual([]);
  });

  it("leaves the previous title alone when there is no transcript to read", async () => {
    const { maybeGenerateTitle, published } = setup();
    aiTitles.set(SESSION, "Previous title");
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, cwd); // nothing written
    expect(aiTitles.get(SESSION)).toBe("Previous title");
    expect(published).toEqual([]);
  });

  it("discards a title generated across a /clear", async () => {
    // The epoch guard: the header was cleared while the summarizer ran, so its
    // result describes a conversation the user no longer sees.
    const { maybeGenerateTitle, forgetTitle, published } = setup();
    await writeTranscript([userTurn("add a retry to the uploader")]);
    titlePending.add(SESSION);
    const running = maybeGenerateTitle(SESSION, cwd);
    forgetTitle(SESSION); // /clear lands mid-generation
    await running;
    expect(aiTitles.has(SESSION)).toBe(false);
    expect(published).toEqual([]);
  });

  it("does not title a cleared session from its frozen transcript", async () => {
    // The epoch guard above only voids a generation that was ALREADY running. This is the turn
    // AFTER the /clear: forgetTitle left the session untitled, so the next prompt flags it as
    // due — and the only turns on disk are the ones the user just cleared away (#1085).
    const { maybeGenerateTitle, published, summarized } = setup();
    await writeTranscript([userTurn("continue GitHub issue 1048")]);
    clearedTranscripts.add(SESSION);
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, cwd);
    expect(summarized).toEqual([]); // never even read the pre-clear turns
    expect(aiTitles.has(SESSION)).toBe(false);
    expect(published).toEqual([]);
  });

  it("titles again once the session is no longer cleared", async () => {
    // reap() drops the mark, so resuming that id (which appends to the file again) restores
    // the normal behaviour rather than leaving the roster row blank for good.
    const { maybeGenerateTitle } = setup();
    await writeTranscript([userTurn("add a retry to the uploader")]);
    clearedTranscripts.add(SESSION);
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, cwd);
    clearedTranscripts.delete(SESSION);
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, cwd);
    expect(aiTitles.get(SESSION)).toBe("Generated title");
  });

  it("does not summarize twice when a second trigger lands mid-generation", async () => {
    // A Stop hook and a roster view can both ask while the first summarizer is still
    // running. Only the in-flight guard stops the second from shelling out again.
    let release: (title: string | null) => void = () => {};
    const slow = () => new Promise<string | null>((resolve) => (release = resolve));
    const { maybeGenerateTitle, published, summarized } = setup(undefined, slow);
    await writeTranscript([userTurn("add a retry to the uploader")]);

    titlePending.add(SESSION);
    const first = maybeGenerateTitle(SESSION, cwd);
    await vi.waitFor(() => expect(summarized).toHaveLength(1)); // the first is now in flight
    titlePending.add(SESSION); // a second Stop arrives before the first finished
    await maybeGenerateTitle(SESSION, cwd);
    expect(summarized).toHaveLength(1); // refused rather than summarizing again

    release("Generated title");
    await first;
    expect(published).toEqual([SESSION]);
  });

  // The generator is handed the transcript's TURNS, read by streaming the file (#998) rather than
  // slurping it — which is what lets a session past ~512 MB be titled at all.
  it("hands the generator the turns it streamed out of the transcript", async () => {
    const { maybeGenerateTitle, summarized } = setup();
    const assistantTurn = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Added it." }] } });
    await writeTranscript([userTurn("add a retry to the uploader"), assistantTurn]);
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, cwd);
    await vi.waitFor(() => expect(summarized).toHaveLength(1));
    expect(summarized[0]).toEqual([
      { role: "user", text: "add a retry to the uploader" },
      { role: "assistant", text: "Added it." },
    ]);
  });

  it("clears the in-flight mark even when generation fails", async () => {
    const { maybeGenerateTitle } = setup();
    titlePending.add(SESSION);
    await maybeGenerateTitle(SESSION, cwd); // no transcript → nothing generated
    expect(titleInFlight.has(SESSION)).toBe(false);
  });
});

describe("freshenRosterTitle", () => {
  it("re-summarizes a session that has moved well past its titled turn", async () => {
    const { freshenRosterTitle, published } = setup();
    await writeTranscript([userTurn("add a retry to the uploader")]);
    lastTitledUserTurns.set(SESSION, 0);
    freshenRosterTitle(SESSION, cwd, 99);
    await vi.waitFor(() => expect(published).toEqual([SESSION]));
  });

  it("leaves a freshly-titled session alone", () => {
    const { freshenRosterTitle, published } = setup();
    lastTitledUserTurns.set(SESSION, 5);
    freshenRosterTitle(SESSION, cwd, 5);
    expect(published).toEqual([]);
    expect(lastTitleAttemptMs.has(SESSION)).toBe(false); // no attempt was even started
  });

  it("does not retry within the retry floor, however often the roster polls", async () => {
    // Without the floor a viewed-but-failing session spawns a summarizer per poll.
    let clock = 1_000_000;
    const { freshenRosterTitle } = setup(() => clock);
    lastTitledUserTurns.set(SESSION, 0);
    freshenRosterTitle(SESSION, cwd, 99);
    const first = lastTitleAttemptMs.get(SESSION);
    await vi.waitFor(() => expect(titleInFlight.has(SESSION)).toBe(false)); // isolate the floor from the in-flight guard
    clock += 29_000;
    freshenRosterTitle(SESSION, cwd, 99);
    expect(lastTitleAttemptMs.get(SESSION)).toBe(first); // the second poll was refused
  });

  it("retries once the floor has passed", async () => {
    let clock = 1_000_000;
    const { freshenRosterTitle } = setup(() => clock);
    lastTitledUserTurns.set(SESSION, 0);
    freshenRosterTitle(SESSION, cwd, 99);
    await vi.waitFor(() => expect(titleInFlight.has(SESSION)).toBe(false));
    clock += 30_001;
    freshenRosterTitle(SESSION, cwd, 99);
    expect(lastTitleAttemptMs.get(SESSION)).toBe(clock);
  });

  it("does not start a second summarizer while one is in flight", () => {
    const { freshenRosterTitle } = setup();
    lastTitledUserTurns.set(SESSION, 0);
    titleInFlight.add(SESSION);
    freshenRosterTitle(SESSION, cwd, 99);
    expect(lastTitleAttemptMs.has(SESSION)).toBe(false);
  });
});
