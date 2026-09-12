import { describe, it, expect } from "vitest";
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
  lastResponse: "done",
  memo: "before the demo",
  workPhase: "implementing",
  collection: { slug: "invoices", icon: "receipt_long", title: "Invoices" },
};
const CHROME: RowChrome = { headerColor: "#111", headerTextColor: "#fff", iconUrl: "/logo.png" };

describe("rosterRow", () => {
  it("carries every field a row shows through from the four lookups", () => {
    const row = rosterRow(cell(), lookups({ meta: () => META, chrome: () => CHROME, phase: () => "ready", status: () => "working" }));
    expect(row).toEqual({
      uid: 1,
      cwd: "/a",
      agent: "claude",
      status: "working",
      memo: "before the demo",
      summary: "Parser fix",
      prompt: "fix the parser",
      response: "done",
      fallback: "starting…",
      phase: "ready",
      workPhase: "implementing",
      collection: { slug: "invoices", icon: "receipt_long", title: "Invoices" },
      headerColor: "#111",
      headerTextColor: "#fff",
      iconUrl: "/logo.png",
      parked: false,
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
