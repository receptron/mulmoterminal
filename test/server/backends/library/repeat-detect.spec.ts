// @vitest-environment node
// Which instructions count as typed again and again (#3334): every rule both ways — what is counted
// and the near miss that is not.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  countedInstructions,
  instructionKey,
  joinAlike,
  occurrencesOf,
  REPEAT_COMPARED_MAX,
  REPEAT_OCCURRENCES_MAX,
  REPEAT_PAIR_HOLDERS_MAX,
  isCommand,
  repeatCandidates,
  repeatId,
  REPEAT_CLOSE_MAX_CHARS,
  REPEAT_CLOSE_SIMILARITY,
  REPEAT_MIN_KEY_CHARS,
  REPEAT_WINDOW_MS,
  similarity,
  type RepeatPrompt,
  type RepeatRules,
} from "../../../../server/backends/library/repeat-detect.js";
import { REPEAT_MIN_COUNT, REPEAT_MIN_SESSIONS } from "../../../../common/libraryRepeats.js";

const NOW = 1_000_000_000_000;
const rules = (over: Partial<RepeatRules> = {}): RepeatRules => ({
  now: NOW,
  isAutomatedSession: () => false,
  isTemporaryProject: (project) => project.startsWith("/tmp/"),
  ...over,
});
let atStep = 0;
const prompt = (text: string, sessionId: string, project: string | null = "/w/app", at = NOW - ++atStep): RepeatPrompt => ({ text, sessionId, project, at });
/** A different prompt for every session, alike to no other: hex from the session's id. */
const otherPrompt = (sessionId: string): string => createHash("sha256").update(sessionId).digest("hex");
/** A session holding `text` and one other typed prompt, so it is a conversation and not a one-shot. */
const inSession = (text: string, sessionId: string, project: string | null = "/w/app"): RepeatPrompt[] => [
  prompt(text, sessionId, project),
  prompt(otherPrompt(sessionId), sessionId, project),
];
const counted = (prompts: RepeatPrompt[], over: Partial<RepeatRules> = {}): string[] => countedInstructions(prompts, rules(over)).map((p) => p.text);

describe("instructionKey", () => {
  it("sets aside width, case, spacing and punctuation", () => {
    expect(instructionKey("CI 通ったら、マージして！")).toBe(instructionKey("ci通ったらマージして"));
    expect(instructionKey("ＣＩ　ｇｒｅｅｎ")).toBe(instructionKey("CI green"));
  });

  it("stands every link in for one word, so the address does not decide", () => {
    expect(instructionKey("fix https://github.com/o/r/issues/1")).toBe(instructionKey("fix  http://example.com/x?y=2"));
    expect(instructionKey("fix https://a.example/1")).not.toBe(instructionKey("fix it"));
  });

  it("keeps the words that differ", () => {
    expect(instructionKey("マージして")).not.toBe(instructionKey("マージした"));
  });
});

describe("isCommand", () => {
  it("is a slash command or a shell line, leading spaces aside", () => {
    expect(["/clear", "  /codex-cross-review", "! sh x.sh", "!ls"].map(isCommand)).toEqual([true, true, true, true]);
    expect(["merge it", "a/b please", "do it!", "1/2"].map(isCommand)).toEqual([false, false, false, false]);
  });
});

describe("countedInstructions", () => {
  it("counts what a person typed in a conversation", () => {
    expect(counted(inSession("commit and open a PR", "s1"))).toContain("commit and open a PR");
  });

  it("leaves out commands, shell lines and a paste's placeholder", () => {
    const session = [prompt("/clear", "s1"), prompt("! sh run.sh", "s1"), prompt("[Pasted text #1]", "s1"), prompt("[Pasted text #2 +5 lines]", "s1")];
    expect(counted([...session, ...inSession("keep this one going", "s1")])).toEqual(["keep this one going", otherPrompt("s1")]);
    expect(counted([...inSession("[Pasted text] please", "s2")])).toContain("[Pasted text] please");
  });

  it("leaves out a session with a single typed prompt, commands not counting", () => {
    expect(counted([prompt("reply with the single character: .", "probe"), prompt("/rate-limit-options", "probe")])).toEqual([]);
    expect(counted([prompt("reply with the single character: .", "s1"), prompt("and one more thing here", "s1")])).toHaveLength(2);
  });

  it("leaves out automated sessions and temp-directory projects", () => {
    expect(counted(inSession("run the nightly report now", "auto"), { isAutomatedSession: (id) => id === "auto" })).toEqual([]);
    expect(counted(inSession("run the nightly report now", "s1", "/tmp/probe"))).toEqual([]);
    expect(counted(inSession("run the nightly report now", "s1", null))).toHaveLength(2);
  });

  it("leaves out replies shorter than the bound, and keeps one at it", () => {
    const atBound = "a".repeat(REPEAT_MIN_KEY_CHARS);
    const under = "b".repeat(REPEAT_MIN_KEY_CHARS - 1);
    expect(counted([prompt(atBound, "s1"), prompt(under, "s1"), prompt("はい", "s1")])).toEqual([atBound]);
  });

  it("counts within the window, up to its edge", () => {
    const old = [
      prompt("an instruction from long ago", "s1", "/w", NOW - REPEAT_WINDOW_MS - 1),
      prompt("just at the window's edge", "s1", "/w", NOW - REPEAT_WINDOW_MS),
    ];
    expect(counted([...old, prompt("and something from today", "s1")])).toEqual(["just at the window's edge", "and something from today"]);
  });
});

describe("repeatCandidates", () => {
  const typedIn = (text: string, sessions: string[], project = "/w/app"): RepeatPrompt[] => sessions.flatMap((id) => inSession(text, id, project));

  it("is a candidate at the counts, and not one short of either", () => {
    const sessions = Array.from({ length: REPEAT_MIN_COUNT }, (_, at) => `s${String(at % REPEAT_MIN_SESSIONS)}`);
    expect(repeatCandidates(typedIn("merge when CI passes", sessions), rules()).map((c) => c.text)).toContain("merge when CI passes");
    expect(repeatCandidates(typedIn("merge when CI passes", sessions.slice(1)), rules()).map((c) => c.text)).not.toContain("merge when CI passes");
    const oneSession = Array.from({ length: REPEAT_MIN_COUNT + 2 }, () => "only");
    expect(repeatCandidates(typedIn("merge when CI passes", oneSession), rules()).map((c) => c.text)).not.toContain("merge when CI passes");
  });

  it("groups short instructions alike in one project, and keeps apart ones from another", () => {
    const sameProject = [...typedIn("CI通ったらマージして", ["a", "b"]), ...typedIn("CI が通ったらマージして", ["c"])];
    expect(repeatCandidates(sameProject, rules()).find((c) => c.text.includes("マージ"))?.count).toBe(3);
    const twoProjects = [...typedIn("CI通ったらマージして", ["a", "b"], "/w/one"), ...typedIn("CI が通ったらマージして", ["c"], "/w/two")];
    expect(repeatCandidates(twoProjects, rules()).filter((c) => c.text.includes("マージ"))).toEqual([]);
  });

  it("groups two short instructions at the similarity bound, and not ones below it", () => {
    const atBound = [...typedIn("publishした", ["a", "b"]), ...typedIn("publishしよう", ["c"])];
    expect(repeatCandidates(atBound, rules()).find((c) => c.text.startsWith("publish"))?.count).toBe(3);
    const below = [...typedIn("コミットしてPR作って", ["a", "b"]), ...typedIn("修正してPR作って", ["c"])];
    expect(repeatCandidates(below, rules()).filter((c) => c.text.endsWith("PR作って"))).toEqual([]);
  });

  it("groups the same words across projects", () => {
    const spread = [...typedIn("コミットしてPR作って", ["a"], "/w/one"), ...typedIn("コミットして PR 作って", ["b", "c"], "/w/two")];
    expect(repeatCandidates(spread, rules()).find((c) => c.text.includes("PR"))).toMatchObject({ count: 3, sessions: 3, projects: ["/w/two", "/w/one"] });
  });

  it("does not compare long instructions for being alike", () => {
    const long = (end: string): string => `${"please read the whole plan file and then ".repeat(3)}${end}`;
    expect([...long("go")].length).toBeGreaterThan(REPEAT_CLOSE_MAX_CHARS);
    const prompts = [...typedIn(long("go"), ["a", "b"]), ...typedIn(long("do"), ["c"])];
    expect(repeatCandidates(prompts, rules()).filter((c) => c.text.startsWith("please"))).toEqual([]);
  });

  it("says the most typed form, the others, where, and when last", () => {
    const prompts = [...typedIn("mergeした", ["a", "b"], "/w/app"), ...typedIn("merge した", ["c"], "/w/app")];
    const [candidate] = repeatCandidates(prompts, rules());
    expect(candidate).toMatchObject({ text: "mergeした", variants: ["mergeした", "merge した"], count: 3, sessions: 3, projects: ["/w/app"] });
    expect(candidate?.id).toMatch(/^[0-9a-f]{16}$/);
    expect(candidate?.id).toBe(repeatId(instructionKey("mergeした")));
    expect(candidate?.lastAt).toBe(Math.max(...prompts.filter((p) => p.text.startsWith("merge")).map((p) => p.at)));
  });

  it("orders the most typed first", () => {
    const prompts = [
      ...typedIn("publish the package", ["a", "b", "c"]),
      ...typedIn("publish the package", ["d"]),
      ...typedIn("open a pull request", ["e", "f", "g"]),
    ];
    expect(
      repeatCandidates(prompts, rules())
        .map((c) => c.text)
        .slice(0, 2),
    ).toEqual(["publish the package", "open a pull request"]);
  });
});

describe("similarity", () => {
  const pairs = (key: string): Set<string> => new Set([...key].slice(1).map((char, at) => `${[...key][at] ?? ""}${char}`));

  it("is the share of letter pairs in common, and the bound sits between alike and not", () => {
    expect(similarity(pairs("abcd"), pairs("abcd"))).toBe(1);
    expect(similarity(pairs("abcd"), pairs("wxyz"))).toBe(0);
    expect(similarity(pairs(instructionKey("CI通ったらマージして")), pairs(instructionKey("CIが通ったらマージして")))).toBeGreaterThanOrEqual(
      REPEAT_CLOSE_SIMILARITY,
    );
    expect(similarity(pairs(instructionKey("マージして")), pairs(instructionKey("マージしてタグ打って")))).toBeLessThan(REPEAT_CLOSE_SIMILARITY);
  });
});

describe("joinAlike", () => {
  const recording = () => {
    const joined: Array<[string, string]> = [];
    return { joined, groups: { find: (key: string) => key, join: (a: string, b: string) => void joined.push([a, b]) } };
  };

  it("does work bounded per key, however many keys share a common pair", () => {
    const keys = Array.from({ length: 2000 }, (_, at) => `して${createHash("sha256").update(String(at)).digest("hex").slice(0, 12)}`);
    const pairsPerKey = Math.max(...keys.map((key) => [...key].length - 1));
    const { groups } = recording();
    const work = joinAlike(keys, groups);
    expect(work.compared).toBeLessThanOrEqual(keys.length * REPEAT_COMPARED_MAX);
    expect(work.counted).toBeLessThanOrEqual(keys.length * pairsPerKey * REPEAT_PAIR_HOLDERS_MAX);
    // The common pair alone would have been counted through for every key, against every key.
    expect(work.counted).toBeLessThan(keys.length * keys.length);
  });

  it("still joins alike keys hidden among many that share only a common pair", () => {
    const crowd = Array.from({ length: 1000 }, (_, at) => `して${createHash("sha256").update(String(at)).digest("hex").slice(0, 12)}`);
    const alike = [instructionKey("CI通ったらマージして"), instructionKey("CIが通ったらマージして")];
    const { joined, groups } = recording();
    joinAlike([...crowd, ...alike], groups);
    expect(joined.map((pair) => [...pair].sort())).toContainEqual([...alike].sort());
  });
});

describe("occurrencesOf", () => {
  it("carries the latest ones only, newest first", () => {
    const members = Array.from({ length: REPEAT_OCCURRENCES_MAX + 10 }, (_, at) => prompt("merge it now please", `s${String(at)}`, "/w", at));
    const latest = occurrencesOf(members);
    expect(latest).toHaveLength(REPEAT_OCCURRENCES_MAX);
    expect(latest[0]?.at).toBe(REPEAT_OCCURRENCES_MAX + 9);
    expect(latest.at(-1)?.at).toBe(10);
  });
});
