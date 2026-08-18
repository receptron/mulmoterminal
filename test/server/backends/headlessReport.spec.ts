// @vitest-environment node
//
// What a headless run SAYS, tested without a browser.
//
// Separate from the contract test beside it for a reason that is not tidiness: the run needs
// Chrome and is skipped where there is none, so every assertion about the words would be skipped
// with it — and the words are what the agent acts on. A page that never answered the handshake is
// only useful if the report says which line of the author's page to move.
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { narrateHeadlessRun } from "../../../server/backends/sharedApp/headlessReport.js";
import type { HeadlessPageReport, HeadlessPress, HeadlessRun, HeadlessWrite } from "../../../server/backends/sharedApp/headlessPreview.js";

const press = (over: Partial<HeadlessPress> = {}): HeadlessPress => ({
  label: "Order",
  notClickable: false,
  submitted: null,
  refused: [],
  blockedFormSubmission: false,
  write: null,
  writeSkipped: false,
  writeWithheld: false,
  notices: [],
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
  screenshot: null,
  screenshotError: "",
  notices: [],
  presses: [],
  pressesOmitted: 0,
  errors: [],
  ...over,
});

/** A run that COULD write, because that is what `manageSharedApp` gives it. A run without a writer
 *  is its own case and has its own tests below — the two say opposite things about the same page. */
/** An accepted write that was cleaned up — the ordinary outcome, and the one most tests want. */
const written = (): HeadlessWrite => ({ cid: "orders", ok: true, error: "", reason: "rules", cleanup: "removed", cleanupError: "" });

const narrate = (over: Partial<HeadlessPageReport> = {}, omittedPages = 0, run: Partial<Extract<HeadlessRun, { ok: true }>> = {}): string =>
  narrateHeadlessRun({ ok: true, pages: [page(over)], omittedPages, writesSkipped: 0, screenshotDir: null, wrote: true, ...run });

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
    // A run that goes perfectly still ends with what it hides. A report that could omit them would
    // read as a green light on the questions it cannot answer.
    const clean = narrate({ presses: [press({ submitted: { cid: "orders", fields: [] }, write: written() })] });
    expect(clean).toContain("does NOT prove the app is ready to publish");
    expect(clean).toContain("other people's devices");
    expect(clean).toContain("two people submitting at once");
  });

  it("says that a `live` page's second state was never delivered, on every run", () => {
    // Fixed text, on a clean run and on a failed one alike: production subscribes a view that
    // declares `live` and re-delivers on every change, while a run delivers state once. Said only
    // when the app happens to declare `live`, silence would read as "covered" for the app that
    // adds the line an hour later.
    const clean = narrate({ presses: [press({ submitted: { cid: "orders", fields: [] }, write: written() })] });
    expect(clean).toContain("`onState` to arrive MORE THAN ONCE");
    expect(clean).toContain("delivers state once");
    const noWriter = narrate({ presses: [press()] }, 0, { wrote: false });
    expect(noWriter).toContain("`onState` to arrive MORE THAN ONCE");
  });

  it("says a submission without a click mark was not written to, and why", () => {
    // The runtime is the only code that knows whether a click caused a submission. If it did not
    // mark the submission, we cannot write it — the cause is unknowable.
    const said = narrate({ presses: [press({ submitted: { cid: "orders", fields: [] }, writeWithheld: true })] });
    expect(said).toContain("did not carry a mark from the runtime");
    expect(said).toContain("made during a click dispatch");
    expect(said).toContain("timer or `onState`");
  });

  it("does not say a record was removed when one is still standing", () => {
    // The close is the part a reader trusts, so it is the worse of the two places to be wrong: a
    // press above was naming a record that could not be taken back while this line said every
    // accepted write had been removed.
    const said = narrate({
      presses: [
        press({ submitted: { cid: "orders", fields: [] }, write: written() }),
        press({
          label: "Again",
          submitted: { cid: "orders", fields: [] },
          write: { cid: "orders", ok: true, error: "", reason: "rules", cleanup: "left", cleanupError: "not-this-session" },
        }),
      ],
    });
    expect(said).toContain("1 submission was ACCEPTED and written");
    expect(said).toContain("1 accepted record is STILL THERE");
    expect(said).toContain("Remove it by hand before publishing");
  });

  it("does not say the rules were answered on a run that wrote nothing", () => {
    // The close was keyed on whether a WRITER existed, and `headlessPreview` always supplies one —
    // so a run that declined every confirmation still ended by telling the reader the rules had
    // been answered. That is the single most expensive sentence here to have wrong: it is the one
    // a reader takes as the verdict.
    const said = narrate({ presses: [press({ submitted: { cid: "orders", fields: [] }, writeWithheld: true })] });
    expect(said).not.toContain("What it does answer is the rules");
    expect(said).toContain("whether the deployed rules would accept a write");
  });

  it("tells a run that could not submit from one whose submissions were unproven", () => {
    // Opposite findings: a page with a dead button, and a page that works whose submissions carried
    // no evidence of a cause. Said the same way, an author goes looking for a dead button that
    // works perfectly.
    const dead = narrate({ presses: [press()] });
    expect(dead).toContain("nothing on these pages submitted");
    const unproven = narrate({ presses: [press({ submitted: { cid: "orders", fields: [] }, writeWithheld: true })] });
    expect(unproven).toContain("1 submission reached the parent and NONE was written");
    expect(unproven).toContain("The pages and their controls were exercised");
  });

  it("does not claim a write happened when every submission was refused", () => {
    // The closing lines are fixed text, which is exactly why a false one there is expensive: it
    // reads as a guarantee because it is the same every time. A run whose only write was refused
    // was closing with "Every confirmation above was ACCEPTED and written to the real database as
    // you" — a sentence about records that do not exist.
    const said = narrate({
      presses: [
        press({
          submitted: { cid: "orders", fields: [] },
          write: { cid: "orders", ok: false, error: "denied", reason: "rules", cleanup: "not-written", cleanupError: "" },
        }),
      ],
    });
    expect(said).not.toContain("written to the real database as you");
    expect(said).toContain("1 submission was attempted and NOT written");
  });

  it("says nothing was written when nothing on the pages submitted", () => {
    // A run with a writer that met no confirmation. It wrote nothing, and the close must say that
    // rather than describe removals of records it never made.
    const said = narrate({ presses: [press()] });
    expect(said).toContain("No confirmation was accepted");
    expect(said).not.toContain("removed again immediately");
  });

  it("counts the accepted and the refused apart in the same run", () => {
    // Both halves are facts about the same run, and a report that told only the first would read
    // as a clean pass over a page whose other button the rules turned down.
    const said = narrate({
      presses: [
        press({ submitted: { cid: "orders", fields: [] }, write: written() }),
        press({
          label: "Cancel",
          submitted: { cid: "orders", fields: [] },
          write: { cid: "orders", ok: false, error: "denied", reason: "rules", cleanup: "not-written", cleanupError: "" },
        }),
      ],
    });
    expect(said).toContain("1 submission was ACCEPTED and written");
    expect(said).toContain("1 submission was attempted and NOT written");
  });

  it("does not say 'nothing was written' about a run that wrote", () => {
    // The line was fixed text and became false when the run started accepting
    // (`plans/feat-headless-preview-parity.md`). A fixed line that has gone false is worse than no
    // line: this whole report is read as a set of guarantees, and one of them would be a lie.
    const wrote = narrate({ presses: [press({ submitted: { cid: "orders", fields: [] }, write: written() })] });
    expect(wrote).not.toContain("Nothing was written");
    expect(wrote).toContain("written to the real database as you, then removed again immediately");
    // And it no longer sends the reader to the pane for the answer it now has itself.
    expect(wrote).not.toContain("Collections pane");
  });

  it("still says nothing was written when the run had no writer", () => {
    // Every test run, and any caller that asks for none. The two cases say opposite things about
    // the same page, so the report must not have one voice for both.
    const dry = narrate({ presses: [press({ submitted: { cid: "orders", fields: [] } })] }, 0, { wrote: false });
    expect(dry).toContain("Nothing was written");
    expect(dry).toContain("given no way to write");
    expect(dry).toContain("whether the rules are deployed at all");
  });

  it("reports the rules' refusal as the answer, not as a broken page", () => {
    // The one thing no preview could bring back before. An author reading this must not go looking
    // for a fault in the page — the page did its job and the app's declaration did not.
    const said = narrate({
      presses: [
        press({
          submitted: { cid: "orders", fields: ["name"] },
          write: {
            cid: "orders",
            ok: false,
            error: "the window for slots/1 opens at 2027-01-01T00:00:00.000Z",
            reason: "rules",
            cleanup: "not-written",
            cleanupError: "",
          },
        }),
      ],
    });
    expect(said).toContain("REFUSED by the deployed rules for 'orders'");
    expect(said).toContain("opens at 2027-01-01");
    expect(said).toContain("a visitor pressing this button gets the same refusal");
  });

  it("does not call a host-side failure a verdict of the deployed rules", () => {
    // `writePreviewSubmission` fails for plenty of reasons that never reach the database — no
    // session, a projection that will not build, a required field the page did not send. Reported
    // as the rules refusing, the author goes and changes a declaration the rules never saw.
    const said = narrate({
      presses: [
        press({
          submitted: { cid: "orders", fields: [] },
          write: { cid: "orders", ok: false, error: "missing: name", reason: "host", cleanup: "not-written", cleanupError: "" },
        }),
      ],
    });
    expect(said).not.toContain("REFUSED by the deployed rules");
    expect(said).toContain("The database never saw it");
  });

  it("says an id collision is about the author, not about a visitor", () => {
    // Under `idFrom: "auth.uid"` the record it collided with is the AUTHOR's own, and a visitor
    // with a different uid would be accepted. Said as a refusal, this is simply false.
    const said = narrate({
      presses: [
        press({
          submitted: { cid: "orders", fields: [] },
          write: { cid: "orders", ok: false, error: "already-taken", reason: "taken", cleanup: "not-written", cleanupError: "" },
        }),
      ],
    });
    expect(said).toContain("already taken");
    expect(said).toContain("NOT a verdict about a visitor");
    expect(said).toContain("the record it collided with is YOUR OWN");
    expect(said).not.toContain("a visitor pressing this button gets the same refusal");
  });

  it("names a record it could not take back, rather than reporting a clean run", () => {
    // The one outcome that costs somebody else something: a booking left standing occupies a real
    // slot in a real app. Silence here would read as "removed".
    const said = narrate({
      presses: [
        press({
          submitted: { cid: "orders", fields: [] },
          write: { cid: "orders", ok: true, error: "", reason: "rules", cleanup: "left", cleanupError: "not-this-session" },
        }),
      ],
    });
    expect(said).toContain("could NOT be removed (not-this-session)");
    expect(said).toContain("Take it out by hand before publishing");
    // The close now names the count rather than promising in general that leftovers are named:
    // that promise sat beside a claim that everything had been removed, which is the pair this
    // report must never make.
    expect(said).toContain("1 accepted record is STILL THERE");
  });

  it("tells a confirmation the run declined from one the page never made", () => {
    // Opposite findings about the same button: "we chose not to ask" against "it is a dead
    // button". Reported as the same thing, an author goes and rewrites a control that works.
    const capped = narrate({ presses: [press({ submitted: { cid: "orders", fields: [] }, writeSkipped: true })] }, 0, { writesSkipped: 3 });
    expect(capped).toContain("DECLINED rather than written");
    expect(capped).toContain("3 further confirmations were DECLINED");
    expect(capped).not.toContain("dead button");
  });

  it("marks what the page said about itself as the page's own words", () => {
    // `detail` is whatever the document threw, and an author can write anything into an `Error`.
    // A reader taking it for this report's word is being told something by a string nobody here
    // composed.
    const said = narrate({ notices: [{ code: "error", detail: "boom" }] });
    expect(said).toContain("The PAGE reported about itself: error");
    expect(said).toContain('"boom"');
    expect(said).toContain("Those words are the page's, not this report's");
  });

  it("gives the picture's path, and says when there is none", () => {
    // The pane's last advantage handed over: a person looking at the screen. A path costs a line
    // and the bytes would cost the context, so the agent opens it when the words give it a reason.
    const dir = join(tmpdir(), "p");
    const shot = join(dir, "1-public-menu.png");
    expect(narrate({ screenshot: shot }, 0, { screenshotDir: dir })).toContain(shot);
    const none = narrate({ screenshotError: "the picture could not be taken: out of disk" });
    expect(none).toContain("No picture was taken");
    // Said as OURS, so the author does not go looking for it in their page.
    expect(none).toContain("about this run, not about the page");
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
