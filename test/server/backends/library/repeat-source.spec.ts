// @vitest-environment node
// What the repeated-instruction check reads (#3334): one line of the prompt log as a prompt, and the
// log read again only when it changed.
import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promptLogReader, repeatPromptOf, REPEAT_TEXT_MAX } from "../../../../server/backends/library/repeat-source.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("repeatPromptOf", () => {
  it("reads the text, session, directory and time of a line", () => {
    expect(repeatPromptOf({ display: "merge it", sessionId: "s", project: "/w", timestamp: 5 })).toEqual({
      text: "merge it",
      sessionId: "s",
      project: "/w",
      at: 5,
    });
    expect(repeatPromptOf({ display: "merge it", sessionId: "s" })).toEqual({ text: "merge it", sessionId: "s", project: null, at: 0 });
  });

  it("keeps a prompt up to the bound, in whole characters", () => {
    const long = "あ".repeat(REPEAT_TEXT_MAX + 5);
    expect([...(repeatPromptOf({ display: long, sessionId: "s" })?.text ?? "")]).toHaveLength(REPEAT_TEXT_MAX);
    const astral = "😀".repeat(REPEAT_TEXT_MAX + 1);
    expect(repeatPromptOf({ display: astral, sessionId: "s" })?.text).toBe("😀".repeat(REPEAT_TEXT_MAX));
    expect(repeatPromptOf({ display: "short", sessionId: "s" })?.text).toBe("short");
  });

  it("is null for a line with no text or no session", () => {
    [{ display: "  ", sessionId: "s" }, { display: "x", sessionId: "" }, { display: 3, sessionId: "s" }, { display: "x" }, {}].forEach((record) =>
      expect(repeatPromptOf(record)).toBeNull(),
    );
  });
});

describe("promptLogReader", () => {
  it("reads the log, reads it again only when it changed, and has nothing for a missing one", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-prompt-log-"));
    dirs.push(dir);
    const file = path.join(dir, "history.jsonl");
    expect(await promptLogReader(file)()).toEqual([]);
    writeFileSync(file, `${JSON.stringify({ display: "one", sessionId: "s", timestamp: 1 })}\nnot json\n`);
    const read = promptLogReader(file);
    const first = await read();
    expect(first.map((p) => p.text)).toEqual(["one"]);
    expect(await read()).toBe(first);
    appendFileSync(file, `${JSON.stringify({ display: "two", sessionId: "s", timestamp: 2 })}\n`);
    utimesSync(file, new Date(), new Date(Date.now() + 1000));
    expect((await read()).map((p) => p.text)).toEqual(["one", "two"]);
  });
});

describe("promptLogReader with overlapping calls", () => {
  it("shares one read between calls that overlap, and reads again after one that failed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-prompt-log-"));
    dirs.push(dir);
    const file = path.join(dir, "history.jsonl");
    writeFileSync(file, "{}\n");
    let reads = 0;
    let fail = true;
    const read = promptLogReader(file, async () => {
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (fail) throw new Error("unreadable");
      return [{ text: "x", sessionId: "s", project: null, at: 1 }];
    });
    const overlapping = await Promise.allSettled([read(), read()]);
    expect(overlapping.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(reads).toBe(1);
    fail = false;
    expect((await read()).map((p) => p.text)).toEqual(["x"]);
    await read();
    expect(reads).toBe(2);
  });
});
