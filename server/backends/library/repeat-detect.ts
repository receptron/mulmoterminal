// Which instructions a person types again and again (#3334). Pure: the prompts, the clock and what
// counts as an automated session are handed in.
//
// What is counted is what a person typed in a conversation: not a slash command or a shell line (they
// already run something), not a paste's placeholder (the text is elsewhere), not a prompt from a temp
// directory or an automated run, and not a session that holds a single typed prompt — a one-shot run,
// which is how scripted probes and scheduled tasks look in the log. What is left is grouped when its
// words match once case, spacing, punctuation and links are set aside, and short ones from the same
// project are grouped again when most of their letters match. A group typed REPEAT_MIN_COUNT times
// or more, in REPEAT_MIN_SESSIONS sessions or more, is a candidate.
import { createHash } from "node:crypto";
import { REPEAT_MIN_COUNT, REPEAT_MIN_SESSIONS, REPEAT_WINDOW_DAYS, type RepeatCandidate, type RepeatOccurrence } from "../../../common/libraryRepeats.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const REPEAT_WINDOW_MS = REPEAT_WINDOW_DAYS * DAY_MS;
/** Shorter than this once normalised is a reply ("ok", "はい"), not an instruction. */
export const REPEAT_MIN_KEY_CHARS = 6;
/** Only instructions this short are compared for being alike: a long one is a one-off. */
export const REPEAT_CLOSE_MAX_CHARS = 80;
/** How much of two instructions' letter pairs must be shared for them to count as one. */
export const REPEAT_CLOSE_SIMILARITY = 0.7;
/** A letter pair held by more keys than this ("して", "th") says little about which keys are alike,
 *  so it is not used to find the keys to compare. */
export const REPEAT_PAIR_HOLDERS_MAX = 200;
/** How many keys, those most alike to one by the pairs counted, are compared with it: what keeps the
 *  work linear in the number of keys whatever the log holds. */
export const REPEAT_COMPARED_MAX = 50;

export interface RepeatPrompt {
  text: string;
  sessionId: string;
  project: string | null;
  at: number;
}

export interface RepeatRules {
  now: number;
  isAutomatedSession(sessionId: string): boolean;
  isTemporaryProject(project: string): boolean;
}

// A paste stands in the log as `[Pasted text #1]` or `[Pasted text #1 +5 lines]`; its text is elsewhere.
const PASTE_PLACEHOLDERS = [/^\[Pasted text #\d+\]$/, /^\[Pasted text #\d+ \+\d+ lines\]$/];
const isPastePlaceholder = (text: string): boolean => PASTE_PLACEHOLDERS.some((form) => form.test(text));
const URL = /https?:\/\/\S+/giu;

/** A slash command or a shell line: something that already runs, not an instruction to repeat. */
export const isCommand = (text: string): boolean => /^[/!]/.test(text.trimStart());

/** What two instructions are compared by: width, case, links, spacing and punctuation set aside. */
export function instructionKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(URL, " url ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const typedCounts = (prompts: readonly RepeatPrompt[]): Map<string, number> => {
  const counts = new Map<string, number>();
  prompts.filter((prompt) => !isCommand(prompt.text)).forEach((prompt) => counts.set(prompt.sessionId, (counts.get(prompt.sessionId) ?? 0) + 1));
  return counts;
};

/** The prompts that count as instructions a person typed, each with its key. */
export function countedInstructions(prompts: readonly RepeatPrompt[], rules: RepeatRules): Array<RepeatPrompt & { key: string }> {
  const typed = typedCounts(prompts);
  return prompts
    .filter((prompt) => rules.now - prompt.at <= REPEAT_WINDOW_MS)
    .map((prompt) => ({ ...prompt, text: prompt.text.trim(), key: instructionKey(prompt.text) }))
    .filter((prompt) => prompt.text !== "" && !isCommand(prompt.text) && !isPastePlaceholder(prompt.text))
    .filter((prompt) => prompt.project === null || !rules.isTemporaryProject(prompt.project))
    .filter((prompt) => !rules.isAutomatedSession(prompt.sessionId) && (typed.get(prompt.sessionId) ?? 0) >= 2)
    .filter((prompt) => [...prompt.key].length >= REPEAT_MIN_KEY_CHARS);
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

const letterPairs = (key: string): Set<string> => {
  const chars = [...key];
  return new Set(chars.slice(1).map((char, at) => `${chars[at] ?? ""}${char}`));
};

/** The share of letter pairs two keys have in common. */
export function similarity(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter((pair) => b.has(pair)).length;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface KeyGroups {
  find(key: string): string;
  join(a: string, b: string): void;
}

function unionFind(): KeyGroups {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    parent.set(key, root);
    return root;
  };
  return { find, join: (a, b) => parent.set(find(a), find(b)) };
}

/** The keys after `key` most alike to it by the uncommon letter pairs they share — ranked by the share
 *  of both keys' pairs those make, not by how many they are, so a long key that holds all of a short
 *  one's pairs does not crowd out its real match — and how many holders it counted through. */
function closestKeys(key: string, own: Set<string>, pairs: Map<string, Set<string>>, holders: Map<string, string[]>): { closest: string[]; counted: number } {
  const shared = new Map<string, number>();
  let counted = 0;
  own.forEach((pair) => {
    const held = holders.get(pair) ?? [];
    if (held.length > REPEAT_PAIR_HOLDERS_MAX) return;
    counted += held.length;
    held.forEach((other) => {
      if (other > key) shared.set(other, (shared.get(other) ?? 0) + 1);
    });
  });
  const likeness = ([other, count]: [string, number]): number => count / (own.size + (pairs.get(other)?.size ?? 0) - count);
  const closest = [...shared.entries()]
    .map((entry): [string, number] => [entry[0], likeness(entry)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, REPEAT_COMPARED_MAX)
    .map(([other]) => other);
  return { closest, counted };
}

/** The work joinAlike did: holders counted through, and pairs of keys compared. */
export interface AlikeWork {
  counted: number;
  compared: number;
}

/** Joins the short keys of one project whose letter pairs mostly match, and answers the work done:
 *  holders counted through, at most REPEAT_PAIR_HOLDERS_MAX per letter pair of a key, and pairs of keys
 *  compared, at most REPEAT_COMPARED_MAX per key. A key is compared only with those sharing the most of
 *  its uncommon letter pairs, which alike keys do. */
export function joinAlike(keys: readonly string[], groups: KeyGroups): AlikeWork {
  const pairs = new Map(keys.map((key) => [key, letterPairs(key)]));
  const holders = new Map<string, string[]>();
  pairs.forEach((set, key) => set.forEach((pair) => pushTo(holders, pair, key)));
  const work: AlikeWork = { counted: 0, compared: 0 };
  keys.forEach((key) => {
    const own = pairs.get(key) ?? new Set<string>();
    const { closest, counted } = closestKeys(key, own, pairs, holders);
    work.counted += counted;
    closest.forEach((other) => {
      work.compared += 1;
      if (similarity(own, pairs.get(other) ?? new Set()) >= REPEAT_CLOSE_SIMILARITY) groups.join(key, other);
    });
  });
  return work;
}

const mostFirst = (values: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([value]) => value);
};

/** A stable id for a group: from its most typed key. */
export const repeatId = (key: string): string => createHash("sha256").update(key).digest("hex").slice(0, 16);

/** How many forms and directories one candidate names: the most typed ones. */
export const REPEAT_NAMED_MAX = 10;
/** How many candidates one answer lists: the most typed ones; `total` says how many there were. */
export const REPEAT_LISTED_MAX = 200;

/** A group as a candidate: its most typed form, its counts, where and when last. */
export function candidateOf(members: ReadonlyArray<RepeatPrompt & { key: string }>): RepeatCandidate {
  const variants = mostFirst(members.map((member) => member.text));
  return {
    id: repeatId(mostFirst(members.map((member) => member.key))[0] ?? ""),
    text: variants[0] ?? "",
    variants: variants.slice(0, REPEAT_NAMED_MAX),
    count: members.length,
    sessions: new Set(members.map((member) => member.sessionId)).size,
    projects: mostFirst(members.flatMap((member) => (member.project === null ? [] : [member.project]))).slice(0, REPEAT_NAMED_MAX),
    lastAt: Math.max(...members.map((member) => member.at)),
  };
}

/** The groups of counted instructions, each member kept. */
export function repeatGroups(prompts: readonly RepeatPrompt[], rules: RepeatRules): Array<Array<RepeatPrompt & { key: string }>> {
  const counted = countedInstructions(prompts, rules);
  const groups = unionFind();
  const shortByProject = new Map<string, Set<string>>();
  counted
    .filter((prompt) => [...prompt.text].length <= REPEAT_CLOSE_MAX_CHARS)
    .forEach((prompt) => shortByProject.set(prompt.project ?? "", (shortByProject.get(prompt.project ?? "") ?? new Set()).add(prompt.key)));
  shortByProject.forEach((keys) => joinAlike([...keys], groups));
  const byRoot = new Map<string, Array<RepeatPrompt & { key: string }>>();
  counted.forEach((prompt) => pushTo(byRoot, groups.find(prompt.key), prompt));
  return [...byRoot.values()].filter((members) => members.length >= REPEAT_MIN_COUNT && new Set(members.map((m) => m.sessionId)).size >= REPEAT_MIN_SESSIONS);
}

/** The candidates, most typed first. */
export function repeatCandidates(prompts: readonly RepeatPrompt[], rules: RepeatRules): RepeatCandidate[] {
  return repeatGroups(prompts, rules)
    .map(candidateOf)
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/** How many of the times a group was typed one answer carries: the view lists a few conversations and
 *  the skill reads a few; `count` still says how many there were. */
export const REPEAT_OCCURRENCES_MAX = 50;

/** The latest times a group was typed, newest first, at most REPEAT_OCCURRENCES_MAX. */
export const occurrencesOf = (members: ReadonlyArray<RepeatPrompt>): RepeatOccurrence[] =>
  [...members]
    .sort((a, b) => b.at - a.at)
    .slice(0, REPEAT_OCCURRENCES_MAX)
    .map(({ sessionId, project, at, text }) => ({ sessionId, project, at, text }));
