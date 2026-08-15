// Running a shared app's pages, from the terminal, before anything is published.
//
// WHY THIS EXISTS. The pages are written by an agent and the agent cannot press a button. Everything
// else built for this problem stops short of the same line: `viewDefects.ts` READS a page and
// catches the two failures we have already met, and the Collections pane RUNS one but needs a
// person in front of it. What shipped broken (a lunch sign-up, published twice with a dead Submit
// button, 2026-08-14) was written, checked, deployed and published without the document ever being
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
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../../../common/isRecord.js";
import type { PreviewAudience, PreviewDataset } from "../../../common/sharedAppPreview.js";
import { previewPageKey } from "../../../common/sharedAppPreview.js";
import { previewSharedApp } from "./preview.js";
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
  /** The browser reported a form submission the sandbox blocked. The page cannot see this happen —
   *  the `submit` event never fires, so `preventDefault()` never runs — and neither can the author,
   *  unless they have the console open. */
  blockedFormSubmission: boolean;
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
    }
  | { ok: false; problems: string[] };

/** How much of one run is enough. Every one of these is a budget rather than a rule about pages:
 *  a run is started by an agent waiting on a tool call, and an app with forty buttons is not worth
 *  forty renders to say the same thing. What is dropped is REPORTED (see `narrate`), because a
 *  silent cap reads as "everything was covered".
 *
 *  `readyMs` is the one that costs. It is only ever WAITED OUT by a page that will never answer,
 *  and a page that will answer does so in a few milliseconds — the handshake is two messages
 *  between a frame and its own parent. So it is short: it is paid once per mount by exactly the
 *  pages that are broken, and every mount of them. */
export const LIMITS = { pages: 6, presses: 6, evaluateMs: 5000, readyMs: 2000, settleMs: 600, textChars: 400 } as const;

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

const asObservation = (value: unknown): HarnessObservation =>
  isRecord(value)
    ? {
        readied: value.readied === true,
        stateDelivered: value.stateDelivered === true,
        submitted: asSubmitted(value.submitted),
        refused: asStrings(value.refused),
      }
    : { readied: false, stateDelivered: false, submitted: [], refused: [] };

const BLOCKED_FORM = "Blocked form submission";

/** The browser, with everything one run needs said in this repository's words rather than
 *  puppeteer's. Made by `openDriver` so the reporting below reads as what it is doing rather than
 *  as automation. */
interface Driver {
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
  evaluate: (script: string, target?: Frame) => Promise<unknown>;
  decline: () => Promise<void>;
  /** Something this document was asked ran out of time. Cleared by `mount`. */
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.waitForFunction("window.__preview !== undefined", { timeout: LIMITS.evaluateMs });
      return;
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  // Whether NODE can reach it, said in the same sentence. It separates "the server never came up"
  // from "the browser would not fetch it", which are different faults with the same message.
  const reachable = await fetch(origin)
    .then((response) => `node fetched it: ${response.status}`)
    .catch((err: unknown) => `node could not fetch it either: ${messageOf(err)}`);
  throw new Error(`the harness page at ${origin} would not load (${messageOf(last)}; ${reachable})`);
}

async function openDriver(browser: Browser, origin: string): Promise<Driver> {
  const page = await browser.newPage();
  let noise: string[] = [];
  page.on("console", (message) => noise.push(message.text()));
  page.on("pageerror", (err) => noise.push(messageOf(err)));
  await openHarness(page, origin);
  /** Every script is sent as a STRING rather than as a closure: the server's TypeScript project
   *  declares no DOM (`types: ["node"]`), so a closure mentioning `window` would not compile. */
  let stalled = false;
  const evaluate = async (script: string, target?: Frame): Promise<unknown> => {
    // A script that THREW is not a page that stopped answering: it answered, with a failure, and
    // every reader here already treats `undefined` as "nothing observed". Only the deadline moves
    // this flag.
    const answered = await withDeadline(
      (target ?? page).evaluate(script).catch(() => undefined),
      LIMITS.evaluateMs,
    );
    if (answered === TIMED_OUT) {
      stalled = true;
      return undefined;
    }
    return answered;
  };
  return {
    evaluate,
    stalled: () => stalled,
    frame: () => page.frames().find((candidate) => candidate.url() === "about:srcdoc") ?? null,
    noise: () => noise,
    observe: async () => asObservation(await evaluate("window.__preview.observe()")),
    decline: async () => {
      await evaluate("window.__preview.decline()");
    },
    mount: async (input) => {
      noise = [];
      stalled = false;
      // The render is awaited on ITS OWN deadline (`evaluate`'s), because what it waits for is the
      // frame's `load` — which a script that never returns never reaches.
      await evaluate(`window.__preview.render(${JSON.stringify({ html: input.html, datasets: input.datasets, submit: input.submit })})`);
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

async function pressOne(driver: Driver, input: HeadlessPageInput, index: number): Promise<PressResult | null> {
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
    const gone: HeadlessPress = { label: `control ${index + 1}`, notClickable: true, submitted: null, refused: [], blockedFormSubmission: false, errors: [] };
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
  const before = await driver.observe();
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
  // Answered the way somebody who changed their mind would, so the page's own "cancelled" path
  // runs and nothing is left waiting on a promise that never settles.
  await driver.decline();
  const noise = driver.noise().slice(noiseBefore);
  const press: HeadlessPress = {
    label,
    notClickable: notClickable !== false,
    submitted: after.submitted[before.submitted.length] ?? null,
    refused: after.refused.slice(before.refused.length),
    blockedFormSubmission: noise.some((line) => line.includes(BLOCKED_FORM)),
    errors: [...new Set(noise.filter((line) => !line.includes(BLOCKED_FORM)))],
  };
  return { press, controls: labels.length };
}

async function reportPage(driver: Driver, input: HeadlessPageInput): Promise<HeadlessPageReport> {
  await driver.mount(input);
  const observed = await driver.observe();
  const frame = driver.frame();
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

  // The survey is only a STARTING estimate of how many controls there are: filling the inputs can
  // add some (see `pressOne`), and a loop bounded by the survey would then press the newcomer,
  // never press the original, and report that nothing was left out. Each press says what it found,
  // and the bound grows to it.
  const presses: HeadlessPress[] = [];
  let controls = labels.length;
  for (let index = 0; index < Math.min(controls, LIMITS.presses); index += 1) {
    const result = await pressOne(driver, input, index);
    if (result === null) break;
    presses.push(result.press);
    controls = Math.max(controls, result.controls);
  }
  return {
    id: input.id,
    audience: input.audience,
    readied: observed.readied,
    stateDelivered: observed.stateDelivered,
    unresponsive: driver.stalled(),
    submittedOnLoad: observed.submitted.length,
    liveForms,
    text,
    presses,
    pressesOmitted: Math.max(0, controls - presses.length),
    errors,
  };
}

/** Run the pages. Separated from the Firestore half below so a test can drive it with a page it
 *  wrote by hand — no app, no session, no database. */
export async function runPagesHeadless(pages: readonly HeadlessPageInput[]): Promise<HeadlessRun> {
  const started = await browserOrProblem();
  if (!started.ok) return started;
  const { browser } = started;
  // Started INSIDE the try, because it can throw on a reachable path — `import.meta.resolve` on a
  // layout that does not have the package where it looks, or a `dist/view` that is not there — and
  // a throw before the try leaves the launched browser running with nobody holding it. The failure
  // has to come back as an answer for the same reason everything else here does: the caller is a
  // tool call whose contract is prose, not an exception.
  let harness: { origin: string; close: () => Promise<void> } | null = null;
  try {
    harness = await serveHarness();
    const driver = await openDriver(browser, harness.origin);
    const reports: HeadlessPageReport[] = [];
    for (const input of pages.slice(0, LIMITS.pages)) {
      reports.push(await reportPage(driver, input));
    }
    return { ok: true, pages: reports, omittedPages: Math.max(0, pages.length - LIMITS.pages) };
  } catch (err) {
    return { ok: false, problems: [`The headless preview could not be run: ${messageOf(err)}`] };
  } finally {
    await harness?.close();
    await browser.close();
  }
}

/** The whole action: work out what this repository would publish, then run it.
 *
 *  The projection comes from `previewSharedApp`, which is what the pane asks too — so what runs
 *  here is what the author would see there, and neither is a rehearsal of the other. */
export async function headlessPreview(root: string): Promise<HeadlessRun> {
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
    submit: Object.keys(preview.submit).length > 0 ? preview.submit : null,
  }));
  return runPagesHeadless(inputs);
}
