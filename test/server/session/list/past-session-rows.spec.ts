import { describe, it, expect } from "vitest";
import { findPastSession, mergePastSessionRows, type AgentSessionRows } from "../../../../server/session/list/past-session-rows";
import type { TerminalAgent } from "../../../../common/sessionAgent";

const readable = (agent: TerminalAgent): boolean => agent === "claude" || agent === "codex";

describe("mergePastSessionRows", () => {
  it("merges every agent's rows newest first and marks the reader-less agents", () => {
    const perAgent: AgentSessionRows[] = [
      { agent: "claude", rows: [{ id: "c1", title: "old claude", mtime: 10 }] },
      { agent: "grok", rows: [{ id: "g1", title: "grok", mtime: 30 }] },
      { agent: "codex", rows: [{ id: "x1", title: "codex", mtime: 20, account: "work" }] },
    ];
    expect(mergePastSessionRows(perAgent, readable, 50)).toEqual([
      { id: "g1", title: "grok", mtime: 30, agent: "grok", readable: false },
      { id: "x1", title: "codex", mtime: 20, agent: "codex", readable: true, account: "work" },
      { id: "c1", title: "old claude", mtime: 10, agent: "claude", readable: true },
    ]);
  });

  it("caps the merged list, not each agent", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `id${i}`, title: "t", mtime: i }));
    const merged = mergePastSessionRows(
      [
        { agent: "claude", rows },
        { agent: "codex", rows: rows.map((r) => ({ ...r, id: `x${r.id}`, mtime: r.mtime + 0.5 })) },
      ],
      readable,
      3,
    );
    expect(merged.map((r) => r.id)).toEqual(["xid4", "id4", "xid3"]);
  });

  it("omits a null or empty account rather than sending it — Firestore rejects undefined", () => {
    const merged = mergePastSessionRows(
      [
        {
          agent: "codex",
          rows: [
            { id: "a", title: "t", mtime: 1, account: null },
            { id: "b", title: "t", mtime: 0, account: "" },
          ],
        },
      ],
      readable,
      50,
    );
    merged.forEach((row) => expect("account" in row).toBe(false));
  });

  it("falls back to the id for an empty title and to 0 for a non-finite mtime", () => {
    const [row] = mergePastSessionRows([{ agent: "claude", rows: [{ id: "a", title: "", mtime: Number.NaN }] }], readable, 50);
    expect(row).toMatchObject({ title: "a", mtime: 0 });
  });

  it("drops a row with no id, and answers nothing for no agents, an empty agent or a non-positive limit", () => {
    expect(mergePastSessionRows([{ agent: "claude", rows: [{ id: "", title: "t", mtime: 1 }] }], readable, 50)).toEqual([]);
    expect(mergePastSessionRows([], readable, 50)).toEqual([]);
    expect(mergePastSessionRows([{ agent: "claude", rows: [] }], readable, 50)).toEqual([]);
    expect(mergePastSessionRows([{ agent: "claude", rows: [{ id: "a", title: "t", mtime: 1 }] }], readable, 0)).toEqual([]);
    expect(mergePastSessionRows([{ agent: "claude", rows: [{ id: "a", title: "t", mtime: 1 }] }], readable, -1)).toEqual([]);
  });
});

describe("findPastSession", () => {
  const rows = mergePastSessionRows([{ agent: "claude", rows: [{ id: "a", title: "t", mtime: 1 }] }], readable, 50);

  it("finds a listed id", () => {
    expect(findPastSession(rows, "a")?.agent).toBe("claude");
  });

  it("answers null for an id the list does not hold, including an empty one and a prefix", () => {
    expect(findPastSession(rows, "b")).toBeNull();
    expect(findPastSession(rows, "")).toBeNull();
    expect(findPastSession([], "a")).toBeNull();
    expect(findPastSession(mergePastSessionRows([{ agent: "claude", rows: [{ id: "abc", title: "t", mtime: 1 }] }], readable, 50), "ab")).toBeNull();
  });
});
