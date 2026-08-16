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
import type { HeadlessPageReport, HeadlessPress, HeadlessRun } from "./headlessPreview.js";

/** What this run does NOT do to a page written for the roster.
 *
 *  Said on every such page, because the omission is invisible: the page loads, draws and looks
 *  exercised. It used to be far larger — the parent was the PUBLIC one, so the page got no
 *  `viewer` at all and drew none of its buttons. That parent now comes from
 *  `@receptron/sharedapp/view`, the same one mulmoserver puts in front of `/m/` and `/p/`, and it
 *  carries the capabilities this author resolves to.
 *
 *  What is left is the writes. An intent is REFUSED here by name rather than performed, because a
 *  headless run never writes — so a button is proven to exist, to be reachable and to ask for the
 *  right thing, and not to succeed. The refusal is reported like any other, which is the
 *  difference from before: an untested control now says so in its own line. */
const MEMBER_PAGE_LIMIT =
  "This page is written for the roster. It gets the same `viewer` capabilities the live page would, from the same parent — but a headless run never writes, so " +
  "`transition`, `assign` and `withdraw` are REFUSED rather than performed. A control that asks for one is reported below as refused, which says it is wired; whether " +
  "the rules would accept the write is not tested here.";

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

/** A page that submitted with nobody having pressed anything.
 *
 *  Two things at once, and both are worth a line: a visitor opening this page is shown a
 *  confirmation they never asked for, and every press reported below had to be measured from AFTER
 *  this — without that, one automatic submission makes every button on the page look wired. */
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
    ...(press.errors.length === 0 ? [] : [`    It also raised: ${press.errors.join(" / ")}`]),
  ];
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
    return [
      `  ${head}a submission reached the parent for '${press.submitted.cid}' carrying ${fields}. It was DECLINED — a headless run never writes.`,
      ...notes,
    ];
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
    ...(page.presses.length === 0
      ? ["  No button or clickable control was found on this page."]
      : page.presses.flatMap((press) => pressLine(press, page.audience))),
    ...capped,
    ...(page.errors.length === 0 ? [] : [`  The browser reported: ${page.errors.join(" / ")}`]),
  ];
}

/** The fixed close. Not omitted on a clean run, and not softened: the run proves the drawing and
 *  the wiring, and the four things it hides are the ones that only appear after publishing. */
const CLOSING = [
  "",
  "Nothing was written: every confirmation was declined, so no record reached the database.",
  "This does NOT prove the app is ready to publish. It says nothing about whether the deployed rules would accept a write, about other people's devices, " +
    "about two people submitting at once, or about whether the rules are deployed at all. For the write, ask the user to press Preview in the Collections pane — " +
    "that one accepts, as them, against the real rules.",
];

export function narrateHeadlessRun(run: HeadlessRun): string {
  if (!run.ok) return run.problems.join("\n");
  const count = run.pages.length;
  // Said in the FIRST line, where "ran N pages" would otherwise be read as "ran the app".
  const more = run.omittedPages === 1 ? "1 more page was" : `${run.omittedPages} more pages were`;
  const omitted = run.omittedPages === 0 ? "" : ` ${more} NOT run — this run stops at ${count}.`;
  return [
    `Ran ${count} page${count === 1 ? "" : "s"} in a real browser, in the same sandbox and CSP a visitor gets.${omitted}`,
    ...run.pages.flatMap(pageLines),
    ...CLOSING,
  ].join("\n");
}
