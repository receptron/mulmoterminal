// publish — write the app, and open it LAST.
//
// The one dangerous operation in a shared app (design D10). Merging a pull request changes
// nobody's screen; publishing changes everyone's, immediately, and in two ways at once: a breaking
// schema change leaves live records inconsistent with the schema that is now supposed to describe
// them, and — because a view is HTML — the right to publish is in practice the right to run
// JavaScript in every member's browser.
//
// Two properties are load-bearing and neither is obvious from the call site:
//
//   - it writes EVERYTHING the app is, from the working tree, in one operation: the roster, the
//     schemas, the pages and the rule configuration. It used to promote `staging/{cid}` — what a
//     previous `deploy` had put where only the roster could see it — and that half is gone
//     (`plans/feat-shared-app-no-staging.md`). What stands in its place is `preview`, which runs
//     the pages here, on the author's machine, before any of this is written;
//   - it writes `apps/{aid}.public` LAST, as its own write, because that block — not the
//     world-readable `config/public` projection — is what the rules read to authorize anonymous
//     access. A FIRST publish that stops part-way therefore leaves the app private: nothing before
//     the last write puts a `public` block there, so a half-finished new app is closed, not open.
//
// A RE-publish is the other case, and it does NOT pass through a moment with no `public` block —
// `stillOpen()` below carries the LIVE block onto every document written before the last one. So
// while a LIVE app is being re-published, the OLD `public` block stays in force across the writes,
// and a run that fails part-way leaves the app open on a mixed set of versions. That is accepted, and
// it is not an access change — the old block is what authorizes those reads, so a collection that
// only the NEW declaration would have opened stays closed (`publicRead` tests the cid against the
// `public.read` list that is still live). Closing first would trade a mixed-version window for a
// deliberate outage on every re-publish, and a failure there leaves the app DARK rather than
// stale — worse for the person the app is for, and not what the design chose (see D10's ordering).
import { type LoadedCollection } from "@mulmoclaude/core/collection/server";
import { APPS_COLLECTION, PUBLIC_CONFIG_DOC, appConfigPath, appSchemasPath, projectPublish, type AuthoredApp, type PublishStamp } from "@receptron/sharedapp";
import { requireAid } from "./ensureAid.js";
import { halfPublishedApp } from "./recovery.js";
import {
  readCurrentApp,
  schemasOf,
  sharedAppContext,
  stampFor,
  type SharedAppContext,
  type SharedAppFailure,
  type SharedAppHandle,
  type SharedAppOptions,
} from "./context.js";
import { recordRefusal, scanRecords, type RecordScan } from "./records.js";
import { oversizeProblem, publicFormOf, publicInputProblems, type PublicForm } from "./publicForm.js";
import { allTierWrites, pageIdsOf, planTierWrites, type PlannedTier } from "./appViews.js";
import { PUBLIC_VIEW_DOC, declaredView, readAppViewFile, type ViewFile } from "./publicView.js";
import { frozenKeyProblems } from "./exclusivity.js";
import { scopedFieldProblems } from "./scopedFields.js";
import { claimApp, reserveHeldSlug, type SlugRequest } from "./establish.js";
import { setSlugPublished } from "./slug.js";
import { runWrites, type WriteStep } from "./writes.js";

export interface PublishSuccess {
  ok: true;
  aid: string;
  cids: string[];
  /** The URL name that now resolves to this app, when it has one. */
  slug?: string | undefined;
  /** Whether this publish left the app open to anonymous visitors. False is a normal outcome — a
   *  declaration with no `public` block publishes the schemas to the roster's URL and grants the
   *  world nothing — and it is the one thing an operator is most likely to assume wrongly. */
  publicOpen: boolean;
  /** Pages this publish put live for the app's staff, by id. Reported because
   *  what a members' page is handed is NOT public data: the argument that made
   *  the public view safe — a view can only carry off what any stranger could
   *  already fetch — does not hold for the real records. */
  memberPages: string[];
  /** Pages a participant sees of their own row, by id. */
  participantPages: string[];
  commit?: string | undefined;
  dirty: boolean;
  recordIssues: number;
  recordIssuesCapped: boolean;
  /** Said about the published page without stopping it — see `viewWarnings`. */
  warnings: string[];
}

export type PublishResult = PublishSuccess | SharedAppFailure;

/** The writes, in the order the design fixes: the data, then the app document, then open. */
interface PublishStepsInput {
  handle: SharedAppHandle;
  aid: string;
  stamp: PublishStamp;
  face: ReturnType<typeof projectPublish>;
  slug: string | undefined;
  form: PublicForm;
  view: ViewFile | null;
  tiers: readonly PlannedTier[];
  /** Written already by `claimApp`, byte for byte, when this publish created the app document to
   *  make the record scan answerable. Writing it twice is harmless and saying so is not: the
   *  second write is skipped so the step list reads as what actually happened. */
  established: boolean;
}

function publishSteps({ handle, aid, stamp, face, slug, form, view, tiers, established }: PublishStepsInput): WriteStep[] {
  return [
    ...face.schemas.map(({ cid, doc }) => ({
      what: `the schema for '${cid}' (apps/${aid}/collections/${cid})`,
      run: () => handle.docs.set(appSchemasPath(aid), cid, doc),
    })),
    // The world-readable projection — WRITTEN when the declaration opens the app, DELETED when it
    // does not.
    //
    // The delete is the half that matters. `config/{docId}` is `allow read: if true` forever, so a
    // publish that takes `public` out of app.json — which is how an author closes an app without
    // reaching for `unpublish` — would drop the authorization and the URL name while leaving the
    // previous public page and its form directly fetchable by anybody who kept the path.
    //
    // `form` is MulmoTerminal's addition to the projection, and it has to be here rather than
    // anywhere else: this is the ONLY document a visitor may read, and without the labels and the
    // choices the public page cannot draw the form at all (the schema is unreadable to somebody
    // who is neither on the roster nor granted a public read).
    {
      what:
        face.public === undefined
          ? `removing the public config document (apps/${aid}/config/${PUBLIC_CONFIG_DOC})`
          : `the public config document (apps/${aid}/config/${PUBLIC_CONFIG_DOC})`,
      run: async () => {
        if (face.public === undefined) {
          await handle.docs.delete(appConfigPath(aid), PUBLIC_CONFIG_DOC);
          return;
        }
        await handle.docs.set(appConfigPath(aid), PUBLIC_CONFIG_DOC, { ...face.config, form });
      },
    },
    // The page itself, carrying the SAME stamp as the config above. The
    // runtime refuses to draw a pair that disagrees, and these are two writes:
    // a run that stops between them leaves a new declaration beside the
    // previous page, which is a view handed fields it has never seen.
    //
    // The DELETE is not tidiness, and it covers two cases with one condition: a view withdrawn
    // from `views[]`, and an app that stops being public at all — `declaredView` reads the public
    // page out of the declaration, so removing the `public` block takes this document with it.
    {
      what:
        view === null || face.public === undefined
          ? `removing the published view (apps/${aid}/config/${PUBLIC_VIEW_DOC})`
          : `the published view (apps/${aid}/config/${PUBLIC_VIEW_DOC})`,
      run: async () => {
        if (view === null || face.public === undefined) {
          await handle.docs.delete(appConfigPath(aid), PUBLIC_VIEW_DOC);
          return;
        }
        await handle.docs.set(appConfigPath(aid), PUBLIC_VIEW_DOC, { html: view.html, publishedAt: stamp.publishedAt });
      },
    },
    // The members' and participants' pages, written from the working tree and withdrawn when this
    // publish drops them. Before the app document and the authorization, like everything else that
    // is only DATA: a run that stops here leaves an app whose pages are newer than its roster,
    // which is the direction to be wrong in.
    ...allTierWrites(handle, aid, tiers, stamp),
    // The app document WITHOUT `public`: the rule configuration lands beside the schemas it was
    // projected with, so the public write path is never judged by one version's constraints
    // against another's schema. Skipped when `claimApp` wrote exactly this a moment ago.
    ...(established ? [] : [{ what: `the app document (apps/${aid})`, run: () => handle.docs.set(APPS_COLLECTION, aid, face.app) }]),
    // The URL name follows the app's own openness — `face.public` — and NOT the fact that a
    // publish happened.
    //
    // A published reservation is world-readable, and what it reveals is the aid, which addresses
    // everything under `apps/{aid}`. So publishing a declaration
    // with no `public` block — a roster-only app, which is a normal thing to publish — must not
    // make its name resolvable: that would hand out the private entrance while the operation
    // itself reports the app is closed to anonymous visitors.
    //
    // Placed here, before the authorization and after everything the name points at: a slug that
    // resolved first would be a link that 404s inside, and one that resolves late is only a link
    // that is not ready yet. When the publish CLOSES the app instead, the same position is the
    // reverse and equally right — the app document above has already dropped `public`.
    ...(slug === undefined
      ? []
      : [{ what: `the URL name '${slug}' (appSlugs/${slug})`, run: () => setSlugPublished(handle, aid, slug, face.public !== undefined) }]),
    // LAST, and only when the declaration asks for it. This is the authorization itself.
    ...(face.public === undefined
      ? []
      : [
          {
            what: `the public block on apps/${aid} — the authorization itself`,
            run: () => handle.docs.set(APPS_COLLECTION, aid, { ...face.app, public: face.public }),
          },
        ]),
  ];
}

/** Everything that must hold before anything is written: the declaration agrees with the schemas
 *  this repository actually has, and the live records fit the version about to become public.
 *
 *  Split out for the line budget, and it reads as the one thing it is — the gate. It used to have
 *  a first clause the others hung off — "something IS staged, and the staged set matches the
 *  repository" — which is not a question any more: what publishes is what the repository holds. */
async function publishGate(
  authored: AuthoredApp,
  collections: readonly LoadedCollection[],
  root: string,
  confirm: boolean | undefined,
): Promise<{ ok: true; scan: RecordScan } | SharedAppFailure> {
  const schemas = schemasOf(collections);
  const drifted = publicInputProblems(authored, schemas);
  if (drifted.length > 0) return { ok: false, partial: false, problems: drifted };
  // The PAIR publish writes: the rule configuration and the schemas on one side, the manifest's
  // roster on the other. It is where an `assignee` can end up with no field to be compared
  // against — and it is a field NAME against a SCHEMA, which is the half the declaration gate
  // deliberately cannot see.
  const scoped = scopedFieldProblems(authored, schemas);
  if (scoped.length > 0) return { ok: false, partial: false, problems: scoped };
  const scan = await scanRecords(collections, root);
  const refusal = recordRefusal(scan, confirm);
  return refusal ? { ok: false, partial: false, problems: refusal } : { ok: true, scan };
}

/** The two questions that are asked of the PAGE and of the live records before
 *  anything is written — both of them things a run cannot take back once the
 *  schemas have gone out.
 *
 *  Together because they share that timing, not because they are alike: one
 *  reads a file off disk, the other reads what the app already holds. */
async function pageGate(
  root: string,
  authored: AuthoredApp,
  live: Record<string, unknown> | null,
  handle: SharedAppHandle,
  publishedAt: number,
): Promise<{ ok: true; view: ViewFile | null } | { ok: false; problems: string[] }> {
  const declared = declaredView(authored);
  const view = declared === null ? null : await readAppViewFile(root, declared, publishedAt);
  if (view !== null && !view.ok) return view;
  // The other question about the same live records, and the one the migration
  // scan cannot ask: not "do these rows still fit the schema" but "does this
  // change move the id space they were written into". See ./exclusivity.ts —
  // `confirm` deliberately does not reach it.
  //
  // The collection half is the manifest's own, which is what this publish writes. It used to be
  // read back from what a deploy had staged, because that was what publish promoted.
  const frozen = await frozenKeyProblems(authored, authored.collections ?? {}, live, handle);
  if (frozen.length > 0) return { ok: false, problems: frozen };
  return { ok: true, view: view === null ? null : view.view };
}

/** The app document a bookkeeping write may use: this publish's projection, plus the `public` block
 *  that is live RIGHT NOW.
 *
 *  Publish holds its own `public` back for the last write of the run, so a document written before
 *  then carries none — and every one of those writes REPLACES. Carrying the live block through is
 *  what keeps an already-open app open while it is being re-published. */
const stillOpen = (appDoc: Record<string, unknown>, existing: Record<string, unknown> | null): Record<string, unknown> =>
  existing?.public === undefined ? appDoc : { ...appDoc, public: existing.public };

/** What this publish is writing, and the app document it is writing it onto — established when it
 *  was not there.
 *
 *  Split from the run below because it is the only part with an ORDER of its own: read, project,
 *  and then write the app document FIRST when it is missing, so the records under it can be read
 *  by the gate that follows. */
interface Prepared {
  ok: true;
  existingApp: Record<string, unknown> | null;
  stamp: PublishStamp;
  dirty: boolean;
  face: ReturnType<typeof projectPublish>;
  appDoc: Record<string, unknown>;
  held: string | undefined;
  /** Whether the app document was written by this call, rather than found. */
  established: boolean;
}

async function prepare(root: string, aid: string, context: SharedAppContext, opts: SharedAppOptions): Promise<Prepared | SharedAppFailure> {
  const { authored, collections, handle } = context;
  // WHAT THE APP DOCUMENT IS, asked in the only way the rules allow. Reading `apps/{aid}` cannot
  // tell you it is missing: the read rule resolves the roster out of the document itself, so for a
  // document that does not exist the expression fails and the answer is DENIED — the same answer
  // as somebody else's app. `init` writes it, so it is normally there; a repository whose app.json
  // predates that, or one whose init failed part-way, arrives here without it.
  const current = await readCurrentApp(handle, aid, "publish", "Publishing again is safe — this read only decides whether the app is created or updated.");
  if (!current.ok) return current;
  const existingApp = current.app;
  const { stamp, dirty } = await stampFor(handle, root, opts);
  const face = projectPublish(authored, schemasOf(collections), stamp, existingApp);

  // The slug this app already holds, carried on the app document because NOTHING ELSE CAN BE
  // ASKED: `appSlugs/{slug}` is unreadable to a stranger, so "do we already have one?" has no
  // other answer. The projection does not carry it — the reservation is the host's business — so
  // it is re-attached here, from the document as it stands.
  const held = typeof existingApp?.slug === "string" ? existingApp.slug : undefined;
  const appDoc = held === undefined ? face.app : { ...face.app, slug: held };

  // ESTABLISH THE PARENT, THEN SCAN — rather than deciding that a missing app document means there
  // are no records.
  //
  // It does not. Firestore deletes do not cascade, and this design documents the orphan state that
  // leaves: `apps/{aid}` can be gone while `collections/*/items` beneath it survives. Reading the
  // missing parent as an empty store would let a publish that re-creates it make those records
  // readable under a schema nothing ever checked them against.
  //
  // What is written here grants nothing outside the roster — `public` is held back for the last
  // write of the run, always — and it is the same document this publish is about to write anyway.
  const established = existingApp === null;
  if (established) {
    const claimed = await claimApp(handle, aid, appDoc);
    if (claimed) return claimed;
  }
  return { ok: true, existingApp, stamp, dirty, face, appDoc, held, established };
}

/** What the run knows that its refusal does not carry: which app it was writing, and whether any
 *  of its writes landed.
 *
 *  `partial` is NOT that second question. It travels up from the slug reservation as well, where
 *  it means "the app is written and this is only its public name" — and the one refusal that comes
 *  back with every candidate taken has made no write at all. Telling that author their writes are
 *  live, and to publish again, would contradict the line above it, which correctly says to choose
 *  a different name. */
interface RunState {
  aid?: string;
  wrote?: boolean;
}

/** Publish, and — when it stopped with writes already landed — say what is standing and which
 *  repairs are not repairs.
 *
 *  The wrapper exists because `partial` is reported from a dozen places inside the run and every
 *  one of them is answered by the same next move. Without it the refusal names a problem and
 *  nothing else, and the two things an operator then reaches for (delete the app, mint a new aid)
 *  are the two that cannot be taken back. */
export async function publishSharedApp(root: string, opts: SharedAppOptions = {}): Promise<PublishResult> {
  // The aid as the run itself resolved it — carried out rather than re-read, so the advice names
  // the id the writes actually went to even if `app.json` changed underneath in the meantime.
  const ran: RunState = {};
  const result = await runPublish(root, opts, ran);
  if (result.ok || !result.partial || ran.wrote !== true || ran.aid === undefined) return result;
  return { ...result, problems: [...result.problems, ...halfPublishedApp(ran.aid)] };
}

/** THE NAME, BEFORE THE WRITES — and after the app document exists, because `appSlugs`' create
 *  rule resolves the owner through `get(apps/{aid})`.
 *
 *  `init` reserves the declared name, so this is the app that gained a `slug` afterwards, or the
 *  one whose init could not finish the reservation. It has to happen BEFORE the run rather than
 *  after it: recording a new reservation writes the app document, and the app document written
 *  last by a publish is the one carrying the `public` block. Reserving afterwards would write a
 *  copy without it and silently close the app it had just opened.
 *
 *  The reservation write is a REPLACEMENT of the app document, and the `appDoc` handed in
 *  deliberately carries no `public` — publish holds that back for its last write. So the LIVE
 *  block is carried through by the caller (`stillOpen`): without it, renaming an open app closes
 *  it for the length of the run, and a failure anywhere in between leaves it dark rather than open
 *  on a mixed version, which is the opposite of the trade this ordering exists to make. */
async function takeName(request: SlugRequest, established: boolean, ran: RunState): Promise<{ ok: true; slug: string | undefined } | SharedAppFailure> {
  const reserved = await reserveHeldSlug(request);
  if (reserved !== undefined && !reserved.ok) return { ...reserved, partial: reserved.partial || established };
  // A reservation that TOOK a name wrote two documents (the name, and the app document recording
  // it). One that found the name already this app's wrote nothing, and neither did a refusal —
  // which is why this is asked of the success rather than assumed from `partial`.
  if (reserved?.reserved === true) ran.wrote = true;
  return { ok: true, slug: reserved?.slug ?? request.held };
}

async function runPublish(root: string, opts: SharedAppOptions, ran: RunState): Promise<PublishResult> {
  // Before anything reads the declaration: the app has to HAVE an id, and publish refuses rather
  // than minting one (`requireAid`). The id is written where the declaration is — `init`, and the
  // collection tool's first schema — because there the blank means "no app yet". Here it means an
  // app that lost its name, and generating one would publish a second app beside it.
  const ensured = await requireAid(root);
  if (!ensured.ok) return { ok: false, partial: false, problems: ensured.problems };

  const context = await sharedAppContext(root);
  if (!context.ok) return context;
  const { authored, collections, handle } = context;
  const { aid } = authored;
  ran.aid = aid;

  const ready = await prepare(root, aid, context, opts);
  if (!ready.ok) return ready;
  const { existingApp, stamp, dirty, face, appDoc, held, established } = ready;
  // `established` means `claimApp` wrote the app document a moment ago — the first write of this
  // run, and the one every refusal after it is partial BECAUSE of.
  if (established) ran.wrote = true;

  const gate = await publishGate(authored, collections, root, opts.confirm);
  if (!gate.ok) return { ...gate, partial: gate.partial || established };
  const scan = gate.scan;

  const form = publicFormOf(authored, schemasOf(collections));
  // Before the first write: the config document is written in the middle of the run, so a database
  // refusal there would land with the schemas already written.
  const oversize = oversizeProblem({ ...face.config, form });
  if (oversize !== null) return { ok: false, partial: established, problems: [oversize] };

  // Also before the first write, and for the same reason: the page is read from disk and judged
  // here, so a missing file or one written against the host's bridge stops the run rather than
  // landing after the schemas.
  const page = await pageGate(root, authored, existingApp, handle, stamp.publishedAt);
  if (!page.ok) return { ok: false, partial: established, problems: page.problems };

  // The members' and participants' pages, read off disk and paired with what is already there, so
  // a page withdrawn from `views` is removed rather than left readable.
  const pages = await planTierWrites(handle, aid, { root, authored, stamp });
  if (!pages.ok) return { ...pages, partial: established };

  const named = await takeName({ handle, aid, root, wanted: authored.slug, held, appDoc: stillOpen(appDoc, existingApp) }, established, ran);
  if (!named.ok) return named;
  const slug = named.slug;
  const withSlug = slug === undefined ? face.app : { ...face.app, slug };

  const steps = publishSteps({
    handle,
    aid,
    stamp,
    face: { ...face, app: withSlug },
    slug,
    form,
    view: page.view,
    tiers: pages.tiers,
    // Already written, byte for byte: `claimApp` wrote this projection, and a reservation made
    // just now rewrote the same thing with the name on it.
    established,
  });
  const failure = await runWrites(steps, "publish");
  // `runWrites` marks a failure partial exactly when a step before it landed, so its own answer is
  // the reliable one here — a first-step failure wrote nothing, whatever came before it.
  if (failure) {
    if (failure.partial) ran.wrote = true;
    return failure;
  }

  return {
    ok: true,
    aid,
    cids: face.schemas.map((entry) => entry.cid),
    publicOpen: face.public !== undefined,
    // Which pages this publish put live, per tier. Said out loud because the data behind a
    // members' page is NOT public data — the argument that made the public view safe (a view can
    // only carry off what any stranger could fetch) does not hold here.
    memberPages: pageIdsOf(pages.tiers, "member"),
    participantPages: pageIdsOf(pages.tiers, "roster"),
    slug,
    commit: stamp.commit,
    dirty,
    recordIssues: scan.records,
    recordIssuesCapped: scan.capped,
    warnings: [...pages.warnings, ...(page.view?.warnings ?? [])],
  };
}
