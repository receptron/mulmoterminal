import { describe, it, expect } from "vitest";
import { becameCiFailing, isPrPhase, phaseDisplay, type PrPhase, mergeSessionMeta, EMPTY_SESSION_META } from "../../../src/components/rosterPhase";

describe("isPrPhase", () => {
  it.each(["none", "draft", "ci-failing", "changes-requested", "ci-running", "ready", "merged", "closed"])("accepts %s", (v) => {
    expect(isPrPhase(v)).toBe(true);
  });

  it.each([["unknown"], [""], [null], [undefined], [1]])("rejects %s", (v) => {
    expect(isPrPhase(v)).toBe(false);
  });
});

describe("phaseDisplay", () => {
  it("renders nothing for none (no PR yet)", () => {
    expect(phaseDisplay("none")).toBeNull();
  });

  it.each<[PrPhase, string]>([
    ["draft", "draft"],
    ["ci-failing", "CI fail"],
    ["changes-requested", "changes"],
    ["ci-running", "CI…"],
    ["ready", "ready"],
    ["merged", "merged"],
    ["closed", "closed"],
  ])("gives %s the label %s with a fuller tooltip", (phase, label) => {
    const d = phaseDisplay(phase);
    expect(d?.label).toBe(label);
    expect(d?.title).toMatch(/PR|Draft/);
  });
});

describe("mergeSessionMeta", () => {
  const shown = {
    lastPrompt: "fix the login bug",
    aiTitle: "Login fix",
    lastResponse: "done",
    memo: "ship before the demo",
    workPhase: "implementing" as const,
    collection: null,
  };

  it("takes what the fetch returned", () => {
    const merged = mergeSessionMeta(shown, { lastPrompt: "new task", aiTitle: "New", lastResponse: "ok", memo: "review only", workPhase: "planning" });
    expect(merged).toEqual({ lastPrompt: "new task", aiTitle: "New", lastResponse: "ok", memo: "review only", workPhase: "planning", collection: null });
  });

  // The text fields MERGE: the summary can transiently miss a transcript, and blanking every
  // row on the first poll that comes up empty strips the cockpit exactly when the user is
  // scanning it to decide which of nine agents to look at.
  it("keeps the text already on screen when the fetch has none", () => {
    const merged = mergeSessionMeta(shown, {});
    expect([merged.lastPrompt, merged.aiTitle, merged.lastResponse]).toEqual(["fix the login bug", "Login fix", "done"]);
  });

  // aiTitle is ours, held in memory with no transcript fallback, so a successful fetch answers
  // it outright: null means "there is none now". Merging it like the prompt is how a /clear'ed
  // session kept showing the title of the conversation the user had just ended (#1085).
  it("drops the summary when the fetch says there is none", () => {
    expect(mergeSessionMeta(shown, { aiTitle: null }).aiTitle).toBeNull();
  });

  // The memo follows aiTitle, not the prompt, for the same reason (#1105): it lives only in the
  // server's memo map, so a null is the user having ERASED it. Merged like the prompt, an erased
  // memo would come back on the very next poll — 4 seconds after the user cleared the box.
  it("keeps the memo when the fetch omits it, and erases it on a null", () => {
    expect(mergeSessionMeta(shown, {}).memo).toBe("ship before the demo");
    expect(mergeSessionMeta(shown, { memo: null }).memo).toBeNull();
    expect(mergeSessionMeta(shown, { memo: "rewritten" }).memo).toBe("rewritten");
  });

  // The other two DO fall back to the transcript, which can transiently miss — so for them a
  // null stays "no news". A session that has none sends "" (what /clear writes), which is a
  // value and merges through.
  it("keeps the prompt and reply on a null, and clears them on an empty string", () => {
    const nulled = mergeSessionMeta(shown, { lastPrompt: null, lastResponse: null });
    expect([nulled.lastPrompt, nulled.lastResponse]).toEqual(["fix the login bug", "done"]);
    const cleared = mergeSessionMeta(shown, { lastPrompt: "", lastResponse: "" });
    expect([cleared.lastPrompt, cleared.lastResponse]).toEqual(["", ""]);
  });

  // workPhase is the opposite: a successful fetch is authoritative, and null is a real state
  // ("no tools yet / not working"). Merge it like the text and a finished agent keeps a
  // "planning" badge forever.
  it("clears the phase when the fetch says there is none", () => {
    expect(mergeSessionMeta(shown, {}).workPhase).toBeNull();
    expect(mergeSessionMeta(shown, { workPhase: null }).workPhase).toBeNull();
  });

  it("refuses a phase value it does not recognise", () => {
    for (const workPhase of ["done", "", 1, {}, "PLANNING"]) {
      expect(mergeSessionMeta(shown, { workPhase }).workPhase).toBeNull();
    }
  });

  it("updates one text field without disturbing the others", () => {
    const merged = mergeSessionMeta(shown, { aiTitle: "Renamed" });
    expect([merged.lastPrompt, merged.aiTitle, merged.lastResponse]).toEqual(["fix the login bug", "Renamed", "done"]);
  });

  it("starts from nothing for a session it has not seen", () => {
    expect(mergeSessionMeta(EMPTY_SESSION_META, { lastPrompt: "first" })).toEqual({
      lastPrompt: "first",
      aiTitle: null,
      lastResponse: null,
      memo: null,
      workPhase: null,
      collection: null,
    });
  });

  // A fact about how the session BEGAN, so a successful fetch is authoritative and there is
  // nothing to preserve. Merged like the text instead, a row would keep the mark of the session
  // the cell used to hold after it moved to another one.
  it("takes the collection as-is, dropping the one it was showing", () => {
    const started = { ...shown, collection: { slug: "invoices", icon: "receipt_long", title: "Invoices" } };
    expect(mergeSessionMeta(started, { lastPrompt: "new" }).collection).toBeNull();
    expect(mergeSessionMeta(shown, { collection: { slug: "tasks", icon: "task", title: "Tasks" } }).collection).toEqual({
      slug: "tasks",
      icon: "task",
      title: "Tasks",
    });
  });

  it("ignores a malformed collection rather than showing half of one", () => {
    expect(mergeSessionMeta(shown, { collection: { slug: "tasks" } }).collection).toBeNull();
  });

  it("does not mutate what it was given", () => {
    const previous = { ...shown };
    mergeSessionMeta(previous, { lastPrompt: "new" });
    expect(previous).toEqual(shown);
  });
});

describe("becameCiFailing", () => {
  it("fires on the transition into a red CI", () => {
    expect(becameCiFailing("ci-running", "ci-failing")).toBe(true);
    expect(becameCiFailing("ready", "ci-failing")).toBe(true);
  });

  // The roster re-polls every few seconds while it is open. Without this, one red branch would
  // notify on every round for as long as the grid stayed on screen.
  it("stays quiet while it REMAINS failing", () => {
    expect(becameCiFailing("ci-failing", "ci-failing")).toBe(false);
  });

  // Opening the roster on a branch that was already red is not news — the same baseline-only
  // rule the activity stream uses on first sight of a session.
  it("stays quiet on first sight", () => {
    expect(becameCiFailing(undefined, "ci-failing")).toBe(false);
  });

  it("stays quiet for every other phase", () => {
    const others: PrPhase[] = ["none", "draft", "changes-requested", "ci-running", "ready", "merged", "closed"];
    for (const phase of others) expect(becameCiFailing("ci-failing", phase)).toBe(false);
  });
});
