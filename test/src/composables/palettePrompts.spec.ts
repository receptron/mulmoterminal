import { describe, it, expect } from "vitest";
import { palettePrompts, promptFirstLine, promptSourceOf } from "../../../src/composables/palettePrompts";

describe("promptSourceOf", () => {
  it("is the cell's session, agent and input slot for an agent terminal", () => {
    expect(promptSourceOf({ uid: 3, session: "s", cwd: "/w", agent: "codex" })).toEqual({
      uid: 3,
      slotKey: "cell-3",
      session: "s",
      agent: "codex",
      cwd: "/w",
      host: null,
    });
  });

  it("reads Claude's history for a cell that names no agent, a custom agent's included", () => {
    expect(promptSourceOf({ uid: 3, session: "s", cwd: null })?.agent).toBe("claude");
    expect(promptSourceOf({ uid: 3, session: "s", cwd: null, customAgent: "nemo" })?.agent).toBe("claude");
  });

  it("has none for a cell that has sent nothing, a launcher, a command, or no cell", () => {
    expect(promptSourceOf({ uid: 3, session: null, cwd: "/w" })).toBeNull();
    expect(promptSourceOf({ uid: 3, session: "s", cwd: "/w", launcher: { shell: true, label: "shell" } })).toBeNull();
    expect(promptSourceOf({ uid: 3, session: "s", cwd: "/w", command: { source: "script", index: 0, label: "t", cwd: "/w" } })).toBeNull();
    expect(promptSourceOf(null)).toBeNull();
  });
});

describe("palettePrompts", () => {
  it("lists the newest first, each keeping its place as read and the terminal it came from", () => {
    const source = { uid: 3, slotKey: "cell-3", session: "s", agent: "claude" as const, cwd: null, host: null };
    const read = [
      { at: 1, text: "old" },
      { at: 2, text: "new" },
    ];
    expect(palettePrompts(read, source)).toEqual([
      { index: 0, text: "new", uid: 3, slotKey: "cell-3" },
      { index: 1, text: "old", uid: 3, slotKey: "cell-3" },
    ]);
  });
});

describe("promptFirstLine", () => {
  it("names a prompt by its first line with words on it", () => {
    expect(promptFirstLine("\n  fix the login\nthen the tests")).toBe("fix the login");
    expect(promptFirstLine("one line")).toBe("one line");
  });

  it("falls back to the whole text when no line has words", () => {
    expect(promptFirstLine("   ")).toBe("");
  });
});
