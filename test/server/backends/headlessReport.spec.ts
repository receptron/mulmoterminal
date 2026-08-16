// @vitest-environment node
//
// What a headless run SAYS, tested without a browser.
//
// Separate from the contract test beside it for a reason that is not tidiness: the run needs
// Chrome and is skipped where there is none, so every assertion about the words would be skipped
// with it — and the words are what the agent acts on. A page that never answered the handshake is
// only useful if the report says which line of the author's page to move.
import { describe, expect, it } from "vitest";
import { narrateHeadlessRun } from "../../../server/backends/sharedApp/headlessReport.js";
import type { HeadlessPageReport, HeadlessPress } from "../../../server/backends/sharedApp/headlessPreview.js";

const press = (over: Partial<HeadlessPress> = {}): HeadlessPress => ({
  label: "Order",
  notClickable: false,
  submitted: null,
  refused: [],
  blockedFormSubmission: false,
  errors: [],
  ...over,
});

const page = (over: Partial<HeadlessPageReport> = {}): HeadlessPageReport => ({
  id: "public",
  audience: "public",
  readied: true,
  stateDelivered: true,
  unresponsive: false,
  submittedOnLoad: 0,
  liveForms: 0,
  text: "Curry, Ramen",
  presses: [],
  pressesOmitted: 0,
  errors: [],
  ...over,
});

const narrate = (over: Partial<HeadlessPageReport> = {}, omittedPages = 0): string => narrateHeadlessRun({ ok: true, pages: [page(over)], omittedPages });

describe("narrateHeadlessRun", () => {
  it("names the fix for a page that never answered the handshake", () => {
    // The whole value of the line: "loading forever" is a symptom with exactly one cause here, and
    // the report has to say where `ready()` goes rather than that something went wrong.
    const said = narrate({ readied: false, stateDelivered: false, text: "loading…" });
    expect(said).toContain("NEVER answered the handshake");
    expect(said).toContain("OUTSIDE the `onState` callback");
    expect(said).toContain('"loading…"');
  });

  it("explains a live form as the sandbox blocking it, not as a style preference", () => {
    const said = narrate({ liveForms: 2 });
    expect(said).toContain("2 <form> elements");
    expect(said).toContain("allow-forms");
    expect(said).toContain("BEFORE firing the `submit` event");
  });

  it("reports a press that reached the parent, and that it was not written", () => {
    const said = narrate({ presses: [press({ submitted: { cid: "orders", fields: ["name"] } })] });
    expect(said).toContain("a submission reached the parent for 'orders' carrying name");
    expect(said).toContain("DECLINED");
  });

  it("translates the parent's own refusals, which never reach a screen", () => {
    const said = narrate({ presses: [press({ refused: ["undeclared-field"] })] });
    expect(said).toContain("not in that collection's `createFields`");
    expect(said).toContain("answered on the port");
  });

  it("calls a dead button dead, without calling a display-only button broken", () => {
    const blocked = narrate({ presses: [press({ blockedFormSubmission: true })] });
    expect(blocked).toContain("BLOCKED a form submission");
    // The same shape of press with no block is genuinely ambiguous, and the report says so rather
    // than reporting a working tab control as a defect.
    const quiet = narrate({ presses: [press()] });
    expect(quiet).toContain("nothing reached the parent");
    expect(quiet).toContain("that is fine");
  });

  it("says what it did not cover, and never says the app is ready to publish", () => {
    // A run that goes perfectly still ends with the four things it hides. A report that could omit
    // them would read as a green light on the one question it cannot answer.
    const clean = narrate({ presses: [press({ submitted: { cid: "orders", fields: [] } })] });
    expect(clean).toContain("Nothing was written");
    expect(clean).toContain("does NOT prove the app is ready to publish");
    expect(clean).toContain("Collections pane");
  });

  it("says a control could not be clicked, rather than calling it a dead button", () => {
    // The two want opposite things done about them: a handler that is not wired up, against a
    // control a visitor's cursor can never arrive at.
    const said = narrate({ presses: [press({ notClickable: true })] });
    expect(said).toContain("HAD NOWHERE TO BE CLICKED");
    expect(said).not.toContain("dead button");
  });

  it("keeps a refusal that happened alongside a successful submission", () => {
    // The half nobody can see. Reported only in the branch that had no submission, the second
    // request's diagnostic would be lost everywhere at once.
    const said = narrate({ presses: [press({ submitted: { cid: "orders", fields: ["name"] }, refused: ["busy"] })] });
    expect(said).toContain("a submission reached the parent");
    expect(said).toContain("also REFUSED");
    expect(said).toContain("confirmation was already open");
  });

  it("reads a member page's declined write as the control WORKING, not as a fault", () => {
    // The member parent judges `transition` / `assign` / `withdraw` and would perform them on the
    // live page; here it has nowhere to write, so it answers `read-only`. Said as a fault, this
    // would send an author to rewrite a page that is correct — and it is the shape the old report
    // had, back when the public parent judged an intent `not-a-submission`.
    const said = narrate({ audience: "member", presses: [press({ refused: ["read-only"] })] });
    expect(said).toContain("the control is wired, not that anything is wrong");
    expect(said).not.toContain("most often a value that is not a string");
    // The remaining limit is the WRITE, and it is still stated on every member page.
    expect(said).toContain("REFUSED rather than performed");
    // What is no longer claimed: the page DOES get its capabilities now.
    expect(said).not.toContain("no `viewer` capabilities");
    // And a PUBLIC page still gets the ordinary translation of a real refusal.
    expect(narrate({ presses: [press({ refused: ["not-a-submission"] })] })).toContain("most often a value that is not a string");
  });

  it("says how many controls it did not press, counted rather than guessed", () => {
    // The length alone cannot tell a page that had exactly this many controls from a page whose
    // eleventh was dropped, so a report built from it either invents a truncation or hides one.
    expect(narrate({ pressesOmitted: 4 })).toContain("4 further controls were NOT pressed");
    expect(narrate({ pressesOmitted: 1 })).toContain("1 further control was NOT pressed");
    expect(narrate({ presses: [press(), press()] })).not.toContain("NOT pressed");
  });

  it("quotes what the page wrote so it cannot be read as the report's own words", () => {
    // A label carrying a quotation mark ended the quotation early, and nothing downstream could
    // tell which half was the page's.
    expect(narrate({ presses: [press({ label: 'Save "draft"' })] })).toContain('Pressed "Save \\"draft\\""');
  });

  it("says a page stopped answering, rather than blaming its handshake", () => {
    // A script that never returns keeps the frame's thread, so `ready()` could not have run
    // either — reporting the handshake would send an author to move a line that is not the
    // problem.
    const said = narrate({ unresponsive: true, readied: false });
    expect(said).toContain("STOPPED ANSWERING");
    expect(said).not.toContain("OUTSIDE the `onState` callback");
  });

  it("names a page that submitted before anybody pressed anything", () => {
    // Two findings in one: a visitor is shown a confirmation they never asked for, and every press
    // below would have inherited that submission and looked correctly wired.
    const said = narrate({ submittedOnLoad: 2, presses: [press()] });
    expect(said).toContain("SUBMITTED 2 times before anything was pressed");
    expect(said).toContain("inside `onState`");
    expect(narrate({ submittedOnLoad: 1 })).toContain("SUBMITTED once");
    expect(narrate({})).not.toContain("before anything was pressed");
  });

  it("keeps a blocked form and a refusal on the same press", () => {
    // Independent facts. A chain of branches reported whichever it reached first and lost the
    // other, and the blocked form is the one nothing else can report.
    const said = narrate({ presses: [press({ refused: ["unknown-collection"], blockedFormSubmission: true })] });
    expect(said).toContain("BLOCKED a form submission");
    expect(said).toContain("does not declare");
  });

  it("says how many pages it did not run at all", () => {
    // "Ran 6 pages" reads as "ran the app", and the seventh is then published having never been
    // loaded — the exact failure the action exists to end.
    expect(narrate({}, 3)).toContain("3 more pages were NOT run");
    expect(narrate({}, 1)).toContain("1 more page was NOT run");
    expect(narrate({})).not.toContain("NOT run");
  });

  it("passes a failed run through as its problems", () => {
    expect(narrateHeadlessRun({ ok: false, problems: ["no browser", "ask the user"] })).toBe("no browser\nask the user");
  });
});
