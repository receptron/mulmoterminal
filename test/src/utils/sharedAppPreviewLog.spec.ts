// The block an author copies out of the Collections pane.
//
// It is tested as PROSE, without a browser, for the reason its server-side twin
// (`headlessReport.spec.ts`) is: what this feature delivers is a sentence somebody can act on, and
// a test that needed a real preview to check a sentence is a test nobody runs.
//
// Two properties are load-bearing and each has its own reason to be pinned. The block is pasted
// into somewhere else — usually the agent in the next cell — so it must carry no values and no
// home directory, and the page's own strings must be marked as the page's. And it must never look
// complete when it is not: a buffer that dropped the first half of what happened, or a quiet run
// that says nothing about what it did not check, is worse than no block at all.
import { describe, it, expect } from "vitest";
import { createPreviewLog, foldHome, renderPreviewLog, type PreviewLogHeader } from "../../../src/utils/sharedAppPreviewLog";

/** A clock that moves a second per event, so the stamps in the block are checkable. */
const ticking = () => {
  let at = 1_000_000;
  return () => (at += 1000);
};

const header: PreviewLogHeader = {
  version: "4.2.0",
  aid: "aid-1",
  cwd: "/Users/someone/git/rooms",
  page: "book",
  audience: "public",
  publicFace: "open",
  fromLiveApp: false,
};

const render = (build: (log: ReturnType<typeof createPreviewLog>) => void, over: Partial<PreviewLogHeader> = {}): string => {
  const log = createPreviewLog({ now: ticking() });
  build(log);
  return renderPreviewLog({ ...header, ...over }, log);
};

describe("the pane's log", () => {
  it("says what a person would have seen, in order, from the first event", () => {
    const block = render((log) => {
      log.add({ kind: "page", id: "book", audience: "public" });
      log.add({ kind: "handshake" });
      log.add({ kind: "state", datasets: [{ cid: "rooms", rows: 3 }] });
    });
    // Relative to the FIRST event rather than to the epoch: what an author needs is the gap between
    // the press and the silence, and nobody reads a wall clock for that.
    expect(block).toContain("   +0.000  page 'book' (public) mounted");
    expect(block).toContain("   +1.000  the page answered the handshake");
    expect(block).toContain("rooms=3");
  });

  it("explains a refusal, which is the half that exists nowhere else", () => {
    // Answered on the port, into a promise the page usually does not await. On screen this is a
    // button that did nothing.
    const block = render((log) => log.add({ kind: "refused", reason: "undeclared-field" }));
    expect(block).toContain("REFUSED by the parent");
    expect(block).toContain("`createFields`");
  });

  it("reads a declined write as the control working, not as a fault", () => {
    // The parent judges `transition`, `assign` and `withdraw` and would perform them on the live
    // page. A run with nowhere to write answers `read-only`, and reading that as a fault would
    // condemn a page that did the right thing. It was explained only on a MEMBER page, because the
    // audience picked the vocabulary — so a public page's own `selfDelete`, which the one parent
    // now routes, had this printed at its author raw.
    const block = render((log) => log.add({ kind: "refused", reason: "read-only" }));
    expect(block).toContain("the control is wired, not that anything is wrong");
  });

  it("keeps the deployed rules' refusal, which the screen keeps only until the next attempt", () => {
    // The one thing this pane can report and the headless run never can: a real write, judged by
    // the rules as they are actually deployed.
    const block = render((log) => log.add({ kind: "write", cid: "bookings", error: "Missing or insufficient permissions" }));
    expect(block).toContain("was REFUSED");
    expect(block).toContain("Missing or insufficient permissions");
  });

  it("names the record a member's move was made on, and says a notice went with it", () => {
    // The row is NAMED, though the header of that module says values are not carried. A shared
    // app's ids are what the rules pin, so a line about an unnamed row is one an author cannot
    // place — and every one of these is about a row somebody pressed a button on.
    const block = render((log) => log.add({ kind: "intent", intent: "transition", cid: "bookings", itemId: "b1", to: "approved", error: null, mailed: true }));
    expect(block).toContain("PERFORMED the transition of 'bookings/b1' to 'approved'");
    // The one effect of this path that cannot be taken back. It must never happen silently.
    expect(block).toContain("a notice was QUEUED with it");
  });

  it("keeps an assignee's address out of the block, and still says one was named", () => {
    // The block is built to be pasted somewhere else, and an address is the clearest thing the
    // promise at the top of that module is about. Dropping the destination entirely would be worse
    // than either: `unknown-assignee` is a refusal ABOUT the address that was named, and a line
    // mentioning no destination reads as an assignment to nobody.
    const block = render((log) => log.add({ kind: "intent", intent: "assign", cid: "bookings", itemId: "b1", error: "unknown-assignee" }));
    expect(block).toContain("to an address this log does not carry");
    expect(block).toContain("nobody on the roster holds an assignable role");
  });

  it("names BOTH declarations for the one refusal that means two things", () => {
    // `unknown-collection` off a submission is about `public.submit`, and off a move it is about
    // the page's own view. There were two maps and the AUDIENCE chose between them, which stopped
    // working when one parent started answering both kinds of ask on every page. Naming both is
    // what replaced it: neither reader is sent to a declaration that has nothing to do with the
    // button they pressed.
    const move = render((log) => log.add({ kind: "intent", intent: "transition", cid: "bookings", itemId: "b1", to: "done", error: "unknown-collection" }));
    expect(move).toContain("`public.submit`");
    // And the two audiences' moves are declared in DIFFERENT places, which is the half a first
    // wording got wrong: a public page's moves come off `public.submit`, not off the view.
    expect(move).toContain("`selfTransitions`");
    expect(move).toContain("`collections[cid]`");
    // And the same sentence for a submission, because one vocabulary is the point.
    const sent = render((log) => log.add({ kind: "refused", reason: "unknown-collection" }));
    expect(sent).toContain("`public.submit`");
  });

  it("marks what the PAGE wrote as the page's, and never lets it end the quotation", () => {
    const block = render((log) => log.add({ kind: "notice", code: "error", detail: 'boom "and" \n more' }));
    // The reader is often a model being asked what went wrong. A string the page chose must not
    // arrive looking like something this host is saying, and a quotation mark inside it must not
    // close the quotation early.
    expect(block).toContain("page text:");
    expect(block).toContain('"boom \\"and\\" \\n more"');
    expect(block).toContain("the page raised an error nothing caught");
  });

  it("explains a modal the sandbox ignored, which does not fail and so leaves no other trace", () => {
    const block = render((log) => log.add({ kind: "notice", code: "modal-ignored", detail: "confirm" }));
    expect(block).toContain("`confirm` answers");
    expect(block).toContain("false");
  });

  it("repeats no name the page invented for its own failure", () => {
    // The runtime normalises an unrecognised code to `unknown`; this pins that the block does not
    // then print the page's word anyway in the name of being helpful.
    const block = render((log) => log.add({ kind: "notice", code: "unknown", detail: "" }));
    expect(block).toContain("a name this host does not know");
  });

  it("says the page asked to open an article, and that this pane stayed put", () => {
    // The alternative is a link that looks broken. The author clicks a headline on their own front
    // page — which is HTML they wrote, since the platform gave the index back — nothing moves, and
    // there is nothing anywhere to say whether the page asked or simply did nothing.
    const block = render((log) => log.add({ kind: "open", cid: "articles", id: "why-terminals-won" }));
    expect(block).toContain("the page asked to open 'why-terminals-won' in 'articles'");
    expect(block).toContain("the published page would go there");
  });

  it("does not count that as a problem, because nothing about it went wrong", () => {
    // The pane has no browser history to push onto, which is a fact about the pane. Counted, it
    // would light the amber on every correctly-wired magazine.
    const log = createPreviewLog({ now: ticking() });
    log.add({ kind: "open", cid: "articles", id: "why-terminals-won" });
    expect(log.problems()).toBe(0);
    expect(log.size()).toBe(1);
  });

  it("counts the problems and leaves an ordinary event alone", () => {
    const log = createPreviewLog({ now: ticking() });
    log.add({ kind: "handshake" });
    log.add({ kind: "submitted", cid: "bookings", fields: ["slot"] });
    log.add({ kind: "refused", reason: "busy" });
    log.add({ kind: "write", cid: "bookings", error: "nope" });
    log.add({ kind: "write", cid: "bookings", error: null });
    expect(log.problems()).toBe(2);
    expect(log.size()).toBe(5);
    expect(renderPreviewLog(header, log)).toContain("5 events, 2 problems");
  });

  it("says how much it dropped, rather than stopping quietly", () => {
    // A list that ends without saying so reads as the whole of what happened — and the events that
    // fall off the front are the early ones, which are usually the cause.
    const log = createPreviewLog({ now: ticking(), limit: 3 });
    for (let n = 0; n < 6; n += 1) log.add({ kind: "handshake" });
    expect(log.size()).toBe(3);
    expect(log.dropped()).toBe(3);
    expect(renderPreviewLog(header, log)).toContain("3 earlier events were dropped");
  });

  it("counts the problems it can still show, not the ones it has forgotten", () => {
    // The count sits above the list, so a running total disagrees with what is under it — "3
    // problems" printed over one — and the pane's amber stays lit about events nothing can produce
    // any more. What was lost is said by the dropped line instead.
    const log = createPreviewLog({ now: ticking(), limit: 2 });
    log.add({ kind: "refused", reason: "busy" });
    log.add({ kind: "refused", reason: "busy" });
    expect(log.problems()).toBe(2);
    log.add({ kind: "handshake" });
    log.add({ kind: "handshake" });
    expect(log.problems()).toBe(0);
    expect(log.dropped()).toBe(2);
    expect(renderPreviewLog(header, log)).toContain("2 events, 0 problems");
  });

  it("empties on demand, because the buffer belongs to one app", () => {
    const log = createPreviewLog({ now: ticking() });
    log.add({ kind: "refused", reason: "busy" });
    log.clear();
    expect(log.size()).toBe(0);
    expect(log.problems()).toBe(0);
    expect(log.dropped()).toBe(0);
    // And the clock starts again, so the next app's first event is at +0.000 rather than at
    // however long the author spent on the previous one.
    log.add({ kind: "handshake" });
    expect(renderPreviewLog(header, log)).toContain("   +0.000  the page answered the handshake");
  });

  it("folds a home directory away, on every platform's spelling of one", () => {
    // The same hole CLAUDE.md names about screenshots, open in a block built to be pasted.
    expect(foldHome("/Users/someone/git/rooms")).toBe("~/git/rooms");
    expect(foldHome("/home/someone/git/rooms")).toBe("~/git/rooms");
    expect(foldHome("C:\\Users\\someone\\git")).toBe("~\\git");
    expect(foldHome("/srv/shared/rooms")).toBe("/srv/shared/rooms");
    expect(render(() => {})).not.toContain("someone");
  });

  it("says what it does not say, on a run where nothing went wrong", () => {
    // A clean block with no closing reads as a clean bill of health. Three of these four failures
    // only appear after publishing, and the first catches authors out every time: the records were
    // read AS THE AUTHOR, who is an owner.
    const block = render((log) => log.add({ kind: "handshake" }));
    expect(block).toContain("Records here were read AS YOU");
    expect(block).toContain("nothing was concurrent");
  });

  it("does not promise more than it keeps about the page's own words", () => {
    // The one place a value can reach the block: a page is handed whole records and can throw one.
    // Keeping the text is the choice — it is the most actionable line the frame produces — so what
    // must not drift is the promise. A block that said "values are not recorded" full stop would be
    // making a claim its own `page text:` line breaks.
    const block = render((log) => log.add({ kind: "notice", code: "error", detail: "someone@example.com is not a slot" }));
    expect(block).toContain("someone@example.com");
    expect(block).toContain("marked `page text:`");
    expect(block).toContain("may contain");
  });

  it("is honest about a page that has done nothing at all", () => {
    // Distinct from a page that was never mounted only by what the header says, so the body must
    // not read as an absence of problems.
    expect(render(() => {})).toContain("Nothing happened yet");
  });
});
