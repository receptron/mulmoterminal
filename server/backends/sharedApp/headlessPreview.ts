// Running a shared app's pages, from the terminal, before anything is published.
//
// WHY THIS EXISTS. The pages are written by an agent and the agent cannot press a button. Everything
// else built for this problem stops short of the same line: `viewDefects.ts` READS a page and
// catches the two failures we have already met, and the Collections pane RUNS one but needs a
// person in front of it. What shipped broken (a lunch sign-up, published twice with a dead Submit
// button, 2026-08-14) was written, checked and published without the document ever being
// loaded once. This is the door that closes that: `manageSharedApp` with `action: "preview"`.
//
// WHAT IT PROVES, AND WHAT IT DOES NOT. It proves the document loads, the handshake completes, the
// records arrive, and a press reaches the parent as a submission the declaration accepts. It does
// NOT prove the deployed rules would accept the write — the run never accepts a confirmation (see
// `headlessHarness.ts`), because a tool call is not a person and the accept path writes a real
// record to the live database as the author. The table in `plans/feat-shared-app-preview.md`
// ("プレビューが証明しないもの") is the full list, and it applies here unchanged.
//
// ONE PRESS PER DOCUMENT. Each button is pressed on a freshly mounted page rather than in sequence
// on one, so what is reported about the third button is not a consequence of the first two. It
// costs a render each and buys an answer that can be read on its own.
//
// A REAL BROWSER, and that is not negotiable. jsdom has no sandbox, so it reproduces neither of the
// two failures this exists for: `allow-forms` is not absent because there is no attribute to be
// absent from, and a `MessagePort` handed to a document that no longer exists is not a thing it
// models. A run with no browser installed says so and reports nothing, which is the honest answer.
import { createServer, type Server } from "node:http";
import type { Browser, Frame, Page } from "puppeteer";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../../../common/isRecord.js";
import type { PreviewAudience, PreviewDataset } from "../../../common/sharedAppPreview.js";
import type { Viewer } from "@receptron/sharedapp/view";
import { previewPageKey } from "../../../common/sharedAppPreview.js";
import { previewSharedApp } from "./preview.js";
import { undoPreviewSubmission, writePreviewSubmission } from "./previewWrite.js";
import { VIEW_MOUNT, HARNESS_HTML, type HarnessObservation } from "./headlessHarness.js";

/** One document to run, with everything the parent would hand it. */
export interface HeadlessPageInput {
  id: string;
  audience: PreviewAudience;
  html: string;
  /** The records this page's own projection would receive — per page, never per app, for the
   *  reason `PreviewDatasets` gives: a member page may name a collection the public one must not
   *  be handed. */
  datasets: Record<string, PreviewDataset>;
  /** The real declaration. `null` for an app that opens nothing to the public — NOT an empty map,
   *  which does not switch the parent's check off but makes it refuse everything with
   *  `unknown-collection`, blaming a declaration that is correct. */
  submit: Record<string, { createFields: string[] }> | null;
  /** WHO the author is to this page and what they may change.
   *
   *  On EVERY audience: the public page has one too, because the rules let the person who submitted
   *  a row move it and take it away with no role at all. It no longer selects a parent — there is
   *  one — but it is still the difference between a page that draws its controls and a page that
   *  draws none and is reported as having none.
   *
   *  `undefined` where the projection resolved nothing, and never `{ me: null, can: {} }`: an empty
   *  `can` is a claim, and the page must be able to tell it from silence. */
  viewer?: Viewer | undefined;
  /** What the author has ALREADY SUBMITTED to this app, projected as the live page receives it.
   *
   *  Per app rather than per page — it asks after the reader, and the reader is the same person on
   *  every page. `undefined` is "nobody looked", which a page must not draw as "you have not
   *  answered": that is how a run reports a page as broken for correctly refusing to guess. */
  own?: Record<string, PreviewDataset> | undefined;
}

/** What the host does when a confirmation is accepted, and how it takes the write back.
 *
 *  INJECTED rather than imported, and that is what keeps `runPagesHeadless` drivable by a test with
 *  a page it wrote by hand — no app, no session, no database. A run given no writer declines every
 *  confirmation, exactly as every run did before `plans/feat-headless-preview-parity.md`, and says
 *  so in its report rather than looking like a run that found nothing to press.
 *
 *  `write` is `writePreviewSubmission` and `undo` is `undoPreviewSubmission` — the same two
 *  functions the pane reaches through its HTTP route, so what the rules judge here is the record
 *  the pane would have made. */
export interface PreviewWriter {
  write: (cid: string, values: Record<string, string>) => Promise<{ ok: boolean; error?: string; token?: string; reason?: WriteFailure }>;
  /** Best effort by contract: it answers what happened rather than throwing, because a record that
   *  could not be removed is something the report must SAY, not something that takes the run down
   *  after the page has already been judged. */
  undo: (token: string) => Promise<{ ok: boolean; error?: string }>;
}

/** WHOSE refusal it was, when a write did not happen.
 *
 *  Not every unsuccessful write is the rules speaking, and reporting one as the other is worse than
 *  reporting nothing: an author told "the deployed rules refused this" goes and changes their
 *  declaration, when what actually happened was a projection that would not build or a record they
 *  themselves already have.
 *
 *  - `rules` — the write was made and the database refused it. THIS is the answer the run exists
 *    to bring back, and the only one that says anything about what a visitor would get.
 *  - `taken` — the id was already in use. Under `idFrom: "auth.uid"` that means the AUTHOR has a
 *    record here, which says nothing about a visitor: they have a different uid and would succeed.
 *  - `host` — this side never got as far as writing: no session, a projection that would not
 *    build, a field the form requires and the page did not send. About the app or the run, not
 *    about the rules. */
export type WriteFailure = "rules" | "taken" | "host";

/** What the database said about one accepted confirmation, and what became of the record.
 *
 *  The answer this whole action was missing: everything else a headless run proves stops at the
 *  parent, and the rules are the last judge nobody could ask without a person in front of a pane. */
export interface HeadlessWrite {
  cid: string;
  /** The deployed rules accepted it. */
  ok: boolean;
  /** Why not — named by the host's vocabulary where it could name one, because the rules answer
   *  "Missing or insufficient permissions" and nothing else. Empty when accepted. */
  error: string;
  /** Who refused. Meaningless when `ok`, where it is `rules` — the party that accepted. */
  reason: WriteFailure;
  /** What happened to the record afterwards.
   *
   *  `removed` is the ordinary path and it runs IMMEDIATELY, before the next press: a run that
   *  swept up at the end would leave its own record in the way of the next press, and an app that
   *  keys by `auth.uid` would then report its second button as refused by rules that were in fact
   *  refusing a duplicate of ours.
   *
   *  `left` is the one that must never be silent — a booking left standing occupies a real slot. */
  cleanup: "removed" | "left" | "not-written";
  /** Why the record could not be taken back. Empty unless `cleanup` is `left`. */
  cleanupError: string;
}

/** What one press produced. */
export interface HeadlessPress {
  label: string;
  /** The control had nowhere to be clicked — `display:none`, zero-sized, or off the document.
   *
   *  Its own answer rather than a press that reached nothing, because the two want opposite things
   *  done about them: one is a handler that is not wired up, the other is a control no cursor can
   *  arrive at.
   *
   *  What tells them apart is that the press is a REAL press — dispatched at the control's
   *  coordinates, through the browser. `element.click()` in the page's own realm invokes the
   *  handler whatever is on top of the button, so a control under an overlay would be reported as
   *  submitting. It is not reported as unclickable either: the click happens, the overlay receives
   *  it, and nothing reaches the parent — which is exactly what the visitor gets. */
  notClickable: boolean;
  /** The submission that reached the parent, if one did. `null` is the dead button. */
  submitted: { cid: string; fields: string[] } | null;
  /** What the parent refused before drawing a confirmation. Invisible in a browser: it is answered
   *  on the port, into a promise the page usually does not await. */
  refused: string[];
  /** The submission reached the parent but the runtime did not mark it as caused by a click, so
   *  this run did not write it.
   *
   *  Its own flag, and not `writeSkipped`: one is a budget this run spent, the other is a
   *  submission whose CAUSE is unestablished. A record in somebody's real app needs a reason, and
   *  "it turned up while I was clicking" is not one.
   *
   *  An app pinned to a runtime older than 0.9.0 marks nothing at all, so every submission is
   *  withheld and nothing is written. That is not a broken page.
   *
   *  The one that surprises authors: a handler that `await`s work which actually yields
   *  (`await validate()` doing I/O) resumes in a later task, so its submission lands here and is
   *  not written. Awaiting an already-resolved promise does not — see `GESTURE_MARK`.
   *
   *  A control that saves from its own `change` handler does NOT land here, and the difference
   *  matters: `CLICKABLE` never selects it, so there is no press and therefore no flag — the save
   *  path is simply not covered, silently. */
  writeWithheld: boolean;
  /** The browser reported a form submission the sandbox blocked. The page cannot see this happen —
   *  the `submit` event never fires, so `preventDefault()` never runs — and neither can the author,
   *  unless they have the console open. */
  blockedFormSubmission: boolean;
  /** The write the confirmation became, or null.
   *
   *  Null covers three different things and the report tells them apart from `submitted`: nothing
   *  was submitted at all, the run had no writer, or the run's write budget was spent. */
  write: HeadlessWrite | null;
  /** The confirmation was DECLINED because this run had already accepted its budget's worth.
   *
   *  Its own flag rather than a null `write`, because "we chose not to ask" and "the page never
   *  asked" are opposite findings about the button. */
  writeSkipped: boolean;
  /** What the page said about itself during this press, through the runtime's `notice` port.
   *  PAGE-AUTHORED text — reported as the page's words, never as the host's. */
  notices: { code: string; detail: string }[];
  errors: string[];
}

export interface HeadlessPageReport {
  id: string;
  audience: PreviewAudience;
  readied: boolean;
  stateDelivered: boolean;
  /** The document stopped answering: it never finished loading, or a question to it ran out of
   *  time. A script that never returns does this — and without a deadline it does it to the CALLER
   *  too, which is a tool call that never comes back and, because shared-app operations are
   *  serialised per repository, everything queued behind it. */
  unresponsive: boolean;
  /** Submissions the page made BEFORE anything was pressed — on load, from `onState`, from a
   *  timer. Its own number because it is two findings at once: a visitor is shown a confirmation
   *  they never asked for, and every press below would otherwise inherit it. */
  submittedOnLoad: number;
  /** Forms in the LIVE document, which is a different question from the one `viewDefects.ts` asks
   *  of the source: a page that builds its form in JavaScript has none in its HTML. */
  liveForms: number;
  /** What is actually on the screen, trimmed. The single most useful line in the report — a page
   *  stuck on its loading state says so here in the author's own words. */
  text: string;
  /** Where the picture of this page was written, or null when none was taken.
   *
   *  A PATH rather than the image, because what reads this report is an agent holding a tool
   *  result: bytes would cost the whole context and a path costs a line, and the agent can open it
   *  when the text gives it a reason to. This is the pane's last remaining advantage handed over —
   *  a person looking at the screen — and it is the only way a run reports that the page drew
   *  everything in the wrong place.
   *
   *  Null is not a failure of the page: see `screenshotError`. */
  screenshot: string | null;
  /** Why there is no picture. Empty when there is one, or when none was asked for. */
  screenshotError: string;
  /** What the page said about itself on load, before anything was pressed. */
  notices: { code: string; detail: string }[];
  presses: HeadlessPress[];
  /** Controls this run did NOT press. Counted rather than inferred from `presses.length`: a page
   *  with exactly the budget's worth of controls and a page whose eleventh control was dropped
   *  produce the same length, so the report would either claim a truncation that did not happen or
   *  hide one that did. */
  pressesOmitted: number;
  errors: string[];
}

export type HeadlessRun =
  | {
      ok: true;
      pages: HeadlessPageReport[];
      /** Pages the budget dropped. Carried rather than left to be inferred from a count, because
       *  "ran 6 pages" reads as "ran the app" — and the seventh is then published having never
       *  been loaded, which is the exact failure this whole action exists to end. */
      omittedPages: number;
      /** Confirmations this run DECLINED because its write budget was spent. Reported at the top,
       *  where a reader deciding whether the app was exercised will see it. */
      writesSkipped: number;
      /** Where the pictures were written, when any were. Named once at the end so an agent has the
       *  directory rather than only the files. */
      screenshotDir: string | null;
      /** Whether this run could write at all. False is every run driven by a test, and the report
       *  must say so — a run that declined everything and a run that wrote and was accepted are
       *  the same page with opposite conclusions. */
      wrote: boolean;
    }
  | { ok: false; problems: string[] };

/** How much of one run is enough. Every one of these is a budget rather than a rule about pages:
 *  a run is started by an agent waiting on a tool call, and an app with forty buttons is not worth
 *  forty renders to say the same thing. What is dropped is REPORTED (see `narrate`), because a
 *  silent cap reads as "everything was covered".
 *
 *  There is no budget here for "how long to watch a page before trusting it". There WAS, and it was
 *  wrong in kind rather than in size: whether a click caused a submission is not a question about
 *  elapsed time, so no value of it was ever going to be right. See `GESTURE_MARK`.
 *
 *  `writes` is the one that costs somebody ELSE. Every accepted confirmation is a real record in
 *  the live database, removed again immediately — but removed by a best effort, and six pages of
 *  six controls would be up to thirty-six of them. Four is enough to learn what the rules say,
 *  which is one answer per declaration and not one per button.
 *
 *  `readyMs` is the one that costs. It is only ever WAITED OUT by a page that will never answer,
 *  and a page that will answer does so in a few milliseconds — the handshake is two messages
 *  between a frame and its own parent. So it is short: it is paid once per mount by exactly the
 *  pages that are broken, and every mount of them. */
/** Every wait a headless run may make, in one place.
 *
 *  `navigateMs` is the newest and the reason the others are worth listing: the harness navigation
 *  was the one wait with no budget of its own, inheriting Puppeteer's 30s default — six times what
 *  the `waitForFunction` on the line after it gets, in a file whose discipline is choosing these
 *  numbers (#2103). Sized so that `openHarness`'s three attempts cost about what ONE attempt used
 *  to, rather than three times it; not sized down to `evaluateMs`, because a loaded runner reading
 *  a local bundle can legitimately take seconds and a budget that is too small produces the
 *  spurious failure this repo has already paid for once (receptron/mulmoclaude#3201).
 *
 *  `harnessMs` is what actually bounds `openHarness`, and it exists because the per-attempt
 *  arithmetic did NOT: one attempt is a navigation AND the wait after it AND the pause before the
 *  next, so three reach 45s while `navigateMs` alone suggests 30s. Promising something about the
 *  whole from a budget for one phase is how that claim came out wrong (CodeRabbit on #2104); the
 *  loop watches the clock now instead of counting. */
export const LIMITS = {
  pages: 6,
  presses: 6,
  writes: 4,
  harnessAttempts: 3,
  harnessMs: 30_000,
  navigateMs: 10_000,
  retryPauseMs: 250,
  evaluateMs: 5000,
  readyMs: 2000,
  settleMs: 600,
  textChars: 400,
} as const;

/** The clickable things, in document order. `input[type=submit]` is in the list although the
 *  sandbox will never let one submit — that IS the finding, and a scan that skipped them would
 *  report a page with no buttons at all. */
const CLICKABLE = "button, [role=button], input[type=submit], input[type=button], a[href='#']";

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The runtime's own `dist/view`, resolved rather than guessed.
 *
 *  `import.meta.resolve` and not a path relative to this file: this repository is itself an npm
 *  package, so where `@receptron/sharedapp` lands depends on the install that put it there
 *  (hoisted beside us, nested under us, or a workspace link), and a hand-built path is right on a
 *  developer's machine and wrong under `npx`. */
function viewDistDir(): string {
  return path.dirname(fileURLToPath(import.meta.resolve("@receptron/sharedapp/view")));
}

/** Serve the harness and the runtime, on a loopback port, for the life of one run.
 *
 *  Over HTTP rather than `setContent` or a `data:` URL because the harness is an ES MODULE and its
 *  imports are relative: it needs a real base URL to resolve them against. 127.0.0.1 is also a
 *  secure context, which `viewNonce`'s `crypto.randomUUID()` requires. */
async function serveHarness(): Promise<{ origin: string; close: () => Promise<void> }> {
  const dir = viewDistDir();
  // An ALLOW-LIST built from the directory, so a request path never becomes a filesystem path.
  const allowed = new Set((await readdir(dir)).filter((name) => name.endsWith(".js")));
  const server: Server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(HARNESS_HTML);
        return;
      }
      // Answered rather than left to 404, because the browser asks for it unprompted and the miss
      // lands in the page's own console — where this run collects it and reports it to the author
      // as something their page did.
      if (pathname === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }
      const name = pathname.startsWith(`${VIEW_MOUNT}/`) ? pathname.slice(VIEW_MOUNT.length + 1) : "";
      if (!allowed.has(name)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(await readFile(path.join(dir, name)));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Fill every empty input with something of the right shape.
 *
 *  Because a press is judged on a freshly mounted page, and a page that validates its own form
 *  would then refuse for a reason that has nothing to do with what is being tested. The values are
 *  deliberately dull: nothing is ever written, so they only have to get past the page's own checks.
 *
 *  Runs INSIDE the frame, as a string, because the frame's origin is opaque — the harness cannot
 *  reach into it, and only the browser automation can. */
/** The types this must not touch, and each is its own kind of damage.
 *
 *  `file` is the one that stopped a run: assigning a non-empty value to it throws, and the throw
 *  took the whole action down — an app with an upload control reported nothing at all rather than
 *  reporting its handshake and its buttons. `submit`, `button`, `reset` and `image` carry the
 *  control's LABEL in `value`, so filling them renames the button this run is about to press and
 *  then reports it under a name the page never had. `hidden` is the page's own bookkeeping. */
const UNFILLABLE = new Set(["file", "submit", "button", "reset", "image", "hidden"]);

const FILL_INPUTS = `(() => {
  const skip = ${JSON.stringify([...UNFILLABLE])};
  const fill = (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  for (const el of document.querySelectorAll("input, textarea, select")) {
    // Per element. One control this browser refuses to be written to must not take the run with
    // it: what is being measured is the page, and a page is still worth a report without it.
    try {
      if (el.disabled || skip.includes(el.type)) continue;
      if (el.tagName === "SELECT") {
        const option = [...el.options].find((o) => o.value !== "");
        if (option !== undefined && el.value === "") fill(el, option.value);
        continue;
      }
      if (el.type === "checkbox" || el.type === "radio") {
        // BOTH events, as a real click gives. A page that reveals its Submit button from an
        // \`input\` handler on a checkbox was surveyed with the box ticked and the button still
        // absent — and reported as a page with no control to press.
        if (!el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        continue;
      }
      if (el.value !== "") continue;
      if (el.type === "email") fill(el, "preview@example.com");
      else if (el.type === "number" || el.type === "range") fill(el, "1");
      else if (el.type === "date") fill(el, "2026-01-01");
      else if (el.type === "datetime-local") fill(el, "2026-01-01T10:00");
      else if (el.type === "time") fill(el, "10:00");
      else if (el.type === "tel") fill(el, "09000000000");
      else if (el.type === "url") fill(el, "https://example.com");
      else fill(el, "preview");
    } catch (err) {
      // Swallowed on purpose, and nothing is reported: this is the harness preparing the page, not
      // the page misbehaving. Blaming the author for it would be blaming them for our own step.
    }
  }
})()`;

/** What a person would call this control. Falls back through the places a label can hide, and
 *  ends at the tag name so a press is never reported as an empty string. */
const LABELS = `[...document.querySelectorAll(${JSON.stringify(CLICKABLE)})].map((el) =>
  (el.innerText || el.value || el.getAttribute("aria-label") || el.id || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 60))`;

/** Puppeteer, or the reason there is none.
 *
 *  Lazily, and tolerantly, for the reason `server/backends/markdown.ts` gives: it is a heavy
 *  optional dependency and this server has to boot without it. A run with no browser is an answer,
 *  not a crash. */
async function browserOrProblem(): Promise<{ ok: true; browser: Browser } | { ok: false; problems: string[] }> {
  try {
    const puppeteer = (await import("puppeteer")).default;
    // NO PROXY, and this is not a preference. Puppeteer's default arguments include
    // `--proxy-bypass-list=<-loopback>`, which turns OFF Chrome's usual "never proxy localhost" —
    // so on a machine with a system proxy configured (a Windows CI runner is one) the harness's
    // own 127.0.0.1 server is fetched through it and the navigation is aborted:
    // `net::ERR_ABORTED at http://127.0.0.1:<port>`. The whole conversation here is between this
    // process and a browser it started, over loopback, so there is nothing a proxy could be for.
    return { ok: true, browser: await puppeteer.launch({ headless: true, args: ["--proxy-server=direct://", "--proxy-bypass-list=*"] }) };
  } catch (err) {
    return {
      ok: false,
      problems: [
        `A headless preview needs a real browser and none could be started (${messageOf(err)}).`,
        "jsdom is not an alternative: it has no sandbox, so it reproduces neither the blocked form submission nor the dropped port that this exists to catch.",
        "Ask the user to open the Collections pane and press Preview instead — it runs the same parent, with them in front of it.",
      ],
    };
  }
}

/** Reading back what crossed `evaluate`.
 *
 *  Narrowed rather than asserted, and that is a house rule with teeth here: what comes back is a
 *  value the BROWSER produced, on the far side of a boundary this process does not control, so an
 *  assertion would be a promise about somebody else's runtime. A malformed answer degrades to
 *  "nothing observed" — which reads, correctly, as a page that did nothing. */
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

const asSubmitted = (value: unknown): { cid: string; fields: string[] }[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => (isRecord(entry) && typeof entry.cid === "string" ? [{ cid: entry.cid, fields: asStrings(entry.fields) }] : []))
    : [];

const asNotices = (value: unknown): { code: string; detail: string }[] =>
  Array.isArray(value)
    ? value.flatMap((entry) =>
        isRecord(entry) && typeof entry.code === "string" && typeof entry.detail === "string" ? [{ code: entry.code, detail: entry.detail }] : [],
      )
    : [];

const asPending = (value: unknown): { cid: string; values: Record<string, string>; clickCaused: boolean } | null =>
  isRecord(value) && typeof value.cid === "string"
    ? { cid: value.cid, values: isRecord(value.values) ? asValues(value.values) : {}, clickCaused: value.clickCaused === true }
    : null;

const NOTHING_OBSERVED: HarnessObservation = { readied: false, stateDelivered: false, submitted: [], refused: [], notices: [], pending: null };

/** A submission's values, as the harness hands them over. String-valued by construction on the
 *  page's side, narrowed here for the same reason everything else crossing that boundary is: what
 *  arrives is a value the BROWSER produced. A key whose value is not a string is dropped rather
 *  than coerced — the write is judged by the deployed rules, and inventing a value for it would
 *  make the verdict be about a record nobody wrote. */
const asValues = (value: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (typeof entry === "string" ? [[key, entry] as const] : [])));

const asObservation = (value: unknown): HarnessObservation =>
  isRecord(value)
    ? {
        readied: value.readied === true,
        stateDelivered: value.stateDelivered === true,
        submitted: asSubmitted(value.submitted),
        refused: asStrings(value.refused),
        notices: asNotices(value.notices),
        pending: asPending(value.pending),
      }
    : NOTHING_OBSERVED;

const BLOCKED_FORM = "Blocked form submission";

/** The browser, with everything one run needs said in this repository's words rather than
 *  puppeteer's. Made by `openDriver` so the reporting below reads as what it is doing rather than
 *  as automation. */
export interface Driver {
  /** Mount one document and wait for the handshake — or for the wait to run out, which is itself
   *  the answer (`ready()` never reached the parent). Clears what the browser has said, so what is
   *  collected afterwards belongs to THIS document. */
  mount: (input: HeadlessPageInput) => Promise<void>;
  observe: () => Promise<HarnessObservation>;
  /** The rendered document. `null` while nothing is mounted. */
  frame: () => Frame | null;
  /** Everything the BROWSER said since the last mount, not only what the page's own scripts said.
   *  A blocked form submission arrives this way and by no other: the browser refuses, so there is
   *  no exception, no rejected promise, and nothing for the page to catch. */
  noise: () => string[];
  /** Questions of OURS this document broke, since the last `mount`. Kept apart from `noise`
   *  because the two are read on different clocks: page noise is sliced from the moment before a
   *  press, so anything that failed while the inputs were being filled falls outside the slice —
   *  and on the path where the control is gone there is no slice at all. Cleared by `mount`. */
  askFailures: () => string[];
  evaluate: (script: string, target?: Frame) => Promise<unknown>;
  decline: () => Promise<void>;
  /** Answer the confirmation with a verdict this process already has. The page's own post-submit
   *  path then runs against the real answer — nothing in the browser reaches a database. */
  accept: (answer: { ok: boolean; error?: string }) => Promise<void>;
  /** Write a picture of the RENDERED DOCUMENT — not of the harness, whose chrome is nobody's
   *  concern — and answer where it went, or why it could not be taken. */
  screenshot: (file: string) => Promise<string>;
  /** Something this document was asked ran out of time. Cleared by `mount` — so a caller that
   *  mounts more than once (`reportPage` does, once per press) has to accumulate it. */
  stalled: () => boolean;
}

/** The deadline expiring, told apart from every answer a script can give.
 *
 *  It was `undefined`, and `undefined` is what a perfectly healthy script returns: `FILL_INPUTS`
 *  is an IIFE with no `return` and `decline()` answers nothing, and both run on every page, on
 *  every mount. So EVERY page was reported unresponsive — and that verdict is the first line of
 *  the report, saying the page never got going and that nothing below it describes its behaviour,
 *  directly above an accurate account of the page drawing and its button reaching the parent. A
 *  false red costs more than the missing flag would: the author is told to go fix a page that
 *  works, and the one real thing this flag catches — a script that keeps the frame's thread — is
 *  now indistinguishable from every other run. */
const TIMED_OUT = Symbol("the deadline expired");

/** Wait for `work`, but not for ever.
 *
 *  Everything crossing into the browser is a question put to code the author wrote, and an author's
 *  script is allowed to never return: an inline loop keeps the frame's own thread, so `load` never
 *  fires and an `evaluate` on it never settles. Unbounded, that is not a slow preview — it is a
 *  tool call that never answers, holding the per-repository lock behind it. On the deadline the
 *  answer is `undefined`, which every reader here already treats as "nothing observed". */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The worst one attempt can cost: the navigation, the wait for the harness to appear, and the
 *  pause before another attempt is started. */
const ATTEMPT_WORST_MS = LIMITS.navigateMs + LIMITS.evaluateMs + LIMITS.retryPauseMs;

/** May another attempt START, given what the loop has already spent?
 *
 *  Exported and pure because it is the rule the budget rests on, and this arithmetic is exactly
 *  what went wrong the first time: a loop that only counts attempts promises a bound it does not
 *  keep. An attempt is allowed only if the WHOLE of it fits in what is left, so the last thing to
 *  happen is a real failure carrying a real diagnostic, rather than a caller abandoning a wait
 *  nobody budgeted. */
export const roomForAnotherHarnessAttempt = (elapsedMs: number): boolean => elapsedMs + ATTEMPT_WORST_MS <= LIMITS.harnessMs;

/** Get the harness page loaded, and do not accept a first refusal.
 *
 *  `page.goto` has come back `net::ERR_ABORTED` against this server on a Windows runner while the
 *  same code worked everywhere else — a browser this process started, fetching a loopback port
 *  this process is listening on. Chrome aborts a main-resource load for reasons that have nothing
 *  to do with the resource (a sandboxed network service that cannot reach loopback, a proxy
 *  configuration applied to localhost), and most of them do not survive a second attempt.
 *
 *  `domcontentloaded` rather than `load`, and then the harness is waited for BY NAME: what this
 *  needs is the module having run, and `load` is neither necessary nor sufficient for that. A
 *  failure here names what was missing instead of arriving later as "render is not a function". */
async function openHarness(page: Page, origin: string): Promise<void> {
  let last: unknown = null;
  const startedAt = Date.now();
  for (let attempt = 0; attempt < LIMITS.harnessAttempts; attempt += 1) {
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: LIMITS.navigateMs });
      await page.waitForFunction("window.__preview !== undefined", { timeout: LIMITS.evaluateMs });
      return;
    } catch (err) {
      last = err;
      if (!roomForAnotherHarnessAttempt(Date.now() - startedAt)) break;
      await new Promise((resolve) => setTimeout(resolve, LIMITS.retryPauseMs));
    }
  }
  // Whether NODE can reach it, said in the same sentence. It separates "the server never came up"
  // from "the browser would not fetch it", which are different faults with the same message.
  const reachable = await fetch(origin)
    .then((response) => `node fetched it: ${response.status}`)
    .catch((err: unknown) => `node could not fetch it either: ${messageOf(err)}`);
  throw new Error(`the harness page at ${origin} would not load (${messageOf(last)}; ${reachable})`);
}

/** Write a picture of the rendered document, and answer what went wrong or an empty string.
 *
 *  The BYTES come back and this writes them, rather than handing puppeteer a path: its `path`
 *  option is typed as a `.png`/`.jpeg` template literal, and satisfying that from a value built at
 *  runtime needs an assertion — a promise to the compiler about a string this module composed, for
 *  no gain over writing the file itself.
 *
 *  Bounded like every other question put to the browser: a page holding its own thread would hold
 *  this too, and a picture is a diagnostic — it must never be the reason a run does not come back. */
async function photograph(page: Page, file: string): Promise<string> {
  const element = await page.$("iframe");
  if (element === null) return "there was no rendered document to photograph";
  const taken = await withDeadline(
    element
      .screenshot()
      .then(async (bytes) => {
        await writeFile(file, bytes);
        return "";
      })
      .catch((err: unknown) => `the picture could not be taken: ${messageOf(err)}`),
    LIMITS.evaluateMs,
  );
  return taken === TIMED_OUT ? "the picture could not be taken: the page did not settle in time" : taken;
}

async function openDriver(browser: Browser, origin: string): Promise<Driver> {
  const page = await browser.newPage();
  let noise: string[] = [];
  let askFailures: string[] = [];
  page.on("console", (message) => noise.push(message.text()));
  page.on("pageerror", (err) => noise.push(messageOf(err)));
  await openHarness(page, origin);
  /** Every script is sent as a STRING rather than as a closure: the server's TypeScript project
   *  declares no DOM (`types: ["node"]`), so a closure mentioning `window` would not compile. */
  let stalled = false;
  const evaluate = async (script: string, target?: Frame): Promise<unknown> => {
    // A rejection is NOT a page that stopped answering, and it is not nothing either. It is a
    // question that could not be put: a getter of the page's own that throws, or a frame that
    // navigated itself out from under the handle we were holding. Every reader here treats
    // `undefined` as "nothing observed", so left alone it becomes a page with no controls and no
    // text — reported as calmly as an empty page, which is the shape of a false green.
    //
    // So it goes where the browser's own complaints already go, and travels the path they travel:
    // per mount into `errors`, per press into that press's `errors`. Said as OUR question failing,
    // because the reader of that list is the author and the list is otherwise their page's words.
    //
    // WHICH mount it is said to is decided HERE, when the question is put, not when the answer
    // comes back. A question that ran out of time is abandoned by `withDeadline` but not by the
    // browser: it is still outstanding, and Puppeteer rejects it later — when the frame it was
    // asked of is replaced by the NEXT mount. Reaching for the current arrays at that moment
    // files page A's failure under page B, or under a press that had nothing to do with it. The
    // arrays this mount is reading are captured instead, so a late rejection lands in one nobody
    // holds any more and is discarded, which is what a report about page B should say about it.
    const pageSink = noise;
    const askSink = askFailures;
    const asked = (target ?? page).evaluate(script).catch((err: unknown) => {
      const line = `the preview could not put a question to this page: ${messageOf(err)}`;
      pageSink.push(line);
      askSink.push(line);
      return undefined;
    });
    // Only the deadline moves this flag.
    const answered = await withDeadline(asked, LIMITS.evaluateMs);
    if (answered === TIMED_OUT) {
      stalled = true;
      return undefined;
    }
    return answered;
  };
  return {
    evaluate,
    askFailures: () => askFailures,
    stalled: () => stalled,
    frame: () => page.frames().find((candidate) => candidate.url() === "about:srcdoc") ?? null,
    noise: () => noise,
    observe: async () => asObservation(await evaluate("window.__preview.observe()")),
    decline: async () => {
      await evaluate("window.__preview.decline()");
    },
    accept: async (answer) => {
      await evaluate(`window.__preview.accept(${JSON.stringify(answer)})`);
    },
    screenshot: (file) => photograph(page, file),
    mount: async (input) => {
      noise = [];
      askFailures = [];
      stalled = false;
      // The render is awaited on ITS OWN deadline (`evaluate`'s), because what it waits for is the
      // frame's `load` — which a script that never returns never reaches.
      await evaluate(
        `window.__preview.render(${JSON.stringify({
          html: input.html,
          datasets: input.datasets,
          submit: input.submit,
          viewer: input.viewer ?? null,
          own: input.own ?? null,
        })})`,
      );
      await page.waitForFunction("window.__preview.observe().readied", { timeout: LIMITS.readyMs }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, LIMITS.settleMs));
    },
  };
}

/** Press ONE control, on a document mounted for it alone.
 *
 *  Freshly mounted rather than pressed in sequence, so what is reported about the third control is
 *  not a consequence of the first two — and the inputs are filled first, so a page that validates
 *  its own form does not refuse for a reason that has nothing to do with what is being asked. */
/** One press, and HOW MANY controls the page turned out to have once its inputs were filled.
 *
 *  The count comes back with the press because it is only knowable here. The survey is taken
 *  before the filling, and filling can ADD controls — so a page whose survey found one control can
 *  have two by the time anything is pressed, and a loop bounded by the survey would press the new
 *  one and never press the original while reporting that nothing was left out. */
interface PressResult {
  press: HeadlessPress;
  controls: number;
}

/** How the run answers a confirmation, and what it has left to spend.
 *
 *  Threaded rather than held in a module-level counter: two runs in one process would share one,
 *  and shared-app operations serialise per REPOSITORY, so two of them at once is ordinary. */
export interface WriteBudget {
  writer: PreviewWriter | null;
  left: number;
  skipped: number;
  /** Tokens for records this run made and has NOT yet decided the fate of.
   *
   *  Kept by `tracking()` around the writer rather than by the code that accepts, so that a token
   *  is registered the instant the WRITE answers — before anything else can go wrong, and whether
   *  or not the run is still in a position to read the answer. It is removed once its undo has been
   *  ATTEMPTED, successfully or not: a failed undo is reported on the press that made it, and
   *  retrying it in the sweep would contradict that line.
   *
   *  So what is left in here at the end is only the path where the run died between a write and
   *  its undo. Without it, that record is one nothing in the world knows about — not the report,
   *  which never got written, and not the author. */
  outstanding: Set<string>;
}

/** Answer the confirmation, and take the record straight back.
 *
 *  IMMEDIATELY, not at the end of the run. Every press mounts a fresh page, so a record left
 *  standing is in the way of the next press — and an app whose id comes from `auth.uid` would then
 *  refuse its second button with a rules error that is entirely our own doing. Cleaning up between
 *  presses is what makes each press's verdict about the page rather than about the run.
 *
 *  It answers `null` when nothing was accepted, so a caller can tell "the run chose not to ask"
 *  from "the page never asked" — those are opposite findings about a button. */
async function acceptOne(driver: Driver, writer: PreviewWriter, pending: { cid: string; values: Record<string, string> }): Promise<HeadlessWrite> {
  // THE WRITE HAPPENS HERE, in Node, and is awaited here. Not inside `driver.accept()` and not on
  // the far side of any deadline: every question put to the browser is bounded by `evaluateMs`,
  // and a write that outran that bound would be abandoned by the run while the database went on
  // to accept it — a real record that nothing reports and nothing removes. What is bounded is
  // telling the PAGE the answer, which is a message and not a network call.
  const answer: { ok: boolean; error?: string; token?: string; reason?: WriteFailure } = await writer
    .write(pending.cid, pending.values)
    .catch((err: unknown) => ({ ok: false, error: messageOf(err), reason: "host" as const }));
  const error = answer.error ?? "";
  await driver.accept(answer.ok ? { ok: true } : { ok: false, error });
  if (!answer.ok) return { cid: pending.cid, ok: false, error, reason: answer.reason ?? "rules", cleanup: "not-written", cleanupError: "" };
  const token = answer.token ?? "";
  if (token.length === 0) {
    // Accepted, and nothing to undo it with. Said rather than swallowed: the record is real and
    // this run cannot remove it, which is precisely the case an author must be told about.
    return { cid: pending.cid, ok: true, error: "", reason: "rules", cleanup: "left", cleanupError: "the write came back with no token to take it back with" };
  }
  const undone = await writer.undo(token).catch((err: unknown) => ({ ok: false, error: messageOf(err) }));
  if (undone.ok) return { cid: pending.cid, ok: true, error: "", reason: "rules", cleanup: "removed", cleanupError: "" };
  return { cid: pending.cid, ok: true, error: "", reason: "rules", cleanup: "left", cleanupError: undone.error ?? "the record could not be removed" };
}

/** The state this press is measured from, with anything left over from the mount answered first.
 *
 *  A page that submits on load leaves a confirmation open across the mount, and the parent refuses a
 *  second one while it is (`busy`) — so without this, every button on such a page is answered by
 *  the bridge rather than by the page, and reported as having reached nothing. Clearing it is what
 *  gets the control actually exercised.
 *
 *  It is NOT part of deciding whether to write. It was, for two rounds — declining and then
 *  re-reading was an attempt to keep the page's own resubmission out of this press's count — and
 *  that whole line of reasoning is gone (`GESTURE_MARK`). What is left here is only about giving
 *  the button a fair chance to be pressed, so it is free to be imperfect.
 *
 *  The extra wait is paid ONLY by a page that had something pending. An ordinary page observes once
 *  and goes straight to the click. */
async function clearedGround(driver: Driver): Promise<HarnessObservation> {
  const seen = await driver.observe();
  if (seen.pending === null) return seen;
  await driver.decline();
  await new Promise((resolve) => setTimeout(resolve, LIMITS.settleMs));
  return driver.observe();
}

/** Answer the confirmation this press raised, if it raised one and this run may write for it.
 *
 *  Split out of `pressOne` for the line budget, and it reads as the decision it is. Returns what the
 *  database said, plus WHY nothing was written when nothing was — the three reasons are opposite
 *  findings about the button and the report says them apart. */
export async function answerPress(
  driver: Driver,
  budget: WriteBudget,
  request: { submitted: { cid: string; fields: string[] } | null; pending: { cid: string; values: Record<string, string>; clickCaused: boolean } | null },
): Promise<{ write: HeadlessWrite | null; skipped: boolean; withheld: boolean }> {
  // ONE CONDITION, and it is a fact rather than an inference: the runtime marked this submission
  // as made while a real click was being handled. Everything that used to stand here — was there
  // a confirmation open before, did the count grow, has this page been quiet for a while — was an
  // attempt to infer a cause from timing, and each one was defeated by a page that simply waited
  // longer (`plans/feat-headless-preview-parity.md`, D-2c). None of it is left.
  const caused = request.pending !== null && request.pending.clickCaused;
  const writer = caused ? budget.writer : null;
  let write: HeadlessWrite | null = null;
  if (writer !== null && request.pending !== null) {
    if (budget.left > 0) {
      budget.left -= 1;
      write = await acceptOne(driver, writer, request.pending);
    } else {
      budget.skipped += 1;
    }
  }
  // A press that raised no confirmation is declined too: `decline()` on a bridge with nothing
  // pending is a no-op, and asking first would be a second round trip to learn what is already
  // known.
  if (write === null) await driver.decline();
  return {
    write,
    skipped: writer !== null && write === null,
    // The submission was real and the run could have written it; what was missing was a reason to
    // believe the press caused it.
    withheld: !caused && request.submitted !== null && budget.writer !== null,
  };
}

async function pressOne(driver: Driver, input: HeadlessPageInput, index: number, budget: WriteBudget): Promise<PressResult | null> {
  await driver.mount(input);
  const frame = driver.frame();
  if (frame === null) return null;
  await driver.evaluate(FILL_INPUTS, frame);

  // THE NAME IS TAKEN FROM THE PAGE AS IT IS NOW, not from the survey before the inputs were
  // filled. Filling fires `input` and `change`, and a page that reacts to those can add, remove or
  // reorder its controls — so the control at this index may not be the one the survey saw. Report
  // what is actually about to be clicked, or say the control is gone.
  const labels = asStrings(await driver.evaluate(LABELS, frame));
  const label = labels[index];
  if (label === undefined) {
    // WITH the failures of the two questions above. This path is reached when `LABELS` came back
    // empty — and `LABELS` REJECTING comes back empty too, so a page that breaks the survey and a
    // page with nothing to press arrive here identically. Reported with an empty `errors` list,
    // the first one reads as the second: a control that is simply not there, with no sign that the
    // run never got to look.
    const gone: HeadlessPress = {
      label: `control ${index + 1}`,
      notClickable: true,
      submitted: null,
      refused: [],
      blockedFormSubmission: false,
      write: null,
      writeSkipped: false,
      writeWithheld: false,
      notices: [],
      errors: [...new Set(driver.askFailures())],
    };
    return { press: gone, controls: labels.length };
  }

  // Located BEFORE the snapshot below. Each of these is a round trip to the browser, and anything
  // the page does during one of them would otherwise land in the window being attributed to the
  // press.
  const controls = await frame.$$(CLICKABLE);
  const control = controls[index];

  // WHAT WAS ALREADY THERE, read as late as it can be — with the control in hand and nothing left
  // to do but click it.
  //
  // The recorder is cleared per MOUNT, not per press, and a page can submit on its own: from its
  // opening script, from `onState`, from a timer. Read without this, that submission is reported
  // as the work of whichever control happened to be under test — and since every press gets a
  // fresh mount, EVERY button on such a page looks correctly wired when none of them is.
  const before = await clearedGround(driver);
  const noiseBefore = driver.noise().length;

  // THROUGH THE BROWSER, at the control's coordinates, so the event lands where a person's would.
  // `element.click()` in the page's own realm invokes the handler regardless of what covers the
  // button — and this action would then report a submission reaching the parent for a control
  // nobody can press, which is the opposite of what it promises.
  const notClickable = await control
    ?.click()
    .then(() => false)
    .catch(() => true);
  await new Promise((resolve) => setTimeout(resolve, LIMITS.settleMs));
  const after = await driver.observe();
  const submitted = after.submitted[before.submitted.length] ?? null;
  const answered = await answerPress(driver, budget, { submitted, pending: after.pending });
  // Read AFTER the accept: the write is where a page's own error handler runs, and a notice raised
  // there is the most useful one on the page.
  const finished = answered.write === null ? after : await driver.observe();
  const noise = driver.noise().slice(noiseBefore);
  const press: HeadlessPress = {
    label,
    notClickable: notClickable !== false,
    submitted,
    refused: finished.refused.slice(before.refused.length),
    blockedFormSubmission: noise.some((line) => line.includes(BLOCKED_FORM)),
    write: answered.write,
    // `skipped` is true only where the BUDGET was the reason: a null writer or an unanswered press
    // is not a choice this run made, and `withheld` is a different choice again.
    writeSkipped: answered.skipped,
    writeWithheld: answered.withheld,
    notices: finished.notices.slice(before.notices.length),
    // The page's own words from the press window, PLUS every question of ours this mount broke —
    // `FILL_INPUTS` and `LABELS` are put before the window opens, so their failures are not in the
    // slice, and losing them here is how a page that answered nothing is reported as a page that
    // did nothing. Deduplicated, so a failure inside the window is not said twice.
    errors: [...new Set([...noise.filter((line) => !line.includes(BLOCKED_FORM)), ...driver.askFailures()])],
  };
  return { press, controls: labels.length };
}

async function reportPage(driver: Driver, input: HeadlessPageInput, budget: WriteBudget, shot: string | null): Promise<HeadlessPageReport> {
  await driver.mount(input);
  const observed = await driver.observe();
  const frame = driver.frame();
  // BEFORE anything is filled in or pressed, because that is the page a visitor first meets — and
  // because a picture taken after a press would be of whichever control happened to be last, which
  // represents nothing.
  const screenshotError = shot === null ? "" : await driver.screenshot(shot);
  const liveForms = frame === null ? 0 : asNumber(await driver.evaluate(`document.querySelectorAll("form").length`, frame));
  const text =
    frame === null ? "" : asString(await driver.evaluate(`(document.body.innerText || "").replace(/\\s+/g, " ").trim().slice(0, ${LIMITS.textChars})`, frame));
  // SURVEYED WITH THE INPUTS FILLED, and after the screen above has been read.
  //
  // A page can have no control at all until something is filled in — a Submit revealed by ticking
  // a box is ordinary — and a survey taken before the filling finds none, so nothing is pressed and
  // the report says the page has no controls. AFTER the text, because that belongs to the page as a
  // visitor first meets it.
  if (frame !== null) await driver.evaluate(FILL_INPUTS, frame);
  const labels = frame === null ? [] : asStrings(await driver.evaluate(LABELS, frame));
  // AFTER the filling, and before any press mounts again (which clears it). A handler of the
  // author's that throws while an input is being filled is the page's own fault and is often the
  // reason no control ever appears — captured before this line, it was reported nowhere.
  // `FILL_INPUTS`'s own failures are swallowed inside it, so nothing here is the harness's.
  const errors = [...new Set(driver.noise())];
  // READ NOW, and kept. `mount` clears the flag, and every press below mounts again — so asking
  // the driver at the end of this function answers for the last press alone. A page whose
  // `innerText` getter never returns but whose buttons answer normally stalls HERE and nowhere
  // after, and would be reported as responsive with an empty screen and no reason given.
  let unresponsive = driver.stalled();

  // The survey is only a STARTING estimate of how many controls there are: filling the inputs can
  // add some (see `pressOne`), and a loop bounded by the survey would then press the newcomer,
  // never press the original, and report that nothing was left out. Each press says what it found,
  // and the bound grows to it.
  const presses: HeadlessPress[] = [];
  let controls = labels.length;
  for (let index = 0; index < Math.min(controls, LIMITS.presses); index += 1) {
    const result = await pressOne(driver, input, index, budget);
    unresponsive = unresponsive || driver.stalled();
    if (result === null) break;
    presses.push(result.press);
    controls = Math.max(controls, result.controls);
  }
  return {
    id: input.id,
    audience: input.audience,
    readied: observed.readied,
    stateDelivered: observed.stateDelivered,
    unresponsive,
    submittedOnLoad: observed.submitted.length,
    liveForms,
    text,
    screenshot: shot === null || screenshotError !== "" ? null : shot,
    screenshotError,
    notices: observed.notices,
    presses,
    pressesOmitted: Math.max(0, controls - presses.length),
    errors,
  };
}

/** Somewhere to put the pictures, outside the author's repository.
 *
 *  The temp directory and never the working tree: a preview must leave nothing behind for a commit
 *  to pick up, and an author who ran it twice would otherwise be looking at a diff of screenshots.
 *  It is not cleaned up — the whole point is that an agent opens the files AFTER the tool call has
 *  returned, so removing them at the end of the run would remove them before they were read. The OS
 *  clears the directory on its own schedule, which is the right owner for a file nobody keeps. */
async function screenshotDir(): Promise<string | null> {
  try {
    return await mkdtemp(path.join(tmpdir(), "mulmoterminal-preview-"));
  } catch {
    // A run without pictures is still a run. Reported by the pages' own `screenshotError`, so the
    // reader learns the reason rather than finding the field missing.
    return null;
  }
}

/** A file name a directory listing can be read: the audience, the page, and nothing a page id
 *  could smuggle in. */
const shotName = (input: HeadlessPageInput, index: number): string =>
  `${index + 1}-${input.audience}-${input.id.replace(/[^a-zA-Z0-9._-]/gu, "_")}.png`.slice(0, 120);

/** The writer with a ledger around it.
 *
 *  Wrapped rather than asked to keep one: the token has to be recorded at the moment the WRITE
 *  answers, which is inside the writer's own call, and anything reading it afterwards is one more
 *  place the run can die before the record is accounted for.
 *
 *  `undo` removes the token whether it worked or not — a failure is reported on the press that made
 *  it, and the sweep re-trying it would contradict that. */
const tracking = (writer: PreviewWriter, outstanding: Set<string>): PreviewWriter => ({
  write: async (cid, values) => {
    const result = await writer.write(cid, values);
    if (result.ok && result.token !== undefined && result.token !== "") outstanding.add(result.token);
    return result;
  },
  undo: async (token) => {
    // `finally`, so a writer that THROWS still counts as attempted. Otherwise the sweep retries a
    // record the press below has already reported as standing, and the report and the database
    // disagree about it — in the direction that makes the report the wrong one.
    try {
      return await writer.undo(token);
    } finally {
      outstanding.delete(token);
    }
  },
});

/** Run the pages. Separated from the Firestore half below so a test can drive it with a page it
 *  wrote by hand — no app, no session, no database.
 *
 *  `writer` is what decides whether a confirmation is accepted. Null — the default, and what every
 *  test passes — declines them all, exactly as this whole action did before
 *  `plans/feat-headless-preview-parity.md`. */
export async function runPagesHeadless(pages: readonly HeadlessPageInput[], writer: PreviewWriter | null = null): Promise<HeadlessRun> {
  const started = await browserOrProblem();
  if (!started.ok) return started;
  const { browser } = started;
  // Started INSIDE the try, because it can throw on a reachable path — `import.meta.resolve` on a
  // layout that does not have the package where it looks, or a `dist/view` that is not there — and
  // a throw before the try leaves the launched browser running with nobody holding it. The failure
  // has to come back as an answer for the same reason everything else here does: the caller is a
  // tool call whose contract is prose, not an exception.
  let harness: { origin: string; close: () => Promise<void> } | null = null;
  // Declared out here so the sweep below can reach it on the path where the run threw — which is
  // the only path the sweep exists for.
  let budget: WriteBudget | null = null;
  try {
    harness = await serveHarness();
    const driver = await openDriver(browser, harness.origin);
    const dir = await screenshotDir();
    const outstanding = new Set<string>();
    budget = { writer: writer === null ? null : tracking(writer, outstanding), left: LIMITS.writes, skipped: 0, outstanding };
    const reports: HeadlessPageReport[] = [];
    for (const [index, input] of pages.slice(0, LIMITS.pages).entries()) {
      reports.push(await reportPage(driver, input, budget, dir === null ? null : path.join(dir, shotName(input, index))));
    }
    return {
      ok: true,
      pages: reports,
      omittedPages: Math.max(0, pages.length - LIMITS.pages),
      writesSkipped: budget.skipped,
      screenshotDir: reports.some((report) => report.screenshot !== null) ? dir : null,
      wrote: writer !== null,
    };
  } catch (err) {
    return { ok: false, problems: [`The headless preview could not be run: ${messageOf(err)}`] };
  } finally {
    await sweep(budget);
    await harness?.close();
    await browser.close();
  }
}

/** One more attempt at anything this run wrote and never decided the fate of.
 *
 *  Reached only when the run threw between a write and its undo. It reports nothing, and that is
 *  not an oversight: there is no report on that path — the caller is getting a failure — and a
 *  record removed here is a record nobody needs to hear about. What it buys is that the failure
 *  does not also leave a booking standing in somebody's app.
 *
 *  Its own errors are swallowed for the same reason: it runs inside a `finally` that is already
 *  carrying a failure, and throwing here would replace the reason the run died with the reason
 *  the cleanup did. */
async function sweep(budget: WriteBudget | null): Promise<void> {
  if (budget === null || budget.writer === null) return;
  for (const token of budget.outstanding) {
    await budget.writer.undo(token).catch(() => undefined);
  }
  budget.outstanding.clear();
}

/** The writer this repository's app gets: the pane's own two functions, nothing wrapped around
 *  them.
 *
 *  `writePreviewSubmission` is reached DIRECTLY rather than through `/api/shared-app/preview/submit`,
 *  which is how the pane reaches it. Not because the route is wrong — because it is a route: HTTP,
 *  JSON and a session, for a call this process is already inside. The verdict comes from the same
 *  place either way, which is the only thing parity asks for. */
const repositoryWriter = (root: string): PreviewWriter => ({
  write: async (cid, values) => {
    const result = await writePreviewSubmission(root, cid, values);
    return result.ok ? { ok: true, token: result.written.token } : { ok: false, error: result.error, reason: result.reason };
  },
  undo: async (token) => {
    const result = await undoPreviewSubmission(token);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },
});

/** The whole action: work out what this repository would publish, then run it.
 *
 *  The projection comes from `previewSharedApp`, which is what the pane asks too — so what runs
 *  here is what the author would see there, and neither is a rehearsal of the other. */
/** Run every page this app declares and report what happened.
 *
 *  `write` IS OFF BY DEFAULT, and that is the safety boundary rather than the undo. Accepting a
 *  confirmation puts a real record in the live app — briefly, but a creation is not always
 *  reversible by deleting the row: rules, functions or an integration may act on it, notifications
 *  may already have gone out, and `cleanup` can itself fail (the report has a field for exactly
 *  that). A diagnostic the agent reaches for after every edit must not do any of that unasked, so
 *  the caller has to say `confirm: true` — the same word `publish` uses for "I accept a real
 *  consequence". Raised in review of #1770 by two reviewers independently. */
export async function headlessPreview(root: string, opts: { write?: boolean } = {}): Promise<HeadlessRun> {
  const preview = await previewSharedApp(root);
  if (!preview.ok) return { ok: false, problems: preview.problems };
  if (preview.pages.length === 0) {
    return {
      ok: false,
      problems: [
        preview.generatedForm
          ? "This app publishes a GENERATED form rather than a page of its own, and there is no authored document to run. Its inputs come from the declaration — check them in the Collections pane."
          : "This app declares no views, so there is no page to run.",
      ],
    };
  }
  const inputs = preview.pages.map((page): HeadlessPageInput => ({
    id: page.id,
    audience: page.audience,
    html: page.html,
    datasets: preview.datasets[previewPageKey(page.audience, page.id)] ?? {},
    ...(page.viewer === undefined ? {} : { viewer: page.viewer }),
    // The same rows the pane sends, so a page asking "have I registered?" gets the same answer in
    // both — an author whose page behaves differently under the two is looking at a difference this
    // repository invented.
    own: preview.own,
    submit: Object.keys(preview.submit).length > 0 ? preview.submit : null,
  }));
  return runPagesHeadless(inputs, opts.write === true ? repositoryWriter(root) : null);
}
