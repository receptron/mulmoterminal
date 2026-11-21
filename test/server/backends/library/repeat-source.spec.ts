// @vitest-environment node
// What the repeated-instruction check reads (#3334): one line of the prompt log as a prompt, and the
// log read again only when it changed.
import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promptLogReader, repeatPromptOf } from "../../../../server/backends/library/repeat-source.js";

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
