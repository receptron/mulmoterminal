import { describe, it, expect } from "vitest";
import { AGENT_TITLE_MAX } from "../../../common/agentTitle";
import { rosterRow, fallbackLabel, type RosterLookups, type RowChrome } from "../../../src/components/rosterRow";
import type { Cell } from "../../../src/components/gridTabs";
import type { SessionMetaView } from "../../../src/components/rosterPhase";

// The four lookups the grid holds, each on its own key. Empty by default so every case here says
// what it put in.
const lookups = (over: Partial<RosterLookups> = {}): RosterLookups => ({
  meta: () => undefined,
  chrome: () => undefined,
  phase: () => undefined,
  status: () => undefined,
  ...over,
});

const cell = (over: Partial<Cell> = {}): Cell => ({ uid: 1, cwd: "/a", session: "s1", ...over }) as unknown as Cell;

const META: SessionMetaView = {
  lastPrompt: "fix the parser",
  aiTitle: "Parser fix",
  customTitle: null,
  peerName: null,
  agentTitle: null,
  agentTitleKind: null,
  lastResponse: "done",
  memo: "before the demo",
  workPhase: "implementing",
  collection: { slug: "invoices", icon: "receipt_long", title: "Invoices" },
};
const CHROME: RowChrome = { headerColor: "#111", headerTextColor: "#fff", iconUrl: "/logo.png" };

describe("rosterRow — the peer name (#3237)", () => {
  it("carries the name other Claude Code sessions message the cell by, or null", () => {
    expect(rosterRow(cell(), lookups({ meta: () => ({ ...META, peerName: "proj-7f" }) })).peerName).toBe("proj-7f");
    expect(rosterRow(cell(), lookups({ meta: () => META })).peerName).toBeNull();
    expect(rosterRow(cell(), lookups()).peerName).toBeNull();
  });
});

describe("rosterRow — the summary line (#2123)", () => {
  it("shows the /rename name over the AI title", () => {
    const row = rosterRow(cell(), lookups({ meta: () => ({ ...META, customTitle: "Parser rewrite" }) }));
    expect(row.summary).toBe("Parser rewrite");
  });

  // Claude's own AI title and the agent's store label are DISJOINT: `aiTitle` is null for every
  // non-claude agent, `agentTitle` is null for claude. So the `??` is a merge of two sources, not a
  // preference between two answers for one cell — and that is why it can share the label.
  it("shows claude's AI title when there is one", () => {
    const row = rosterRow(cell(), lookups({ meta: () => ({ ...META, aiTitle: "Parser fix", agentTitle: null }) }));
    expect(row.summary).toBe("Parser fix");
  });

  it("falls back to what the agent's own store calls the session", () => {
    const row = rosterRow(
      cell(),
      lookups({ meta: () => ({ ...META, aiTitle: null, agentTitle: "rewrite the parser", agentTitleKind: "opening-prompt" as const }) }),
    );
    expect(row.summary).toBe("rewrite the parser");
  });

  // The blank line this issue is about: an agent whose store cannot answer for one id yet.
  it("is null when neither source has anything", () => {
    const row = rosterRow(cell(), lookups({ meta: () => ({ ...META, aiTitle: null, agentTitle: null }) }));
    expect(row.summary).toBeNull();
  });

  // codex's and cursor's label IS the opening prompt, so a one-turn session has the same text in
  // both rows — and that is the state a cell is in for as long as it takes to answer the first
  // prompt, which is when the roster is being watched hardest.
  it("stands down when it would only restate the prompt row", () => {
    const meta = { ...META, aiTitle: null, agentTitle: "rewrite the parser", agentTitleKind: "opening-prompt" as const, lastPrompt: "rewrite the parser" };
    expect(rosterRow(cell(), lookups({ meta: () => meta })).summary).toBeNull();
  });

  // The label is a COLLAPSED and CAPPED form of that prompt, so on a long opening the two are never
  // equal — suppression has to recognise OUR OWN truncation, which is why the cap is shared.
  it("stands down for a prompt the label is our own truncation of", () => {
    const opening = "x".repeat(AGENT_TITLE_MAX);
    const meta = {
      ...META,
      aiTitle: null,
      agentTitle: opening,
      agentTitleKind: "opening-prompt" as const,
      lastPrompt: `${opening} and then a great deal more`,
    };
    expect(rosterRow(cell(), lookups({ meta: () => meta })).summary).toBeNull();
  });

  // The round-4 finding: a SHORTER opening that merely shares a beginning with the current prompt is
  // a different turn, and it is the session's actual start — exactly what the row carries.
  it("keeps a shorter opening that only shares a beginning with the prompt", () => {
    const meta = { ...META, aiTitle: null, agentTitle: "Fix parser", agentTitleKind: "opening-prompt" as const, lastPrompt: "Fix parser and add tests" };
    expect(rosterRow(cell(), lookups({ meta: () => meta })).summary).toBe("Fix parser");
  });

  // The reverse prefix direction is NOT safe, and suppressing on it hid real information: an opening
  // that says MORE than the current prompt is exactly what this row carries (Codex, round 2).
  it("keeps an opening that says more than the current prompt", () => {
    const meta = { ...META, aiTitle: null, agentTitle: "Fix parser and add tests", lastPrompt: "Fix parser" };
    expect(rosterRow(cell(), lookups({ meta: () => meta })).summary).toBe("Fix parser and add tests");
  });

  // Round 5: the cap may only be read as OUR truncation when the value came from an agent whose
  // label IS the opening prompt. copilot and muse write their own title, so a 200-character one that
  // happens to begin the prompt is an independent sentence and must stay.
  it("keeps a capped title an agent wrote for itself, even when it begins the prompt", () => {
    const title = "y".repeat(AGENT_TITLE_MAX);
    const meta = { ...META, aiTitle: null, agentTitle: title, agentTitleKind: "agent-summary" as const, lastPrompt: `${title} and more besides` };
    expect(rosterRow(cell(), lookups({ meta: () => meta })).summary).toBe(title);
  });

  // ...while the same shape from an opening-prompt agent is still our own cut, and stands down.
  it("still stands down for a capped OPENING prompt", () => {
    const opening = "y".repeat(AGENT_TITLE_MAX);
    const meta = { ...META, aiTitle: null, agentTitle: opening, agentTitleKind: "opening-prompt" as const, lastPrompt: `${opening} and more besides` };
    expect(rosterRow(cell(), lookups({ meta: () => meta })).summary).toBeNull();
  });

  // A title LONGER than the cap cannot be our own cut — nothing we produce exceeds it — so it comes
  // from somewhere unaccounted for and must show rather than be assumed a truncation.
  it("shows a title longer than the cap, which our own truncation can never produce", () => {
    const overlong = "z".repeat(AGENT_TITLE_MAX + 1);
    const meta = { ...META, aiTitle: null, agentTitle: overlong, agentTitleKind: "opening-prompt" as const, lastPrompt: `${overlong} and more` };
    expect(rosterRow(cell(), lookups({ meta: () => meta })).summary).toBe(overlong);
  });

  // The case the line exists for: the session has moved on, so its opening is news.
  it("shows the opening once the session has moved on", () => {
    const meta = { ...META, aiTitle: null, agentTitle: "rewrite the parser", agentTitleKind: "opening-prompt" as const, lastPrompt: "now run the tests" };
    expect(rosterRow(cell(), lookups({ meta: () => meta })).summary).toBe("rewrite the parser");
  });

  // Claude's is a SUMMARY, not a quote of the prompt, and must never be suppressed by this.
  it("never stands down for claude's own title, even against an identical prompt", () => {
    const meta = { ...META, aiTitle: "rewrite the parser", agentTitle: null, lastPrompt: "rewrite the parser" };
    expect(rosterRow(cell(), lookups({ meta: () => meta })).summary).toBe("rewrite the parser");
  });

  // A cleared claude session writes "" into the live title, and an empty string must not be
  // replaced by a store label the agent still holds — that would put a summary back on a row the
  // user just cleared.
  it("does not let the store label revive a cleared title", () => {
    const row = rosterRow(
      cell(),
      lookups({ meta: () => ({ ...META, aiTitle: "", agentTitle: "rewrite the parser", agentTitleKind: "opening-prompt" as const }) }),
    );
    expect(row.summary).toBe("");
  });
});

describe("rosterRow", () => {
  it("carries every field a row shows through from the four lookups", () => {
    const row = rosterRow(cell(), lookups({ meta: () => META, chrome: () => CHROME, phase: () => "ready", status: () => "working" }));
    expect(row).toEqual({
      uid: 1,
      cwd: "/a",
      agent: "claude",
      status: "working",
      memo: "before the demo",
      peerName: null,
      summary: "Parser fix",
      prompt: "fix the parser",
      response: "done",
      fallback: "starting…",
      title: "before the demo",
      phase: "ready",
      workPhase: "implementing",
      collection: { slug: "invoices", icon: "receipt_long", title: "Invoices" },
      headerColor: "#111",
      headerTextColor: "#fff",
      iconUrl: "/logo.png",
      parked: false,
      parkable: true,
      markable: true,
    });
  });

  // The property the whole shape rests on: a row is rendered whatever the caches hold, so no field
  // may come out undefined. A cell whose directory was never fetched, whose session has no meta and
  // whose status has not been reported is the ordinary state of a cell that just appeared.
  it("answers a complete row for a cell nothing is cached for", () => {
    const row = rosterRow(cell({ uid: 7, cwd: "/never-fetched", session: "unknown" }), lookups());
    expect(Object.values(row).every((v) => v !== undefined)).toBe(true);
    expect(row).toMatchObject({
      status: "idle",
      phase: "none",
      memo: null,
      summary: null,
      prompt: null,
      response: null,
      workPhase: null,
      collection: null,
      headerColor: null,
      headerTextColor: null,
      iconUrl: null,
    });
  });

  // A cell with no cwd must not be looked up under one: `""` and `null` are both "no directory",
  // and a map keyed by "" would answer for all of them.
  it("looks nothing up for a cell with no directory", () => {
    const asked: string[] = [];
    const look = lookups({ chrome: (cwd) => (asked.push(cwd), CHROME), phase: (cwd) => (asked.push(cwd), "ready") });
    expect(rosterRow(cell({ cwd: null }), look)).toMatchObject({ iconUrl: null, phase: "none" });
    expect(rosterRow(cell({ cwd: "" }), look)).toMatchObject({ iconUrl: null, phase: "none" });
    expect(asked).toEqual([]);
  });

  it("looks nothing up for a cell holding no session", () => {
    const asked: string[] = [];
    const look = lookups({ meta: (session) => (asked.push(session), META) });
    expect(rosterRow(cell({ session: null }), look)).toMatchObject({ prompt: null, collection: null });
    expect(asked).toEqual([]);
  });

  it("reports what the cell is running, not what it is standing in", () => {
    expect(rosterRow(cell({ session: null }), lookups()).agent).toBeNull();
    expect(rosterRow(cell({ session: null, launcher: { label: "dev" } } as Partial<Cell>), lookups()).agent).toBe("shell");
    expect(rosterRow(cell({ agent: "codex" } as Partial<Cell>), lookups()).agent).toBe("codex");
  });

  // `Cell.parked` is `true | undefined` — set aside is the presence of the key — while the row
  // carries a boolean the template can bind. The absent case must read false, not undefined.
  it("marks a parked cell, and answers false rather than nothing for one that is not", () => {
    expect(rosterRow(cell({ parked: true }), lookups()).parked).toBe(true);
    expect(rosterRow(cell(), lookups()).parked).toBe(false);
  });
});

describe("fallbackLabel", () => {
  it("names what the cell is running when nothing else has spoken yet", () => {
    expect(fallbackLabel(cell({ command: { label: "Build" } } as Partial<Cell>))).toBe("Build");
    expect(fallbackLabel(cell({ launcher: { label: "dev" } } as Partial<Cell>))).toBe("dev");
    expect(fallbackLabel(cell())).toBe("starting…");
    expect(fallbackLabel(cell({ session: null }))).toBe("empty");
  });
});

// What the row's ⋮ may offer (#2299): only a TerminalCell can be set aside, and only one holding a
// session has attention to mark.
describe("rosterRow — row menu capabilities", () => {
  const RUN = { label: "build" } as unknown as NonNullable<Cell["command"]>;
  const LAUNCHER = { label: "zsh" } as unknown as NonNullable<Cell["launcher"]>;
  it.each([
    ["a terminal with a session", cell(), true, true],
    ["a terminal still on its launch form", cell({ session: null }), true, false],
    ["a command cell", cell({ command: RUN }), false, false],
    ["a launcher cell", cell({ launcher: LAUNCHER }), false, false],
  ])("%s → parkable %s, markable %s", (_label, c, parkable, markable) => {
    const row = rosterRow(c, lookups());
    expect(row.parkable).toBe(parkable);
    expect(row.markable).toBe(markable);
  });
});

describe("rosterRow — the title a compact row keeps (#3270)", () => {
  const titleOf = (meta: Partial<SessionMetaView>, over: Partial<Cell> = {}) => rosterRow(cell(over), lookups({ meta: () => ({ ...META, ...meta }) })).title;

  it("goes memo, then /rename, then the AI title, then the last prompt", () => {
    expect(titleOf({ memo: "mine", customTitle: "renamed" })).toBe("mine");
    expect(titleOf({ memo: null, customTitle: "renamed" })).toBe("renamed");
    expect(titleOf({ memo: null })).toBe("Parser fix");
    expect(titleOf({ memo: null, aiTitle: null })).toBe("fix the parser");
  });

  // The cell header (cellHeaderText) never shows the agent-store title, so neither does this: a
  // codex row would otherwise go by its store title while its enlarged cell shows the prompt.
  it("skips the agent-store title the summary line shows", () => {
    const meta = { memo: null, aiTitle: null, agentTitle: "Store title", agentTitleKind: null, lastPrompt: "the prompt" };
    expect(rosterRow(cell(), lookups({ meta: () => ({ ...META, ...meta }) })).summary).toBe("Store title");
    expect(titleOf(meta)).toBe("the prompt");
  });

  it("falls back to what the cell runs, skipping empty tiers", () => {
    expect(titleOf({ memo: "", aiTitle: "", lastPrompt: null })).toBe("starting…");
    expect(rosterRow(cell({ session: null }), lookups()).title).toBe("empty");
  });
});
