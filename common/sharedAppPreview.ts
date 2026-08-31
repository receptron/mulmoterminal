// What the preview route sends, decided by BOTH sides.
//
// Here rather than in `server/` with a copy in `src/` because that is what this repository's rule
// says about a wire shape the two ends agree on: a rename or a new field on one side would drift
// silently until the pane drew nothing, and "nothing drawn" is the failure mode this whole feature
// exists to remove. The server's own result type extends this with what only it uses.
//
// Design: `plans/feat-shared-app-preview.md`.
import type { IntentKind, Viewer } from "@receptron/sharedapp/view";
import type { PublicFace } from "./sharedAppPublicFace.js";

/** Who a page was written for. Three audiences, three DOCUMENTS with three sets of rules — never
 *  one page shown three ways. Reading them as interchangeable is how a page written for the front
 *  desk gets published to the world. */
export type PreviewAudience = "public" | "member" | "roster";

/** One page the author can look at. */
export interface PreviewPage {
  id: string;
  html: string;
  audience: PreviewAudience;
  /** WHO the author is to this page, and what they may change — the same
   *  `{ me, can }` mulmoserver posts to the live `/m/` and `/p/`, computed from
   *  the same projection by the same function.
   *
   *  ON THE PUBLIC PAGE TOO, and that is a correction rather than an addition.
   *  It was left off because "a public page has no reader and no roles" — but
   *  the rules disagree: `ownRow` asks for `authed()` and nothing else, and
   *  `selfTransitions` / `selfDelete` are declared inside `public.submit[cid]`.
   *  So the visitor who booked a slot may cancel it, and a page with no
   *  `viewer` draws no button for that. It is the participant's own answer,
   *  computed at the same tier (`PUBLIC_WRITE_TIER`).
   *
   *  It comes from the SERVER because the client has neither the projection nor
   *  the author's verified address. Sending the projection instead and letting
   *  the pane resolve it would be the second implementation this whole change
   *  exists to remove. */
  viewer?: Viewer;
  /** The collections this page WATCHES, off the same projection the published site reads.
   *
   *  A page that declares `live` is written for `onState` to arrive more than once — production
   *  subscribes to those collections and re-delivers on every change. This pane read the records
   *  once, so a page previewed here sat still while the live one moved: somebody else's message
   *  never appeared, which reads as a broken page rather than as a preview that does not watch.
   *  The pane re-reads while the page on screen names any, and this is how it knows to. */
  live?: string[];
}

export type PreviewDataset = Record<string, unknown>[];

/** One collection's rows, for one page, as they stand now — what the record stream sends when a
 *  watched collection changes.
 *
 *  THE ROWS RATHER THAN A DIFF. The pane holds a map keyed by page and collection; replacing one
 *  entry cannot be applied out of order, and a diff against a map the sender cannot see could be. */
export interface PreviewRecordChange {
  /** `previewPageKey(audience, id)` — the same key the page's datasets are filed under. */
  key: string;
  cid: string;
  rows: PreviewDataset;
}

/** The records ONE page is handed, per collection.
 *
 *  Per page rather than one map for the app, and that is the point rather than tidiness: a member
 *  page may name a collection `public.read` does not open, so a single map is either missing those
 *  records on the member page or handing them to the public one. The second is worse — it would
 *  show the author a public page drawing private data, which is the preview being LOOSER than
 *  production, the one thing it must never be. */
export type PreviewDatasets = Record<string, Record<string, PreviewDataset>>;

/** The key a page's datasets sit under. Audience-qualified because a view id is unique within its
 *  tier and not across them. */
export const previewPageKey = (audience: PreviewAudience, id: string): string => `${audience}:${id}`;

/** One input of a GENERATED public form — an app that declares `public.submit` and publishes no
 *  page of its own.
 *
 *  Already reduced to what a visitor may fill in: `createFields` minus the address (compared to
 *  their token) and minus the status (pinned to `initialStatus`), in the order the declaration
 *  lists them. The reduction happens on the SERVER, through the same `writableFields` the published
 *  site's submit path uses, so the pane draws boxes rather than deciding which boxes exist. */
export interface PreviewFormField {
  name: string;
  label: string;
  required: boolean;
  /** The schema's type, so a `enum` draws a select and a `text` draws a textarea. A pane that drew
   *  every field as a text box would let the author submit values the real form could not produce. */
  type: string;
  /** An `enum`'s choices, which travel with it for the same reason they travel to the public page:
   *  a visitor cannot read the schema. */
  values?: string[];
}

/** The generated form, per collection. Empty for an app that publishes a page of its own. */
export type PreviewForm = Record<string, PreviewFormField[]>;

export interface SharedAppPreview {
  aid: string;
  /** What a public create may carry, per collection, exactly as the published config declares it.
   *
   *  Carried to the browser because the PARENT judges a submission against it — an unknown cid, a
   *  value that is not a string, a field outside `createFields` — and those three judgements are
   *  most of what a preview is for. Handing the parent an empty map instead does not disable the
   *  check; it makes the check REFUSE EVERYTHING, and it refuses with `unknown-collection`, which
   *  reads as "your declaration is wrong" about a declaration that is fine. That shipped once
   *  (2026-08-14) and cost an author a debugging session pointed at the wrong repository. */
  submit: Record<string, { createFields: string[] }>;
  /** The collection whose records the platform draws as ARTICLES, when this app publishes any.
   *
   *  Carried for the same reason `submit` is: the PARENT judges an `open` against it, and the pane
   *  hands it to `viewParent` as `articleCid`. Absent on every app that publishes no articles,
   *  where a page asking to open one is refused because there is no such page to reach.
   *
   *  It is what a page's index links THROUGH — a sandboxed frame cannot navigate for itself — so an
   *  app whose front page is a list of headlines has all of them dead without it. */
  articleCid?: string;
  /** Every page this publish would put live, public first. */
  pages: PreviewPage[];
  /** How open this publish would leave the app — see {@link PublicFace}. Anything but `open` is
   *  normal: an app whose `public.enabled` is not true is one only its roster ever sees, and it may
   *  still carry a `public` block for its members' pages to submit through. */
  publicFace: PublicFace;
  /** Whether there was a live `apps/{aid}` to project from. Said out loud because the projection
   *  DEPENDS on it — keys publish does not own are carried forward from the live document, so a
   *  preview computed without one is the projection of a FIRST publish, not of the next one. */
  fromLiveApp: boolean;
  /** The app publishes a GENERATED form rather than a page of its own.
   *
   *  Carried as a fact rather than left to be inferred from an empty `pages`: those two states put
   *  the same empty frame on screen and mean opposite things — "there is nothing to draw" against
   *  "there is something to draw and this pane cannot draw it yet". */
  generatedForm: boolean;
  /** The inputs of that generated form. Carried rather than left to the pane to derive: the pane
   *  cannot read the schema either, and a form it built from field NAMES alone would ask for
   *  different things than the published site does — a preview of nothing real. */
  formInputs: PreviewForm;
  datasets: PreviewDatasets;
  /** WHAT THE AUTHOR HAS ALREADY SUBMITTED to this app, projected to the fields a page could have
   *  SENT — the `viewer.mine` every published page is handed.
   *
   *  Per APP rather than per page, because that is what the question is about: it asks after the
   *  READER, and the reader is the same person whichever page they are looking at.
   *
   *  ABSENCE IS THE ANSWER TO A DIFFERENT QUESTION, at two levels, and both matter. A cid missing
   *  from the map is "nothing could be read" — the app has never been published, the read was
   *  refused — which a page must draw as UNKNOWN. A cid present with an empty array is "you have
   *  not submitted anything here". Getting that backwards tells somebody they have already answered
   *  when they have not, and takes a one-time action away from them.
   *
   *  It exists because the pane had NO ANSWER AT ALL: the public parent here was wired without the
   *  port, so `view.mine()` was `known: false` for ever and a page asking "have I registered?" drew
   *  its registration form on top of a registration. The author then debugged the page. */
  own: Record<string, PreviewDataset>;
  /** Collections a page names but whose records could not be read. Reported rather than silently
   *  empty: "no bookings yet" and "the read was refused" put identical pixels on the screen. */
  unreadable: string[];
  /** Pages that will go out but are worth looking at first — see `viewWarnings`. */
  warnings: string[];
}

/** The route's answer. Three shapes, and only one of them is a failure:
 *
 *  - not declared — most directories are not shared apps, and the pane asks about whichever one a
 *    cell is open in. An error would make normal operation look like a fault.
 *  - declared and refused — the author's work in progress, and the reason the pane exists. These
 *    lines are the answer to the question asked; a status code could not carry them.
 *  - declared and computed. */
/** What the author accepted in the confirmation, on its way to the server. */
export interface PreviewSubmission {
  cid: string;
  /** Strings only. The rules compare stored values without coercing, so a number here would write a
   *  record that differs BY TYPE from the identical-looking one the published page writes. */
  values: Record<string, string>;
}

/** One record a preview wrote, and the mirror that travelled with it.
 *
 *  Both ends hold this: the server returns it, the pane remembers it, and the pane hands it back to
 *  have it removed. It is the ONLY place a preview's writes are known — the rules read a public
 *  create with `hasOnly(createFields)`, so nothing can mark the document itself. */
export interface PreviewWrittenRecord {
  cid: string;
  id: string;
  mirror?: { cid: string; id: string } | undefined;
  /** The ONLY thing undo accepts, and the reason it is here rather than the record above.
   *
   *  Undo runs through the author's own Firestore handle, so a route that took a cid and an id
   *  would take ANY cid and id in the app: a caller reaching this server could delete a stranger's
   *  real booking and put the slot it was holding back to `open`, and every write would be
   *  perfectly authorized. The cid and the id are still carried, because the author has to be able
   *  to read what this preview wrote — but they are for the SCREEN. What the server acts on is a
   *  token it minted itself when it made the write, held in memory and mapped to that exact record.
   *
   *  In memory, for the lifetime of the process, which is the same lifetime as the list on screen:
   *  neither survives a restart, and a preview's writes become ordinary records when it ends. */
  token: string;
}

/** WHAT THE PANE ANSWERS A `view.mine(cid, key)` WITH.
 *
 *  `ok: false` is "nobody looked" — no session, an id strategy with nothing to build from, a read
 *  that was refused — and the parent turns it into `known: false`. It is NOT "you have not
 *  answered", which is `{ ok: true, found: false }`: a page told the second stops offering an
 *  action to somebody entitled to it, and a page told the first keeps offering it and lets the
 *  refusal explain itself. */
export type PreviewLookupResult = { ok: false } | { ok: true; found: boolean; record?: Record<string, unknown> };

/** A write whose outcome is unknown: the request threw after the server may already have written.
 *
 *  Kept because the alternative is worse. Dropping it leaves a real record in the app that nothing
 *  on this screen can name, so the author cannot remove what they cannot see. */
export interface PreviewUncertainWrite {
  cid: string;
  uncertain: true;
}

export type SharedAppPreviewResponse =
  { declared: false } | { declared: true; ok: false; problems: string[] } | { declared: true; ok: true; preview: SharedAppPreview };

/** One ask for a WRITE the page requested, on its way from the pane's parent to the server that
 *  performs it — a member's move, or a visitor's own on the public page.
 *
 *  The PAGE travels with it, and that is the load-bearing field rather than context. Which tier's
 *  projection judges the ask and which records it may name are both decided by the page it was
 *  asked from — so a participant's page cannot reach the front desk's transitions by naming the
 *  collection they live in. Sending the cid alone would have made the audience irrelevant, which is
 *  the one thing the tiers exist to prevent.
 *
 *  What is NOT here is the judgement. The pane narrows a message to this shape and nothing more:
 *  what the projection allows, who the author is to it, and whether the move is in the table are
 *  the server's, which is the only side holding the projection and a verified address. */
export interface PreviewIntent {
  page: { id: string; audience: PreviewAudience };
  kind: IntentKind;
  cid: string;
  itemId: string;
  /** Where it is going. Absent on a withdrawal, which moves nothing — the row is removed, and on a
   *  correction, which names its own fields instead. */
  to?: string;
  /** `correct` only: the fields to rewrite and their values. Strings, as the page sent them — the
   *  rules compare stored values without coercing, and `maxBytes` has nothing to measure on a
   *  number. */
  values?: Record<string, string>;
}

/** What became of it.
 *
 *  `mailed` is claimed only on success and only where the declaration named a notice for that move:
 *  the pane says so in its log, because a preview that queues a real notice to a real member is the
 *  one effect of this path that cannot be taken back, and it must never happen silently. */
export type PreviewIntentResult = { ok: true; mailed: boolean } | { ok: false; error: string };
