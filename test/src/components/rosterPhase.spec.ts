import { describe, it, expect } from "vitest";
import { becameCiFailing, isPrPhase, phaseDisplay, WORK_WORD, type PrPhase, mergeSessionMeta, EMPTY_SESSION_META } from "../../../src/components/rosterPhase";
import { en } from "../../../src/i18n/en";

// `phaseDisplay` returns i18n KEYS now (#2182), and a key is just a string — a typo in one
// typechecks and renders `status.pr.draft.lable` on screen. So every assertion below resolves
// through the real English bundle, and an unresolvable key throws rather than comparing equal.
const t = (key: string): string => {
  const value = key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), en);
  if (typeof value !== "string") throw new Error(`no English message for ${key}`);
  return value;
};

describe("isPrPhase", () => {
  it.each(["none", "draft", "ci-failing", "changes-requested", "ci-running", "ready", "merged", "closed"])("accepts %s", (v) => {
    expect(isPrPhase(v)).toBe(true);
  });

  it.each([["unknown"], [""], [null], [undefined], [1]])("rejects %s", (v) => {
    expect(isPrPhase(v)).toBe(false);
  });
});

/** `phaseDisplay` is nullable only for "none"; every case below passes a real phase, so a null here
 *  is the test's own mistake and should say so rather than be asserted away. */
const shown = (phase: Exclude<PrPhase, "none">): NonNullable<ReturnType<typeof phaseDisplay>> => {
  const display = phaseDisplay(phase);
  if (display === null) throw new Error(`phaseDisplay returned null for ${phase}`);
  return display;
};

describe("phaseDisplay", () => {
  it("renders nothing for none (no PR yet)", () => {
    expect(phaseDisplay("none")).toBeNull();
  });

  it.each<[Exclude<PrPhase, "none">, string]>([
    ["draft", "draft"],
    ["ci-failing", "CI fail"],
    ["changes-requested", "changes"],
    ["ci-running", "CI…"],
    ["ready", "ready"],
    ["merged", "merged"],
    ["closed", "closed"],
  ])("gives %s the label %s with a fuller tooltip", (phase, label) => {
    const d = shown(phase);
    expect(t(d.label)).toBe(label);
    expect(t(d.title)).toMatch(/PR|Draft/);
  });

  // The two are for different places and must not collapse into one another: `title` stands alone,
  // `state` goes where the PR has ALREADY been named, and using `title` there reads
  // `PR #2689 · PR — CI running` (#1235). Translating them made that easy to lose, because a
  // translator seeing two near-identical English strings will happily give them one word.
  it.each<Exclude<PrPhase, "none">>(["draft", "ci-failing", "changes-requested", "ci-running", "ready", "merged", "closed"])(
    "keeps %s's standalone title apart from the wording used once the PR is named",
    (phase) => {
      const d = shown(phase);
      expect(d.title).not.toBe(d.state);
      // `state` is the one that must NOT re-announce the PR.
      expect(t(d.state)).not.toMatch(/PR/);
    },
  );

  // Every phase resolves in EVERY locale. The Messages type already forces each bundle to have the
  // same shape, so what this adds is that the keys rosterPhase.ts spells out are the keys that
  // shape actually contains — a typo is a string, and a string typechecks.
  it("resolves every phase's three keys in English", () => {
    const phases: Exclude<PrPhase, "none">[] = ["draft", "ci-failing", "changes-requested", "ci-running", "ready", "merged", "closed"];
    phases.forEach((phase) => {
      const d = shown(phase);
      [d.label, d.title, d.state].forEach((key) => expect(typeof t(key)).toBe("string"));
    });
  });

  it("resolves both work-phase words", () => {
    expect(t(WORK_WORD.planning)).toBe("planning");
    // "editing" rather than "implementing": the badge is tiny and the word is not the phase name.
    expect(t(WORK_WORD.implementing)).toBe("editing");
  });
});

describe("mergeSessionMeta — the agent's own store label (#2123)", () => {
  const shown = { ...EMPTY_SESSION_META, agentTitle: "rewrite the parser", agentTitleKind: "opening-prompt" as const };

  // An ABSENT field keeps what is shown — an older or partial answer is "we did not hear".
  it("keeps what it had when the answer does not carry the field at all", () => {
    expect(mergeSessionMeta(shown, {}).agentTitle).toBe("rewrite the parser");
  });

  // An EXPLICIT null wins, and this is the case the resolved-conversation key exists for: a cell
  // resumed onto another conversation keeps its session id, so this entry survives the switch. While
  // this merged like the text, the row kept showing the PREVIOUS conversation's opening until the
  // new one was titled (Codex, round 3).
  it("blanks when the store says there is none — a cell resumed onto another conversation", () => {
    expect(mergeSessionMeta(shown, { agentTitle: null }).agentTitle).toBeNull();
  });

  it("takes a new one when the store answers", () => {
    expect(mergeSessionMeta(shown, { agentTitle: "fix the failing spec" }).agentTitle).toBe("fix the failing spec");
  });

  // Every field here arrives as untrusted JSON, so a number must leave the previous value standing
  // rather than replacing it with junk.
  it("ignores an answer that is not a string", () => {
    expect(mergeSessionMeta(shown, { agentTitle: 7 }).agentTitle).toBe("rewrite the parser");
  });

  it("starts empty", () => {
    expect(EMPTY_SESSION_META.agentTitle).toBeNull();
  });
});

describe("mergeSessionMeta", () => {
  const shown = {
    lastPrompt: "fix the login bug",
    aiTitle: "Login fix",
    customTitle: null,
    peerName: null,
    agentTitle: null,
    agentTitleKind: null,
    lastResponse: "done",
    memo: "ship before the demo",
    workPhase: "implementing" as const,
    collection: null,
  };

  it("takes what the fetch returned", () => {
    const merged = mergeSessionMeta(shown, { lastPrompt: "new task", aiTitle: "New", lastResponse: "ok", memo: "review only", workPhase: "planning" });
    expect(merged).toEqual({
      lastPrompt: "new task",
      aiTitle: "New",
      customTitle: null,
      peerName: null,
      agentTitle: null,
      agentTitleKind: null,
      lastResponse: "ok",
      memo: "review only",
      workPhase: "planning",
      collection: null,
    });
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

  // The name the other Claude Code sessions message this one by (#3237) rides on the same fetch:
  // an explicit null (no running claude answers to the id) clears it, an absent field keeps it.
  it("carries the peer name, cleared only by an explicit null", () => {
    const named = mergeSessionMeta(shown, { peerName: "proj-7f" });
    expect(named.peerName).toBe("proj-7f");
    expect(mergeSessionMeta(named, { aiTitle: "x" }).peerName).toBe("proj-7f");
    expect(mergeSessionMeta(named, { peerName: 7 }).peerName).toBe("proj-7f");
    expect(mergeSessionMeta(named, { peerName: null }).peerName).toBeNull();
  });
  it("keeps the /rename name when the fetch omits it, and drops it on an explicit null", () => {
    const renamed = mergeSessionMeta(shown, { customTitle: "Parser rewrite" });
    expect(renamed.customTitle).toBe("Parser rewrite");
    expect(mergeSessionMeta(renamed, { aiTitle: "x" }).customTitle).toBe("Parser rewrite");
    expect(mergeSessionMeta(renamed, { customTitle: null }).customTitle).toBeNull();
    expect(mergeSessionMeta(renamed, { customTitle: 7 }).customTitle).toBe("Parser rewrite");
  });

  it("starts from nothing for a session it has not seen", () => {
    expect(mergeSessionMeta(EMPTY_SESSION_META, { lastPrompt: "first" })).toEqual({
      lastPrompt: "first",
      aiTitle: null,
      customTitle: null,
      peerName: null,
      agentTitle: null,
      agentTitleKind: null,
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
