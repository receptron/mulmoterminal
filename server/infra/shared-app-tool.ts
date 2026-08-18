// manageSharedApp — MulmoTerminal's own tool for the shared-app operations.
//
// It is NOT an action on `manageCollection`. That tool's definition and dispatch both live in
// `@mulmoclaude/core`, so adding to it would be a change to MulmoClaude for a feature only
// MulmoTerminal has — the boundary this design fixed (D5). Core keeps the pure half: parsing the
// declaration, deciding what is wrong with it, projecting documents. What is here, and in
// `server/backends/sharedApp/`, is the operation: the order the documents are written in, and
// what a half-finished write leaves behind.
//
// There is exactly ONE write path to a shared app, and this is it. Core's whole-app `publishApp`
// was deleted rather than left unused (mulmoclaude #2871) because MulmoTerminal declares the
// shared-collections capability and binds the Firestore accessor — an action left in core would
// simply work here, and it wrote `public` without ever passing through the gates in this file.
import type { ToolDefinition } from "gui-chat-protocol";
import { headlessPreview } from "../backends/sharedApp/headlessPreview.js";
import { narrateHeadlessRun } from "../backends/sharedApp/headlessReport.js";
import { publishSharedApp } from "../backends/sharedApp/publish.js";
import { unpublishSharedApp } from "../backends/sharedApp/unpublish.js";
import {
  APP_ROLE_NAMES,
  checkSharedApp,
  forkSharedApp,
  initSharedApp,
  inviteToSharedApp,
  type AppRoleName,
  type RecordScanResult,
} from "../backends/sharedApp/declare.js";
import { isRecord } from "../../common/isRecord.js";
import { MULMOSERVER_ORIGIN } from "../../common/firebaseConfig.js";
import { manifestKey } from "../backends/sharedApp/manifestWrite.js";
import { serializeBy } from "../backends/sharedApp/serialize.js";

export const SHARED_APP_ACTIONS = ["init", "fork", "check", "preview", "invite", "publish", "unpublish"] as const;
export type SharedAppAction = (typeof SHARED_APP_ACTIONS)[number];

export const MANAGE_SHARED_APP: ToolDefinition = {
  type: "function",
  name: "manageSharedApp",
  description:
    "Start, check, run, invite to, publish or unpublish this repository's shared app (the one declared by its app.json). " +
    "preview loads the app's pages in a real browser, in the same sandbox a visitor gets, presses their controls, and reports what happened; it writes nothing unless you send `confirm: true`, which additionally reports what the deployed rules say about a real submission it makes and then removes. " +
    "publish writes the declaration, the collection schemas and the app's pages; when app.json declares a `public` block it also opens the app to anonymous visitors, and unpublish closes that again.",
  prompt:
    "A request for something OTHER PEOPLE fill in or read — a survey, a sign-up sheet, a booking form, a form behind a link — is a shared app, and the `mulmoterminal-shared-app` skill is the path from that sentence to this tool. Read it before offering a printable page or a third-party form.\n" +
    "`manageSharedApp` operates on the repository the session is open in — the one holding `app.json` — and it is the only way to write a shared app.\n" +
    "**init** writes `app.json` for a repository that has none, with the SIGNED-IN address as its owner — use it instead of composing the file yourself, because the owner has to be the address this machine is signed in with and you cannot read that.\n" +
    "**fork** turns a CLONE of somebody else's shared app into the user's own — a new `aid`, a roster of one, the same collections. It is the answer to \"this repository is a clone, make it mine\", and the ONLY one: `init` refuses a repository that already declares an app, so composing the file by hand or deleting `app.json` first are both worse versions of this. It carries `collections` and `public` over unchanged, never touches `.claude/skills/`, and refuses outright when the signed-in address already owns the app.\n" +
    "**check** reports everything wrong with the declaration and this repository's shared collections WITHOUT writing anything. Run it after any edit to `app.json`; it is the only way to find out whether a declaration is publishable before it is published.\n" +
    "**preview** RUNS the pages. It loads each one in a real headless browser, inside the same sandbox and CSP a visitor gets, hands it the app's real records, and presses each control on a freshly loaded copy of the page. It runs to a budget and SAYS what it left out, so read the counts rather than assuming everything was covered. It reports what a person would otherwise have to notice by eye: a page that never finished loading, a button that does nothing, a form the sandbox blocked, a submission the declaration refused. BY DEFAULT IT WRITES NOTHING, and that is the mode to reach for after an edit. With `confirm: true` it WRITES a real record for a press the runtime marked as click-caused, reads what the DEPLOYED RULES said, and removes the record straight away — reporting the verdict, and whether the removal succeeded. Ask the user before sending `confirm`: the record is real while it exists, something may act on it, and the removal can fail. In the default read-only mode every submission is reported as WITHHELD. With `confirm: true`, a submission the runtime did not mark is reported as WITHHELD and nothing is written for it: a timer, `onState`, a runtime older than 0.9.0, and — the one that surprises authors — a click handler that `await`s work which actually yields, such as `async () => { await validate(); submit() }`, because it resumes in a later task. Tell the author THAT is why their save wrote nothing, rather than letting them conclude the button is broken. Writes run to their own budget; over it, a confirmation is declined and counted. TWO THINGS IT CANNOT TELL YOU, and both are silent: a control that saves from its own `change` handler (a checkbox, a select) is never pressed at all, so it produces no line — not even a withheld one — and the save path goes untested; and the verdict is always the AUTHOR's, because this and the Collections pane both write through the same author path, so NEITHER preview says what the rules would answer a visitor or a participant. Say so rather than letting a clean report stand for either. It also TRIES to write a picture of each page and gives you the path for every one it managed; open it when the words leave the layout in doubt, and read the line that says why a page has none. Run it after writing or editing any view, and again before you publish. If it cannot start a browser it says so; then ask the user to press Preview in the Collections pane.\n" +
    "**invite** adds, changes or removes ONE address on the roster (`email`, `role`, optional `cid`; omit `role` to remove). It edits app.json only — it takes effect at the next publish.\n" +
    "**publish** is the dangerous one, and it is the ONLY thing that writes an app after `init`. It writes this repository's declaration, schemas and pages as they are right now, and — when app.json declares `public` — opens the app to anonymous visitors. A declaration with no `public` block publishes to the roster and grants the world nothing. Run `preview` first: nothing else stands between what an LLM wrote and what everybody sees. Publish only when the user asks for it in those terms.\n" +
    "**unpublish** closes the app to anonymous visitors — the `public` block, the world-readable config and the URL name. The schemas and the roster's own pages are LEFT, so the front desk goes on working at /m/{slug} and publishing again just re-opens the public side.\n" +
    "publish refuses when live records would not satisfy the schema being written, and lists the records. `confirm: true` overrides that refusal — ask the user first: it means accepting a known breakage for everybody the app is for.\n" +
    "It also refuses a declaration with NO `aid` rather than generating one, and that refusal is not a thing to work around: at publish a missing id means the app lost its identity, and minting would publish a SECOND app — new document, roster of one, none of the records, the first one left where it is. Put the original value back (app.json is committed: `git show HEAD:app.json`). Never clear the `aid` to start over, and never delete the app document from the console: Firestore does not cascade, and the records, the schemas and the member and roster pages are authorized THROUGH it, so while it is missing they are denied to every rules-bound reader — while the world-readable `config/*` keeps being served and can no longer be withdrawn. Publishing again under the SAME aid re-creates the parent and reaches them once more, which is what makes the aid the thing to protect.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...SHARED_APP_ACTIONS],
        description:
          "init = write app.json and create the app (it reserves the URL name too); fork = take over a clone of somebody else's app; check = report what is wrong without writing; preview = run the pages in a real browser and report what happened; invite = one roster entry; publish = write everything and open it; unpublish = close it again.",
      },
      name: { type: "string", description: "init / fork: the app's human name. fork carries the cloned app's name over when this is omitted." },
      slug: {
        type: "string",
        description:
          "init / fork: the wanted URL name (lowercase, hyphens). It is a wish — a taken one gets a number appended. fork does NOT carry the cloned app's name over, so ask for one.",
      },
      email: { type: "string", description: "invite: the address to add, change or remove." },
      role: {
        type: "string",
        enum: [...APP_ROLE_NAMES],
        description:
          "invite: what they may do. Omit to REMOVE the address. owner publishes; editor writes records; viewer reads them; participant sees only its own rows; " +
          "assignee reads every row and writes only the ones assigned to it (needs collections.<cid>.assigneeField, and needs a cid — it cannot be app-wide).",
      },
      cid: { type: "string", description: "invite: one collection instead of the whole app. Defaults to the whole app." },
      confirm: {
        type: "boolean",
        description:
          "Two meanings, both 'I accept a real consequence'. On publish: write the schema although live records do not satisfy it — it accepts the breakage for everybody the app is for. On preview: let the run make REAL records in the live app to learn what the deployed rules say, each removed straight after. Without it, preview still runs every page and reports everything, and simply writes nothing. ASK THE USER BEFORE SENDING IT, either way.",
      },
    },
    required: ["action"],
  },
};

function parseAction(raw: unknown): SharedAppAction | null {
  if (typeof raw !== "string") return null;
  return SHARED_APP_ACTIONS.find((action) => action === raw) ?? null;
}

/** A stamp line both successes end with, because "which commit is this?" is the first question
 *  asked of a shared app that behaves unexpectedly — and `dirty` is the answer that matters, a
 *  commit that does not describe what was written being worse than no commit at all. */
function provenance(commit: string | undefined, dirty: boolean): string {
  if (commit === undefined) return "No commit was recorded (no git, or no commits yet).";
  return dirty ? `Recorded commit ${commit}, but the working tree was MODIFIED — the commit does not describe what was written.` : `Recorded commit ${commit}.`;
}

/** " at https://mulmoserver.web.app/a/sakura-hair", or nothing. Two of these rather than an inline conditional inside a
 *  template, because a sentence that reads well with and without the clause is the only thing
 *  worth optimising here.
 *
 *  The `/a/` is not decoration: the public face of an app is served at `a/:slug` and there is no
 *  bare `/:slug` route at all — it falls through to the not-found page. An address printed here
 *  is the one the author hands to a visitor, so a missing prefix is not a typo in a message, it
 *  is a link that does not open the app. The ORIGIN is here for the same reason: a path on its
 *  own cannot be pasted into an invitation, and the author is reading this on a machine whose own
 *  address is not where the app is served. */
const at = (slug: string | undefined): string => (slug === undefined ? "" : ` at ${MULMOSERVER_ORIGIN}/a/${slug}`);

const noLonger = (slug: string | undefined): string => (slug === undefined ? "" : `, ${MULMOSERVER_ORIGIN}/a/${slug} no longer resolves`);

/** What was said about a page without stopping it. Prefixed so it cannot be read as a refusal —
 *  the operation went through, and the author is being told something to look at. */
const warningNote = (warnings: readonly string[]): string[] => warnings.map((warning) => `Warning: ${warning}`);

function recordNote(issues: number, capped: boolean): string[] {
  if (issues === 0) return [];
  const count = capped ? `at least ${issues}` : String(issues);
  return [`${count} live record${issues === 1 ? "" : "s"} do not satisfy the schema that was just written (you confirmed this) — they need repairing.`];
}

/** What a published members' page means, said out loud.
 *
 *  Required rather than nice: the argument that makes a PUBLIC view safe — it
 *  can only carry off data any stranger could already fetch — does not hold
 *  here. A members' page is handed the real records: names, contact details,
 *  who is coming at three. The platform does not stop an owner's own page from
 *  moving an owner's own data anywhere, and does not pretend to, so the person
 *  publishing one should know that is what they are doing. */
/** "live at https://…/m/sakura-hair: desk." — or, when no URL name is declared, the truth in
 *  place of an address. `/m/:slug` and `/p/:slug` both need one, and an app may publish pages
 *  without declaring any; printing `/m/{slug}` there hands back exactly what the rest of this
 *  file exists to prevent, a URL that opens the not-found page. Exported for the spec beside it:
 *  the no-slug branch is a sentence nobody sees until an author hits it. */
export const entrance = (url: string | null, tier: string, pages: readonly string[]): string =>
  url === null
    ? `published: ${pages.join(", ")}. No address reaches them yet — /${tier}/:slug needs a URL name, and app.json declares no \`slug\`.`
    : `live at ${url}: ${pages.join(", ")}.`;

export function pageNote(memberPages: readonly string[], participantPages: readonly string[], slug: string | undefined): string[] {
  const lines: string[] = [];
  // Hoisted rather than inlined: the address has to appear here, spelled out, for the spec beside
  // this file to be able to see it (it reads the source — no type reaches the router).
  const staff = slug === undefined ? null : `${MULMOSERVER_ORIGIN}/m/${slug}`;
  const own = slug === undefined ? null : `${MULMOSERVER_ORIGIN}/p/${slug}`;
  if (memberPages.length > 0) {
    lines.push(
      `Staff pages ${entrance(staff, "m", memberPages)} These are handed the app's REAL records — a page you publish here can show, and can carry off, whatever the person opening it may read. Only people holding a role in this app can open them.`,
    );
  }
  if (participantPages.length > 0) {
    lines.push(
      `Participant pages ${entrance(own, "p", participantPages)} Each person sees only their own row, which is the rules' answer rather than the page's.`,
    );
  }
  return lines;
}

async function narratePublish(root: string, confirm: boolean): Promise<string> {
  const result = await publishSharedApp(root, { confirm });
  if (!result.ok) return result.problems.join("\n");
  const plural = result.cids.length === 1 ? "" : "s";
  return [
    `Published apps/${result.aid}: wrote ${result.cids.length} collection${plural} (${result.cids.join(", ")}).`,
    result.publicOpen
      ? `The app is now OPEN to anonymous visitors${at(result.slug)}.`
      : "The app is NOT open to anonymous visitors — app.json declares no `public` block, so the schemas are readable only by the roster.",
    ...pageNote(result.memberPages, result.participantPages, result.slug),
    ...warningNote(result.warnings),
    ...recordNote(result.recordIssues, result.recordIssuesCapped),
    provenance(result.commit, result.dirty),
  ].join("\n");
}

async function narrateUnpublish(root: string): Promise<string> {
  const result = await unpublishSharedApp(root);
  if (!result.ok) return result.problems.join("\n");
  return result.wasOpen
    ? `Unpublished apps/${result.aid}: the public block is gone, so anonymous access is closed${noLonger(result.slug)}, and the public config document was deleted. ` +
        "The schemas under collections/ were left in place, so publishing again rewrites them where they stand."
    : `apps/${result.aid} was already closed to the public — nothing was open to take down. The public config document was deleted if it was still there.`;
}

async function narrateInit(root: string, body: Record<string, unknown>): Promise<string> {
  const result = await initSharedApp(root, str(body.name), str(body.slug));
  if (!result.ok) return result.problems.join("\n");
  return [
    `Started an app in this repository: app.json now declares it, with ${result.owner} as owner.`,
    "The `aid` was generated — it is the app's identity and is never chosen or edited by hand.",
    ...(result.slug === undefined
      ? []
      : [
          `The URL name '${result.slug}' is reserved for this app (a taken one gets a number appended). It resolves for the roster now, and for everybody when you publish.`,
        ]),
    "Next: write the collections, then preview, then publish.",
  ].join("\n");
}

/** `fork`'s report has one job the others do not: saying what did NOT come across. The roster and
 *  the URL name were in the file a moment ago and are not now, and a fork that silently kept
 *  either would be the bug this operation exists to prevent. */
async function narrateFork(root: string, body: Record<string, unknown>): Promise<string> {
  const result = await forkSharedApp(root, str(body.name), str(body.slug));
  if (!result.ok) return result.problems.join("\n");
  const carried =
    result.carried.length === 0
      ? "The cloned declaration had no `collections` or `public` block to carry over."
      : `Carried over unchanged: ${result.carried.join(", ")}.`;
  return [
    `This repository now declares YOUR app: a new aid, with ${result.owner} as owner and nobody else on the roster.`,
    carried,
    "The collection schemas under `.claude/skills/` were not touched — they are what was cloned, and they are the point.",
    ...urlName(result.slug, result.previousSlug),
    "Nothing is published: the app this was cloned from is untouched, and its records stay where they are. Next: preview, then publish.",
  ].join("\n");
}

/** What to say about the URL name a fork has, or the one it deliberately does not have. */
function urlName(slug: string | undefined, previous: string | undefined): string[] {
  if (slug !== undefined)
    return [`The URL name '${slug}' is reserved for this app (a taken one gets a number appended). It resolves for everybody when you publish.`];
  if (previous === undefined) return [];
  return [
    `No URL name: '${previous}' belongs to the app this was cloned from and was deliberately not carried — kept, it would have come back as '${previous}-2'. Ask the user what to call theirs and put it in \`slug\`.`,
  ];
}

/** Run the pages and say what happened.
 *
 *  `confirm` decides whether it may WRITE. Without it the run presses everything and reports
 *  everything, and every submission is left unwritten — which is the whole of the old behaviour and
 *  the right default for something run after every edit. With it, a click-caused submission becomes
 *  a real record in the live app, read for what the deployed rules said, and removed again.
 *
 *  The gate is the boundary, not the undo: a creation can be acted on before it is removed, and the
 *  removal can fail. Same word as `publish` for the same reason — the caller is accepting a real
 *  consequence on somebody else's behalf. */
async function narratePreview(root: string, confirm: boolean): Promise<string> {
  return narrateHeadlessRun(await headlessPreview(root, { write: confirm }));
}

/** What the LIVE records look like under the schemas this repository holds, in `check`'s voice.
 *
 *  The scan is publish's, word for word (`scanRecords`), so the two boundaries cannot describe the
 *  same broken row differently. What differs is the sentence around it: publish STOPS there and
 *  `confirm` is how you get past it, while `check` writes nothing either way.
 *
 *  A scan that did not run is said out loud rather than left as silence. `check` answers offline,
 *  an agent reads a report with no record line as "the records are fine", and that is the belief
 *  that carries a few hundred bad rows to a publish — and the two reasons it did not run send the
 *  author to different repairs, so each names its own. */
export function checkRecordNote(records: RecordScanResult): string[] {
  if (!records.scanned)
    return records.why === "no-session"
      ? [
          "The live records were NOT scanned — `check` can only read them with a session open. Publish checks them too, " +
            "against these same schemas, and refuses the rows that do not fit.",
        ]
      : [
          "The live records were NOT scanned — nothing knows which app or which collections to read until `app.json` parses. " +
            "Fix the declaration above and run check again.",
        ];
  const { scan } = records;
  const notes: string[] = [];
  // BOTH, when both happened. `scanRecords` skips a collection it cannot read and goes on to the
  // next, so an unreadable one does not mean the rest went unexamined — and dropping their findings
  // here would hide rows publish is about to name. (Publish's own `recordRefusal` returns early on
  // `unreadable` for a different reason: there it decides ONE thing, whether `confirm` may be spent,
  // and it may not be. `check` decides nothing and is only reporting.)
  if (scan.unreadable.length > 0)
    notes.push(
      ...scan.unreadable,
      "Those collections' records could not be read, so nothing checked whether these schemas still fit them. Publish stops there too, and `confirm` does not override it.",
    );
  if (scan.records > 0)
    notes.push(
      ...scan.lines,
      // What `confirm` buys depends on the OTHER half of the scan. `recordRefusal` returns on
      // `unreadable` before it ever weighs `confirm`, so offering it while a collection cannot be
      // read promises a publish that refuses anyway — and points at the wrong repair, which is the
      // whole reason these two are kept apart.
      scan.unreadable.length > 0
        ? "publish refuses these rows — and it does not get as far as weighing `confirm` while a collection above cannot be read, so that is the first repair."
        : "publish refuses these rows, and only `confirm` gets past it — which accepts the breakage for everyone.",
    );
  return notes;
}

/** The headline when the records alone would stop a publish, or null when they would not. A
 *  declaration can be perfect and a publish still refuse, which is why this is not decided by
 *  `problems` on its own.
 *
 *  Two states, kept apart because they send the author to opposite repairs. Rows that do not fit
 *  are a MIGRATION — they are known, they are named, and `confirm` is the decision to break them.
 *  A collection that could not be read is ACCESS, and nothing at all is known about the rows behind
 *  it; calling those "not publishable" reads as invalid data and starts a migration of records
 *  nobody has seen. */
export function recordsHeadline(records: RecordScanResult, found: string): string | null {
  if (!records.scanned) return null;
  const { scan } = records;
  if (scan.records > 0) return `The declaration is publishable, but the records already in the app are not (${found}):`;
  if (scan.unreadable.length > 0) return `The declaration is publishable; whether the records fit it is UNKNOWN, and publish stops there (${found}):`;
  return null;
}

async function narrateCheck(root: string): Promise<string> {
  const report = await checkSharedApp(root);
  if (!report.ok) return report.problems.join("\n");
  const found = report.collections.length === 0 ? "no shared collections in this repository yet" : `shared collections: ${report.collections.join(", ")}`;
  const records = checkRecordNote(report.records);
  // WHOSE publish was checked, always said out loud: signed in it is you, signed out it is the
  // owner the declaration names, and "it would publish for somebody else" is not the same answer.
  const as =
    report.checkedAs === null
      ? `Checked as the declared owner (${report.declaredOwner ?? "none named"}) — not signed in, so it could not be checked against your address.`
      : `Checked as ${report.checkedAs}.`;
  if (report.problems.length === 0) {
    const headline = recordsHeadline(report.records, found) ?? `The declaration is publishable. ${found}.`;
    return [headline, ...records, ...warningNote(report.warnings), as, "Nothing was written — this only reads."].join("\n");
  }
  return [
    `The declaration would be refused (${found}):`,
    ...report.problems.map((problem) => `  - ${problem}`),
    ...records,
    ...warningNote(report.warnings),
    as,
    "Nothing was written.",
  ].join("\n");
}

async function narrateInvite(root: string, body: Record<string, unknown>): Promise<string> {
  const email = str(body.email);
  if (email === undefined) return "manageSharedApp invite: `email` is required — it is what the roster is keyed by.";
  const role = parseRole(body.role);
  if (role === undefined) return `manageSharedApp invite: role must be one of ${APP_ROLE_NAMES.join(", ")}, or omitted to remove the address.`;
  const cid = str(body.cid) ?? "*";
  const result = await inviteToSharedApp(root, email, role, cid);
  if (!result.ok) return result.problems.join("\n");
  const where = cid === "*" ? "the whole app" : `'${cid}'`;
  const what = role === null ? `Removed ${email} from ${where}.` : `${email} is now ${role} of ${where}.`;
  return [what, "It takes effect at the next publish — nothing has changed in the app yet."].join("\n");
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** `undefined` means the argument was not one of the roles — which is different from being ABSENT,
 *  and absent is how a removal is spelled. */
function parseRole(value: unknown): AppRoleName | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return APP_ROLE_NAMES.find((role) => role === value);
}

/** Run one action against `root` and narrate the result. The agent's whole contract with this
 *  tool is actionable prose, so a refusal is text and never a throw. */
export async function manageSharedApp(root: string, args: unknown): Promise<string> {
  const body = isRecord(args) ? args : {};
  const action = parseAction(body.action);
  if (action === null) return `manageSharedApp: action must be one of ${SHARED_APP_ACTIONS.join(", ")}.`;
  const confirm = body.confirm === true;
  // ONE operation at a time per repository. Each of these is a read-then-write sequence over the
  // same documents, and interleaved they undo each other: a publish that read the app document
  // before an `init` (or another publish) renamed the URL would go on to open the OLD name, which
  // the other run had just retired — leaving a resolving name that no later unpublish touches,
  // because unpublish works from the record the rename moved.
  //
  // At the entry point rather than inside each operation, because what must not interleave is the
  // whole sequence, and this is the only place they all pass through.
  const key = `operation:${await manifestKey(root)}`;
  if (action === "init") return serializeBy(key, () => narrateInit(root, body));
  if (action === "fork") return serializeBy(key, () => narrateFork(root, body));
  if (action === "check") return serializeBy(key, () => narrateCheck(root));
  if (action === "preview") return serializeBy(key, () => narratePreview(root, confirm));
  if (action === "invite") return serializeBy(key, () => narrateInvite(root, body));
  if (action === "publish") return serializeBy(key, () => narratePublish(root, confirm));
  return serializeBy(key, () => narrateUnpublish(root));
}
