import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
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
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  await fs.rm(home, { recursive: true, force: true });
});

// The real generator shells out to the claude CLI; the fake keeps these tests fast,
// deterministic, and runnable without an API key.
function setup(now = () => 1_000_000, generateTitle: (raw: string) => Promise<string | null> = async () => "Generated title") {
  const published: string[] = [];
  const summarized: string[] = [];
  const mgr = createTitleManager({
    publishActivity: (id) => published.push(id),
    now,
    generateTitle: (raw) => {
      summarized.push(raw);
      return generateTitle(raw);
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
