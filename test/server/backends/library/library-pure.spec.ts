// @vitest-environment node
// The Library index's small pure rules (#3328): temp paths, the prompt-history line, whether to
// re-read a file, and the text work around search.
import { describe, it, expect } from "vitest";
import { isTemporaryCwd } from "../../../../server/backends/library/temporary-path";
import { historyPromptOf } from "../../../../server/backends/library/history-fold";
import { resumePlan, unlessReplaced } from "../../../../server/backends/library/resume-plan";
import { escapeLike, snippetAround } from "../../../../server/backends/library/library-text";
import { ftsPhrase } from "../../../../server/backends/library/library-search";
import { TURN_TEXT_CAP } from "../../../../server/backends/library/conversation-fold";

describe("isTemporaryCwd", () => {
  const roots = ["/private/var/folders/7l/abc/T/", "/tmp"];

  it.each([
    ["/private/var/folders/7l/abc/T/skillfixture-x", true],
    ["/private/var/folders/7l/abc/T", true],
    ["/tmp/probe", true],
    ["/tmpfoo/project", false],
    ["/Users/me/ss/llm/mulmoterminal3", false],
    ["", false],
    ["   ", false],
  ])("%s → %s", (cwd, expected) => {
    expect(isTemporaryCwd(cwd, roots)).toBe(expected);
  });

  it("answers false for no cwd, and for no roots", () => {
    expect(isTemporaryCwd(null, roots)).toBe(false);
    expect(isTemporaryCwd("/tmp/x", [])).toBe(false);
    expect(isTemporaryCwd("/tmp/x", [""])).toBe(false);
  });

  it("compares a Windows root with either separator and without case", () => {
    const windows = ["C:\\Users\\Me\\AppData\\Local\\Temp"];
    expect(isTemporaryCwd("c:\\users\\me\\appdata\\local\\temp\\probe", windows)).toBe(true);
    expect(isTemporaryCwd("C:/Users/Me/AppData/Local/Temp/probe", windows)).toBe(true);
    expect(isTemporaryCwd("C:\\Users\\Me\\Projects", windows)).toBe(false);
  });

  it("keeps case on a POSIX root", () => {
    expect(isTemporaryCwd("/TMP/x", ["/tmp"])).toBe(false);
  });
});

describe("historyPromptOf", () => {
  it("reads the prompt, its session and its time", () => {
    expect(historyPromptOf({ display: " fix lint ", sessionId: "s1", timestamp: 1795074973647, project: "/w" })).toEqual({
      sessionId: "s1",
      text: "fix lint",
      at: 1795074973647,
    });
  });

  it("caps the text", () => {
    expect(historyPromptOf({ display: "z".repeat(TURN_TEXT_CAP + 5), sessionId: "s" })?.text.length).toBe(TURN_TEXT_CAP);
  });

  it.each([
    ["no session (older lines)", { display: "x", timestamp: 1 }],
    ["an empty prompt", { display: "  ", sessionId: "s" }],
    ["wrong types", { display: 3, sessionId: {} }],
    ["an empty record", {}],
  ])("skips %s", (_label, record) => {
    expect(historyPromptOf(record)).toBeNull();
  });

  it("keeps a prompt whose time is unreadable, with no time", () => {
    expect(historyPromptOf({ display: "x", sessionId: "s", timestamp: "yesterday" })?.at).toBeNull();
  });
});

describe("resumePlan", () => {
  const remembered = { size: 100, mtimeMs: 5, scannedTo: 90 };

  it.each([
    ["never seen", null, { size: 10, mtimeMs: 1 }, { kind: "restart" }],
    ["unchanged and read to the end", { size: 100, mtimeMs: 5, scannedTo: 100 }, { size: 100, mtimeMs: 5 }, { kind: "skip" }],
    ["unchanged but not read to the end", remembered, { size: 100, mtimeMs: 5 }, { kind: "resume", from: 90 }],
    ["grew", remembered, { size: 150, mtimeMs: 6 }, { kind: "resume", from: 90 }],
    ["shrank", remembered, { size: 50, mtimeMs: 6 }, { kind: "restart" }],
    ["rewritten at the same size", remembered, { size: 100, mtimeMs: 6 }, { kind: "restart" }],
    ["an offset past the end", { size: 100, mtimeMs: 5, scannedTo: 500 }, { size: 120, mtimeMs: 6 }, { kind: "restart" }],
    ["empty, still empty", { size: 0, mtimeMs: 5, scannedTo: 0 }, { size: 0, mtimeMs: 5 }, { kind: "skip" }],
  ] as const)("%s", (_label, before, stamp, expected) => {
    expect(resumePlan(before, stamp)).toEqual(expected);
  });
});

describe("unlessReplaced", () => {
  const resume = { kind: "resume", from: 9 } as const;

  it.each([
    ["the same ends", { head: "h", tail: "t" }, { head: "h", tail: "t" }, resume],
    ["no tail recorded (a pass stopped between batches)", { head: "h", tail: null }, { head: "h", tail: "t" }, { kind: "restart" }],
    ["a different head", { head: "h", tail: "t" }, { head: "x", tail: "t" }, { kind: "restart" }],
    ["a different tail", { head: "h", tail: "t" }, { head: "h", tail: "x" }, { kind: "restart" }],
    ["nothing remembered", null, { head: "h", tail: null }, { kind: "restart" }],
  ] as const)("%s", (_label, remembered, current, expected) => {
    expect(unlessReplaced(resume, remembered, current)).toEqual(expected);
  });

  it("leaves a skip or a restart alone", () => {
    expect(unlessReplaced({ kind: "skip" }, null, { head: "h", tail: null })).toEqual({ kind: "skip" });
    expect(unlessReplaced({ kind: "restart" }, { head: "h", tail: "t" }, { head: "x", tail: "y" })).toEqual({ kind: "restart" });
  });
});

describe("search text", () => {
  it("escapes what LIKE would read as a pattern", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
    expect(escapeLike("plain")).toBe("plain");
  });

  it("quotes a query as one FTS phrase, doubling any quote", () => {
    expect(ftsPhrase("worktree")).toBe('"worktree"');
    expect(ftsPhrase('say "hi" OR x')).toBe('"say ""hi"" OR x"');
  });

  it("cuts the text around the first match, without case", () => {
    const text = `${"a".repeat(100)} Subtitle burn ${"b".repeat(100)}`;
    const snippet = snippetAround(text, "subtitle", 10);
    expect(snippet).toBe(`…${"a".repeat(9)} Subtitle burn bbbb…`);
  });

  it("shows the start when nothing matches, and collapses whitespace", () => {
    expect(snippetAround("line one\n\n  line two", "absent", 5)).toBe("line one l…");
    expect(snippetAround("short", "", 5)).toBe("short");
    expect(snippetAround("", "x")).toBe("");
  });
});
