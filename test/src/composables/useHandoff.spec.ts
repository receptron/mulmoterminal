import { describe, it, expect } from "vitest";
import { pickHandoffTargets, pullLastTurn, type HandoffDeps, type HandoffTarget } from "../../../src/composables/useHandoff";
import type { SlotInfo } from "../../../src/composables/readableSlot";

const slot = (key: string, agent: "claude" | "codex" = "claude", cwd: string | null = "/Users/me/work/proj", sessionId = `sess-${key}`): SlotInfo => ({
  key,
  sessionId,
  agent,
  cwd,
});

const target = (key = "cell-2"): HandoffTarget => ({ key, label: key, source: { sessionId: `sess-${key}`, cwd: "/w", agent: "claude" } });

const deps = (over: Partial<HandoffDeps>): HandoffDeps => ({
  fetchText: async () => "excerpt",
  paste: () => true,
  ...over,
});

describe("pickHandoffTargets", () => {
  it("lists the other cells with their number, agent, and directory", () => {
    const targets = pickHandoffTargets([slot("cell-1"), slot("cell-2", "codex")], "cell-1", "/Users/me");
    expect(targets).toEqual([
      { key: "cell-2", label: "#2 · codex · ~/work/proj", source: { sessionId: "sess-cell-2", cwd: "/Users/me/work/proj", agent: "codex" } },
    ]);
  });

  it("carries each cell's own session, so the pull reads that cell's log", () => {
    const targets = pickHandoffTargets([slot("cell-1"), slot("cell-2", "codex"), slot("cell-3")], "cell-1", null);
    expect(targets.map((t) => t.source.sessionId)).toEqual(["sess-cell-2", "sess-cell-3"]);
    expect(targets.map((t) => t.source.agent)).toEqual(["codex", "claude"]);
  });

  it("excludes the asking cell, so a session can't be pulled into itself", () => {
    expect(pickHandoffTargets([slot("cell-3")], "cell-3", null)).toEqual([]);
  });

  it("is empty when nothing else is connected", () => {
    expect(pickHandoffTargets([], "cell-1", null)).toEqual([]);
  });

  it("omits the directory for a slot the server hasn't resolved yet", () => {
    expect(pickHandoffTargets([slot("cell-2", "claude", null)], "cell-1", null)[0].label).toBe("#2 · claude");
  });

  it("falls back to the raw key for a non-grid slot", () => {
    expect(pickHandoffTargets([slot("single", "claude", null)], "cell-1", null)[0].label).toBe("single · claude");
  });
});

describe("pullLastTurn", () => {
  it("reads the CHOSEN cell's log and pastes into the asking cell", async () => {
    const read: string[] = [];
    const pasted: Array<[string, string]> = [];
    const error = await pullLastTurn(
      target("cell-2"),
      "cell-1",
      deps({
        fetchText: async (source) => (read.push(source.sessionId), "excerpt"),
        paste: (key, text) => (pasted.push([key, text]), true),
      }),
    );
    expect(error).toBeNull();
    expect(read).toEqual(["sess-cell-2"]); // the source is the cell that was picked...
    expect(pasted).toEqual([["cell-1", "excerpt"]]); // ...and the destination is the cell that asked
  });

  it("says there is nothing to bring over rather than pasting an empty block", async () => {
    let pasteCalls = 0;
    const error = await pullLastTurn(target(), "cell-1", deps({ fetchText: async () => "", paste: () => (pasteCalls++, true) }));
    expect(error).toBe("That terminal has no completed turn yet");
    expect(pasteCalls).toBe(0);
  });

  it("reports a failed read instead of throwing at the cell", async () => {
    const error = await pullLastTurn(
      target(),
      "cell-1",
      deps({
        fetchText: async () => {
          throw new Error("500");
        },
      }),
    );
    expect(error).toBe("Could not read that terminal's last turn");
  });

  it("reports when this cell's own socket has gone", async () => {
    expect(await pullLastTurn(target(), "cell-1", deps({ paste: () => false }))).toBe("This terminal is not connected");
  });
});
