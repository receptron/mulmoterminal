// A headless run, in words an agent can act on.
//
// Its own module and not part of the run, so that what is SAID about a page can be tested without
// starting a browser — the run itself needs one, and a test that needs Chrome to check a sentence
// is a test nobody runs.
//
// The register is deliberate. Every line answers "what would a person have seen, and what do you
// do about it": a page stuck on its loading state is reported with the words that are on it, and a
// button that reached nothing is named. What must never appear here is a verdict — a run that goes
// well says the pages drew and the presses arrived, and it does NOT say the app is ready to
// publish. Four kinds of failure survive this (the rules, other people's devices, two people at
// once, and whether the rules are deployed at all), which is why the closing lines are fixed text
// rather than something a good run can omit.
import { explainRefusal, FORM_BLOCKED, quoteForReport, READY_DEADLOCK } from "../../../common/sharedAppViewVocabulary.js";
import type { PreviewAudience } from "../../../common/sharedAppPreview.js";
import { LIMITS, type HeadlessPageReport, type HeadlessPress, type HeadlessRun, type HeadlessWrite } from "./headlessPreview.js";

/** What this run does NOT do to a page written for the roster.
 *
 *  Said on every such page, because the omission is invisible: the page loads, draws and looks
 *  exercised. It used to be far larger — the parent was the PUBLIC one, so the page got no
 *  `viewer` at all and drew none of its buttons. That parent now comes from
 *  `@receptron/sharedapp/view`, the same one mulmoserver puts in front of `/m/` and `/p/`, and it
 *  carries the capabilities this author resolves to.
 *
 *  What is left is the member's INTENTS, and this is now the one place a headless run does less
 *  than a live page rather than less than the pane — the pane refuses them too, for the same
 *  reason: neither host has a route for a transition, an assignment or a withdrawal. So a button
 *  is proven to exist, to be reachable and to ask for the right thing, and not to succeed. The
 *  refusal is reported like any other, so an untested control says so in its own line. */
const MEMBER_PAGE_LIMIT =
  "This page is written for the roster. It gets the same `viewer` capabilities the live page would, from the same parent — but a member's intent is REFUSED rather " +
  "than performed: `transition`, `assign` and `withdraw` are real writes against the live rules and neither this run nor the Collections pane has a route for one. " +
  "A control that asks for one is reported below as refused, which says it is wired; whether the rules would accept it is not tested here or there.";

/** The page's own account of itself, in the page's own words.
 *
 *  Marked as the PAGE's, every time, because `detail` is whatever the document threw — an author
 *  can write anything into an `Error` — and a reader who takes it for the host's word is being
 *  told something by a string this repository did not compose. `ViewNotice` says the same in the
 *  package: what is safe to show is a question about the reader, and here the reader is the author
 *  of the page it came from. */
function noticeLines(notices: readonly { code: string; detail: string }[], indent: string): string[] {
  if (notices.length === 0) return [];
  const said = notices.map((notice) => (notice.detail === "" ? notice.code : `${notice.code} — ${quoted(notice.detail)}`));
  return [`${indent}The PAGE reported about itself: ${said.join("; ")}. (Those words are the page's, not this report's.)`];
}

/** What the deployed rules said, and what became of the record.
 *
 *  The one thing no preview could answer until now, and the reason the closing lines below had to
 *  change: a run that declines every confirmation proves the submission reached the parent and
 *  stops there. Both halves are always said — an accepted write that could not be taken back is a
 *  real record standing in a real app, and a report that mentioned only the acceptance would read
 *  as a clean run. */
const refusalDetail = (error: string): string => (error === "" ? "." : `: ${error}.`);

/** Who said no, and what that means for a VISITOR — which is the only reason the line is worth
 *  reading. Three answers, and confusing them sends the author to fix the wrong thing. */
const REFUSED_HOW: Record<HeadlessWrite["reason"], string> = {
  rules: "REFUSED by the deployed rules",
  taken: "not written, because the id is already taken",
  host: "not written",
};

const REFUSED_BY: Record<HeadlessWrite["reason"], (cid: string) => string[]> = {
  rules: () => ["    That is the answer this run exists to bring back — a visitor pressing this button gets the same refusal, and the page cannot see why."],
  taken: (cid) => [
    `    That is NOT a verdict about a visitor. The id was already in use, and under \`idFrom: "auth.uid"\` the record it collided with is YOUR OWN — somebody else has a ` +
      `different uid and would be accepted. Remove your record from '${cid}' if you want this button exercised for real.`,
  ],
  host: () => [
    "    The database never saw it: this run could not get as far as writing. That is about the app or about this run — a projection that would not build, a required " +
      "field the page did not send, no signed-in session — and NOT something the deployed rules refused.",
  ],
};

function writeLines(write: HeadlessWrite): string[] {
  if (!write.ok) {
    return [`    The write was ${REFUSED_HOW[write.reason]} for '${write.cid}'${refusalDetail(write.error)}`, ...REFUSED_BY[write.reason](write.cid)];
  }
  const kept =
    write.cleanup === "removed"
      ? "It was REMOVED again immediately, so nothing of it is left."
      : `It could NOT be removed (${write.cleanupError}) — the record is still there. Take it out by hand before publishing, or it occupies a real place in the app.`;
  return [`    The deployed rules ACCEPTED the write to '${write.cid}'. ${kept}`];
}

/** A confirmation this run chose not to accept. Its own line, because a null write and a declined
 *  one are opposite findings about a button, and silence here would read as the first. */
/** A press on a page that submits by itself. The submission is real and so is the press; what is
 *  unknowable is whether one caused the other, and a write is not something to do on a guess. */
/** A submission the runtime did not vouch for. The submission is real and so is the press; what is
 *  missing is any evidence that one caused the other, and a write is not something to do on a
 *  guess. A page that submits from a timer while the press is being watched lands here, which is
 *  the case every counting-based design got wrong. */
const WITHHELD_WRITE =
  "    It was DECLINED rather than written: the submission did not carry a mark from the runtime saying it was made during a click dispatch, so nothing establishes " +
  "that THIS control caused it. A page can submit from a timer or `onState` just as easily, and a record in a real app needs a better reason than arriving at the " +
  "right moment.";

const SKIPPED_WRITE =
  "    It was DECLINED rather than written: this run had already spent its budget of real writes. The submission is wired; what the rules would say about THIS one was not asked.";

const quoted = quoteForReport;

/** The handshake, which decides whether anything below it is about a page that has its data. */
function handshakeLine(page: HeadlessPageReport): string {
  if (page.unresponsive) {
    return (
      "It STOPPED ANSWERING — it never finished loading, or a question put to it ran out of time. A script that does not return does this: the frame keeps its own " +
      "thread, so nothing else on the page ever runs. Nothing below is a report about the page's behaviour; it is a report about a page that never got going."
    );
  }
  if (!page.readied) {
    return READY_DEADLOCK;
  }
  if (!page.stateDelivered) return "It answered the handshake, but no records were sent — this app declares no datasets for this page.";
  return "It answered the handshake and was sent its records.";
}

function onLoadLine(page: HeadlessPageReport): string[] {
  if (page.submittedOnLoad === 0) return [];
  const times = page.submittedOnLoad === 1 ? "once" : `${page.submittedOnLoad} times`;
  return [
    `The page SUBMITTED ${times} before anything was pressed. A visitor opening it is asked to confirm a write they did not ask for — check for a \`submit\` call that runs at load ` +
      "or inside `onState` rather than from a handler. (The presses below are measured from after it, so they are still their own.)",
  ];
}

function formLine(page: HeadlessPageReport): string[] {
  if (page.liveForms === 0) return [];
  return [`The live document has ${page.liveForms} <form> element${page.liveForms === 1 ? "" : "s"}. ${FORM_BLOCKED}`];
}

/** Every refusal the parent answered, whether or not something else on the same press succeeded.
 *
 *  Not folded into the branches below: a press that submits AND then asks for something invalid
 *  reports both, and the second is the half nobody can see — it is answered on the port, into a
 *  promise the page usually does not await, so losing it here loses it everywhere. */
function refusalLine(press: HeadlessPress, audience: PreviewAudience): string[] {
  if (press.refused.length === 0) return [];
  const translate = (reason: string): string => explainRefusal(reason, audience);
  const many = press.refused.length === 1 ? "a request" : `${press.refused.length} requests`;
  return [`    The parent also REFUSED ${many} — ${press.refused.map(translate).join("; ")}.`];
}

/** The BLOCKED form, the refusals and the page's own errors — everything that is true about a
 *  press whatever else it did.
 *
 *  Notes rather than branches, because these are independent facts and a chain of `if`s loses
 *  whichever one it does not reach first: a press that both submitted and was refused, or one that
 *  was refused AND had a form submission blocked, each lost half of itself. */
function pressNotes(press: HeadlessPress, audience: PreviewAudience): string[] {
  return [
    ...(press.blockedFormSubmission
      ? ["    The browser BLOCKED a form submission on this press — the `submit` event never fired, so no handler of the page's ran."]
      : []),
    ...refusalLine(press, audience),
    ...noticeLines(press.notices, "    "),
    ...(press.errors.length === 0 ? [] : [`    It also raised: ${press.errors.join(" / ")}`]),
  ];
}

/** What the confirmation became. Three outcomes and each is its own finding: the rules answered,
 *  the run chose not to ask, or there was no writer at all. */
function outcomeLines(press: HeadlessPress): string[] {
  if (press.write !== null) return writeLines(press.write);
  if (press.writeWithheld) return [WITHHELD_WRITE];
  if (press.writeSkipped) return [SKIPPED_WRITE];
  // WITHOUT saying why. The reason belongs to the run, not to this press — the closing lines say
  // whether the run had a writer at all — and a press-level guess would contradict them on the
  // path where a confirmation was withdrawn before the writer was reached.
  return ["    It was DECLINED, so nothing of it reached the database."];
}

function pressLine(press: HeadlessPress, audience: PreviewAudience): string[] {
  const head = `Pressed ${quoted(press.label)}: `;
  const notes = pressNotes(press, audience);
  if (press.notClickable) {
    return [
      `  ${head}the control HAD NOWHERE TO BE CLICKED — \`display:none\`, zero-sized, or off the document. No cursor can reach it, so this is not a report about its handler.`,
      ...notes,
    ];
  }
  if (press.submitted !== null) {
    const fields = press.submitted.fields.length === 0 ? "no fields" : press.submitted.fields.join(", ");
    return [`  ${head}a submission reached the parent for '${press.submitted.cid}' carrying ${fields}.`, ...outcomeLines(press), ...notes];
  }
  if (press.refused.length > 0 || press.blockedFormSubmission) {
    return [
      `  ${head}nothing became a confirmation. The page cannot see why: a refusal is answered on the port, and a blocked form raises nothing at all.`,
      ...notes,
    ];
  }
  return [
    `  ${head}nothing reached the parent. If it was meant to submit, it is a dead button; if it only changes what is on screen, that is fine and this line is expected.`,
    ...notes,
  ];
}

function pageLines(page: HeadlessPageReport): string[] {
  // A cap that is not said out loud reads as "everything was covered" — and it is COUNTED rather
  // than inferred from the length, which is the same for a page that had exactly this many
  // controls and a page whose eleventh was dropped.
  const capped = page.pressesOmitted === 0 ? [] : [`  ${page.pressesOmitted} further control${page.pressesOmitted === 1 ? " was" : "s were"} NOT pressed.`];
  return [
    "",
    `${page.audience} page '${page.id}'`,
    ...(page.audience === "public" ? [] : [`  ${MEMBER_PAGE_LIMIT}`]),
    `  ${handshakeLine(page)}`,

    ...onLoadLine(page).map((line) => `  ${line}`),
    ...formLine(page).map((line) => `  ${line}`),
    page.text === "" ? "  Nothing was drawn: the page put no text on the screen at all." : `  On screen: ${quoted(page.text)}`,
    ...(page.screenshot === null
      ? []
      : [`  A picture of it, as a visitor first meets it: ${page.screenshot} — open it if the words above leave anything in doubt.`]),
    ...(page.screenshotError === "" ? [] : [`  No picture was taken: ${page.screenshotError}. That is about this run, not about the page.`]),
    ...noticeLines(page.notices, "  "),
    ...(page.presses.length === 0
      ? ["  No button or clickable control was found on this page."]
      : page.presses.flatMap((press) => pressLine(press, page.audience))),
    ...capped,
    ...(page.errors.length === 0 ? [] : [`  The browser reported: ${page.errors.join(" / ")}`]),
  ];
}

/** The fixed close. Not omitted on a clean run, and not softened: the run proves the drawing and
 *  the wiring, and the four things it hides are the ones that only appear after publishing. */
/** What is still unknown after the run, which depends on whether anything was ACTUALLY written.
 *
 *  Not on whether a writer existed: `headlessPreview` always supplies one, and until the runtime
 *  marks a submission as click-caused every confirmation is declined anyway. Keyed on the writer,
 *  this closed by telling the reader the rules had been answered on a run that never reached
 *  them — the single most expensive sentence in the report to have wrong, because it is the one a
 *  reader takes as the verdict. */
const stillUnknown = (wroteAnything: boolean): string =>
  "This does NOT prove the app is ready to publish. It says nothing about other people's devices, about two people submitting at once, or about anything a " +
  "collection this run did not reach would do." +
  (wroteAnything
    ? " What it does answer is the rules — every accepted confirmation above was a real write, judged by the rules as they are deployed, and taken back again."
    : " It says nothing about whether the deployed rules would accept a write, or whether they are deployed at all: nothing was written.");

/** The fixed close, in the two shapes a run can have.
 *
 *  It is not omitted on a clean run and not softened, for the reason it always had: what a run
 *  proves and what it leaves unknown are both facts about every run, and a report that states them
 *  only when something went wrong teaches a reader to read silence as safety.
 *
 *  What CHANGED is that "nothing was written" is no longer true of every run
 *  (`plans/feat-headless-preview-parity.md`), and a fixed line that has become false is worse than
 *  no line — so the two cases are said apart, and the list of what is still unknown lost exactly
 *  the one entry the writes now cover. */
/** What the run ACTUALLY did with the confirmations it met, counted from the presses.
 *
 *  Counted rather than assumed from `wrote`, which says only that a writer existed. A run whose one
 *  submission was refused, or which met no submission at all, was closing with "Every confirmation
 *  above was ACCEPTED and written to the real database as you" — a sentence about records that do
 *  not exist, in the part of the report a reader trusts most because it is the same every time. */
function whatWasWritten(pages: readonly HeadlessPageReport[]): string[] {
  const writes = pages.flatMap((page) => page.presses.flatMap((press) => (press.write === null ? [] : [press.write])));
  const made = writes.filter((write) => write.ok);
  const refused = writes.length - made.length;
  const withheld = pages.flatMap((page) => page.presses.filter((press) => press.writeWithheld)).length;
  if (writes.length === 0) return [nothingWritten(withheld)];
  const left = made.filter((write) => write.cleanup !== "removed").length;
  return [...removedLine(made.length - left), ...standingLine(left, made.length), ...refusedSummary(refused)];
}

/** A run that wrote nothing, and WHY — which is two different reports.
 *
 *  A page nobody could submit from, and a page that submitted fine but whose submissions carried no
 *  evidence of a cause, are opposite findings. Rolled into one sentence the second reads as the
 *  first, and an author goes looking for a dead button that works. */
function nothingWritten(withheld: number): string {
  if (withheld === 0) return "No confirmation was accepted: nothing on these pages submitted, so nothing was written.";
  const many = withheld === 1 ? "1 submission" : `${withheld} submissions`;
  return (
    `${many} reached the parent and NONE was written: they carried no mark from the runtime saying a click had caused them, and this run will not put a record in a ` +
    "real app without one. The pages and their controls were exercised — what was not tested is what the deployed rules would say. For that, ask the user to press " +
    "Preview in the Collections pane, where a person supplies the proof."
  );
}

const removedLine = (removed: number): string[] =>
  removed === 0
    ? []
    : [`${removed} submission${removed === 1 ? " was" : "s were"} ACCEPTED and written to the real database as you, then removed again immediately.`];

/** The half that costs somebody else something.
 *
 *  Counted APART from the removals, which is the whole point: rolled together, this close said
 *  every accepted write had been removed while a press above was naming one that is still standing.
 *  The close is the part a reader trusts, so it is the worse of the two places to be wrong. */
function standingLine(left: number, made: number): string[] {
  if (left === 0) return made === 0 ? [] : ["Nothing this run wrote was left behind."];
  const it = left === 1 ? "it" : "them";
  return [
    `${left} accepted record${left === 1 ? " is" : "s are"} STILL THERE — this run wrote ${it} and could not take ${it} back. ` +
      `The press that made each one names it. Remove ${it} by hand before publishing.`,
  ];
}

const refusedSummary = (refused: number): string[] =>
  refused === 0
    ? []
    : [
        `${refused} submission${refused === 1 ? " was" : "s were"} attempted and NOT written — the press that made each one says who refused it and what that means.`,
      ];

/** The one thing a run cannot exercise at all, and the reason it is fixed text.
 *
 *  A view that declares `live` is subscribed in production: `onState` arrives again every time the
 *  collection moves, and the page is written to be re-entered. This run delivers state ONCE — so a
 *  page that draws correctly here, and every press reported above, says nothing about the second
 *  delivery. What breaks there is invisible in a single-shot run: a redraw that duplicates rows
 *  instead of replacing them, a listener attached per state, and the one that costs a visitor
 *  something — a selection or a half-typed field wiped when an update lands.
 *
 *  Unconditional, and not keyed on whether this app declares `live` today: the sentence is about
 *  what the run does, the declaration is one line away in `app.json`, and a report that goes quiet
 *  when the answer is "no" teaches a reader that silence means covered. It is the fourth entry in
 *  the list `docs/shared-app-principles.md` keeps of what a green preview does NOT say. */
const LIVE_UNVERIFIED =
  "A page whose view declares `live` is written for `onState` to arrive MORE THAN ONCE — production subscribes it and re-delivers on every change. This run " +
  "delivers state once. Whether such a page redraws correctly on a second state, and whether an update landing mid-edit wipes a selection or a half-typed field, " +
  "is NOT tested here.";

function closing(run: { wrote: boolean; writesSkipped: number; screenshotDir: string | null; pages: readonly HeadlessPageReport[] }): string[] {
  const skipped =
    run.writesSkipped === 0
      ? []
      : [
          `${run.writesSkipped} further confirmation${run.writesSkipped === 1 ? " was" : "s were"} DECLINED rather than written — this run stops after ${LIMITS.writes} real writes. ` +
            "Those buttons are wired; what the rules would say about them was not asked.",
        ];
  const pictures =
    run.screenshotDir === null ? [] : [`The pictures are in ${run.screenshotDir}. Nothing removes them — they outlive this call so they can be opened.`];
  if (!run.wrote) {
    return [
      "",
      "Nothing was written: this run was given no way to write, so every confirmation was declined.",
      ...pictures,
      "This does NOT prove the app is ready to publish. It says nothing about whether the deployed rules would accept a write, about other people's devices, " +
        "about two people submitting at once, or about whether the rules are deployed at all.",
      LIVE_UNVERIFIED,
    ];
  }
  const wroteAnything = run.pages.some((page) => page.presses.some((press) => press.write !== null));
  return ["", ...whatWasWritten(run.pages), ...skipped, ...pictures, stillUnknown(wroteAnything), LIVE_UNVERIFIED];
}

export function narrateHeadlessRun(run: HeadlessRun): string {
  if (!run.ok) return run.problems.join("\n");
  const count = run.pages.length;
  // Said in the FIRST line, where "ran N pages" would otherwise be read as "ran the app".
  const more = run.omittedPages === 1 ? "1 more page was" : `${run.omittedPages} more pages were`;
  const omitted = run.omittedPages === 0 ? "" : ` ${more} NOT run — this run stops at ${count}.`;
  return [
    `Ran ${count} page${count === 1 ? "" : "s"} in a real browser, in the same sandbox and CSP a visitor gets.${omitted}`,
    ...run.pages.flatMap(pageLines),
    ...closing(run),
  ].join("\n");
}
