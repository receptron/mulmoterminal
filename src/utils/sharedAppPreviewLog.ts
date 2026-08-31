// What happened in the preview, in one block an author can copy and hand to whoever is fixing it.
//
// THE PROBLEM THIS SOLVES, said plainly: an LLM writes the page, and it is the only thing in the
// loop that never runs it. When the author presses a button and nothing happens, what they can
// carry back is "it seems stuck" — and the facts that would settle it in one line are all on this
// machine, each one thrown away a moment after it arrives. The parent's refusals are answered on
// the port and never drawn. The frame's own errors die at the frame boundary. The write's real
// refusal — the one the deployed rules gave — lives in `formError[cid]` until the next attempt
// overwrites it.
//
// So they are kept, and rendered in the SAME words the headless run uses
// (`common/sharedAppViewVocabulary.ts`). One reader reads both.
//
// WHAT IS DELIBERATELY NOT IN HERE:
//
//   - Values, as far as this host chooses them. Field NAMES and collection ids, never what was typed
//     into them: a record in a shared app holds other people's answers, and this block is built to
//     be pasted somewhere else.
//
//     WITH ONE EXCEPTION, and it is stated rather than quietly true. A notice carries text the PAGE
//     wrote, and a page is handed whole records — `throw new Error(row.email)` puts that address in
//     here. It is kept anyway: it is the most actionable thing the frame produces ("slot is not
//     defined (line 12)" is the difference between a fix and a guess), the reader is the author on
//     their own machine, and dropping it would leave the notice saying only that something happened
//     somewhere. What follows from that choice is that the promise must be the narrow one — the
//     button says so, and so does the closing below. A regex that redacted addresses would be worse
//     than either: it would catch one shape of personal data and imply it had caught them all.
//   - The signed-in address. Whether there IS a session changes what the rules do; who it belongs
//     to does not.
//   - Anything on disk. The buffer is in memory and dies with the pane, which is said out loud on
//     the button — a diagnostic that persists is a place personal data accumulates, and something
//     somebody then has to delete.
//
// Design: `plans/feat-collection-pane-diagnostics.md` (the block, the masking, the ring buffer)
// and `plans/feat-shared-app-view-diagnostics.md` (why the facts do not reach the author today).
import type { IntentKind, ViewNoticeCode } from "@receptron/sharedapp/view";
import type { PreviewAudience } from "../../common/sharedAppPreview";
import type { PublicFace } from "../../common/sharedAppPublicFace";
import { explainRefusal, NOTICES, quoteForReport } from "../../common/sharedAppViewVocabulary";

/** How many events are kept. Older ones are dropped, and the block SAYS how many — a list that
 *  stops without saying so reads as the whole of what happened. */
export const PREVIEW_LOG_LIMIT = 200;

/** One thing that happened, in the host's vocabulary.
 *
 *  A closed union rather than a string and a bag, so that adding a kind of event means teaching the
 *  renderer to say it. An event nobody can render is collected for nobody. */
export type PreviewLogEvent =
  | { kind: "page"; id: string; audience: PreviewAudience }
  | { kind: "handshake" }
  | { kind: "state"; datasets: { cid: string; rows: number }[] }
  | { kind: "submitted"; cid: string; fields: string[] }
  | { kind: "refused"; reason: string }
  | { kind: "declined"; cid: string }
  | { kind: "write"; cid: string; error: string | null }
  /** A MOVE — a transition, an assignment, a withdrawal — and what became of it. A member's, or a
   *  visitor's own on the public page: one parent answers both and one route performs both.
   *
   *  Separate from `write`, which is a submission: the two fail for different reasons and an author
   *  reading "the write to 'questions' was REFUSED" about a button on their own desk would go
   *  looking at `public.submit`, which has nothing to do with it. `mailed` is here because it is
   *  the one effect of this path that cannot be taken back.
   *
   *  NO AUDIENCE. It carried one, to pick a vocabulary for the refusal — and there is one
   *  vocabulary now (`explainRefusal`), because with one parent the audience never said which kind
   *  of ask had been refused. */
  | {
      kind: "intent";
      intent: IntentKind;
      cid: string;
      itemId: string;
      /** Where it was going — a STATUS, and only ever a status.
       *
       *  An assignment's destination is a person's address, and this block is built to be pasted
       *  somewhere else: the promise at the top of this file is field names and never the values in
       *  a record. The sender withholds it and the renderer says so, rather than a caller being
       *  trusted to remember which kind of intent carries what. */
      to?: string;
      /** `correct` only: which fields it named. NAMES, never the values — see the sender, and the
       *  promise at the top of this file. */
      fields?: string[];
      error: string | null;
      mailed?: boolean;
    }
  /** The page asked to OPEN one of its articles, and this pane did not go anywhere.
   *
   *  NOT A PROBLEM, and deliberately not counted as one (`isProblem`): the pane has no browser
   *  history to push onto, and the published page will navigate. It is here because the alternative
   *  is a link that looks broken — the author clicks a headline in their own front page, nothing
   *  moves, and there is nothing anywhere to say whether the page asked or simply did nothing. */
  | { kind: "open"; cid: string; id: string }
  | { kind: "notice"; code: ViewNoticeCode; detail: string }
  | { kind: "host"; note: string };

export type PreviewLogEntry = PreviewLogEvent & { at: number };

/** Whether this is one of the things somebody is looking for.
 *
 *  A notice counts whatever its code: every one of them is a failure the browser swallowed, which
 *  is the entire reason the frame is made to report them. */
const isProblem = (entry: PreviewLogEntry): boolean =>
  entry.kind === "refused" ||
  entry.kind === "notice" ||
  entry.kind === "host" ||
  (entry.kind === "write" && entry.error !== null) ||
  (entry.kind === "intent" && entry.error !== null);

export interface PreviewLog {
  add: (event: PreviewLogEvent) => void;
  entries: () => PreviewLogEntry[];
  /** How many are held. Asked far more often than the entries themselves — the pane reads it after
   *  every event — so it does not go through a copy of the array. */
  size: () => number;
  /** How many fell off the front. */
  dropped: () => number;
  problems: () => number;
  clear: () => void;
}

/** The buffer.
 *
 *  NOT reactive, and that is not an optimisation — a Vue array redrawn on every push would give a
 *  page in an error loop a way to make the pane unusable. The counts are what the UI binds to, and
 *  the host keeps those in its own refs. */
export const createPreviewLog = (options?: { now?: () => number; limit?: number }): PreviewLog => {
  const now = options?.now ?? (() => Date.now());
  const limit = options?.limit ?? PREVIEW_LOG_LIMIT;
  let entries: PreviewLogEntry[] = [];
  let started: number | null = null;
  let dropped = 0;
  let problems = 0;
  return {
    add: (event) => {
      const at = now();
      if (started === null) started = at;
      const entry: PreviewLogEntry = { ...event, at: at - started };
      entries.push(entry);
      if (isProblem(entry)) problems += 1;
      if (entries.length <= limit) return;
      // The count describes what is HELD, so an evicted problem stops being counted. Left as a
      // running total it would disagree with the list under it — "3 problems" over one — and the
      // pane's amber would stay lit about events nothing can show any more. What was lost is said
      // by `dropped`, which is the honest way to say it.
      const evicted = entries[0];
      entries = entries.slice(entries.length - limit);
      dropped += 1;
      if (evicted !== undefined && isProblem(evicted)) problems -= 1;
    },
    entries: () => [...entries],
    size: () => entries.length,
    dropped: () => dropped,
    problems: () => problems,
    clear: () => {
      entries = [];
      started = null;
      dropped = 0;
      problems = 0;
    },
  };
};

/** A home directory folded away.
 *
 *  The same hole CLAUDE.md names about screenshots — "screenshots leak the maintainer's
 *  directories" — is open in a log, and this block is meant to be pasted. Matched by SHAPE rather
 *  than against the real home, because this runs in a browser and has no `os.homedir()` to ask. */
export const foldHome = (text: string): string => text.replace(/^\/(?:Users|home)\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");

/** What is true about the whole session, above the timeline.
 *
 *  Every field is something the pane already holds. Nothing here is fetched to fill the header in:
 *  a diagnostic that needs a round trip is one that will sometimes be pasted with a hole in it, and
 *  a hole in a header reads as a fact. What is NOT here for that reason: the signed-in address (the
 *  timeline reports a missing session where it matters — as a refused write — and who it belongs to
 *  is not the reader's business), and the app's URL name, which the projection does not carry. */
export interface PreviewLogHeader {
  version: string;
  aid: string;
  cwd: string | null;
  page: string | null;
  audience: PreviewAudience | null;
  publicFace: PublicFace;
  fromLiveApp: boolean;
}

const stamp = (ms: number): string => `+${(ms / 1000).toFixed(3)}`.padStart(9);

const datasetList = (datasets: { cid: string; rows: number }[]): string =>
  datasets.length === 0 ? "none — this app declares no datasets for this page" : datasets.map((set) => `${set.cid}=${set.rows}`).join(", ");

/** What one intent was ABOUT, in a phrase.
 *
 *  The RECORD is named, and its id is a value out of the app — which the header of this file says
 *  is not carried. It is carried for the same reason the id is a field on the record rather than a
 *  key inside it: a shared app's ids are what the RULES pin, so a refusal about an unnamed row is a
 *  refusal an author cannot place, and every one of these lines is about a row somebody pressed a
 *  button on.
 *
 *  An assignment's destination is a person's ADDRESS and is not carried (see the sender). The FACT
 *  of one is, because `unknown-assignee` is about the address that was named — a line mentioning no
 *  destination at all would read as an assignment to nobody.
 *
 *  A correction goes nowhere and names FIELDS instead. Listed rather than counted: "3 fields" is
 *  not something an author can compare against the form they just filled in. */
const intentSubject = (entry: PreviewLogEntry & { kind: "intent" }): string => {
  const row = `${entry.intent} of '${entry.cid}/${entry.itemId}'`;
  if (entry.fields !== undefined) {
    return `${row} (${entry.fields.join(", ")})`;
  }
  if (entry.to !== undefined) {
    return `${row} to '${entry.to}'`;
  }
  return entry.intent === "assign" ? `${row} to an address this log does not carry` : row;
};

const intentLine = (entry: PreviewLogEntry & { kind: "intent" }): string[] => {
  const what = intentSubject(entry);
  if (entry.error !== null) {
    return [`the ${what} was REFUSED:`, `  ${explainRefusal(entry.error)}`];
  }
  return [
    `PERFORMED the ${what}, as you, judged by the deployed rules`,
    ...(entry.mailed === true ? ["  a notice was QUEUED with it — real mail, to a real member"] : []),
  ];
};

/** One event, in the words of what a person would have seen. */
const lineFor = (entry: PreviewLogEntry): string[] => {
  switch (entry.kind) {
    case "page":
      return [`page '${entry.id}' (${entry.audience}) mounted`];
    case "handshake":
      return ["the page answered the handshake"];
    case "state":
      return [`the parent sent its records: ${datasetList(entry.datasets)}`];
    case "submitted":
      return [`the page submitted to '${entry.cid}' carrying ${entry.fields.length === 0 ? "no fields" : entry.fields.join(", ")}`];
    case "refused":
      // The half nobody can see. It is answered on the port, into a promise the page usually does
      // not await, so on screen this is a button that did nothing.
      return [`REFUSED by the parent — ${explainRefusal(entry.reason)}`];
    case "declined":
      return [`the confirmation for '${entry.cid}' was declined — nothing was written`];
    case "write":
      return entry.error === null
        ? [`WROTE a real record to '${entry.cid}', as you, judged by the deployed rules`]
        : [`the write to '${entry.cid}' was REFUSED:`, `  ${entry.error}`];
    case "intent":
      return intentLine(entry);
    case "open":
      return [`the page asked to open '${entry.id}' in '${entry.cid}' — the published page would go there; this pane stays where it is`];
    case "notice":
      // PAGE-AUTHORED, and marked as such. The reader is often a model, and a sentence the page
      // chose must not arrive looking like something this host is saying.
      return [`the frame reported '${entry.code}' — ${NOTICES[entry.code]}`, ...(entry.detail === "" ? [] : [`  page text: ${quoteForReport(entry.detail)}`])];
    case "host":
      return [entry.note];
  }
};

/** How the header says the app's public face, in the reader's terms rather than the field's. The
 *  middle line names the SWITCH, because "a `public` block exists" is precisely the thing that is
 *  not the question. */
const ENTRANCE: Record<PublicFace, string> = {
  open: "public entrance OPEN",
  declared: "roster only — `public` declared, `public.enabled` not on",
  none: "roster only",
};

const headerLines = (header: PreviewLogHeader): string[] => {
  const where = header.cwd === null ? "no directory" : foldHome(header.cwd);
  // Three states, because the middle one is what an invite-only app that writes records looks
  // like, and calling it "public entrance OPEN" is what #1926 was filed about.
  const entrance = ENTRANCE[header.publicFace];
  const before = header.fromLiveApp ? "published before" : "never published";
  const page = header.page === null ? "no page selected" : `page '${header.page}' (${header.audience ?? "public"})`;
  return [
    "MulmoTerminal shared-app preview — what happened in the pane, on the author's own machine",
    `  MulmoTerminal ${header.version} · ${where}`,
    `  app ${header.aid} · ${entrance} · ${before}`,
    `  ${page}`,
  ];
};

/** What this block does not say. Fixed text, never omitted on a quiet run.
 *
 *  A preview that ends with nothing said reads as a clean bill of health, and three of these four
 *  are the failures that only appear after publishing. The first is the one that catches authors
 *  out: the records were read AS THE AUTHOR, who is an owner. */
const CLOSING = [
  "",
  "What this does not say. Records here were read AS YOU — an owner — so a page that draws is not a page a stranger may see. A write you accepted was judged by the",
  "deployed rules as you, and says nothing about what a visitor would be allowed to write. Nobody else exists here, so nothing was concurrent, and no other device was",
  "involved.",
  "What is in it. Field names and collection ids, never the values in a record — except in a line marked `page text:`, which is what the PAGE wrote and may contain",
  "anything the page put there, including a value out of a record.",
];

export const renderPreviewLog = (header: PreviewLogHeader, log: PreviewLog): string => {
  const entries = log.entries();
  const dropped = log.dropped();
  const counts = `  ${entries.length} event${entries.length === 1 ? "" : "s"}, ${log.problems()} problem${log.problems() === 1 ? "" : "s"}`;
  const truncated =
    dropped === 0 ? [] : [`  ${dropped} earlier event${dropped === 1 ? " was" : "s were"} dropped — this keeps the most recent ${entries.length}.`];
  const body =
    entries.length === 0
      ? ["", "Nothing happened yet: the page has not been mounted, or it was mounted and did nothing at all."]
      : ["", ...entries.flatMap((entry) => lineFor(entry).map((line, index) => `${index === 0 ? stamp(entry.at) : " ".repeat(9)}  ${line}`))];
  return [...headerLines(header), counts, ...truncated, ...body, ...CLOSING].join("\n");
};
