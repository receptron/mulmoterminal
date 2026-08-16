// What the preview route sends, decided by BOTH sides.
//
// Here rather than in `server/` with a copy in `src/` because that is what this repository's rule
// says about a wire shape the two ends agree on: a rename or a new field on one side would drift
// silently until the pane drew nothing, and "nothing drawn" is the failure mode this whole feature
// exists to remove. The server's own result type extends this with what only it uses.
//
// Design: `plans/feat-shared-app-preview.md`.
import type { Viewer } from "@receptron/sharedapp/view";

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
   *  Absent on a public page, which has no reader and no roles: `public.submit`
   *  is judged from the declaration alone, and a `viewer` there would be an
   *  answer to a question that page never asks.
   *
   *  It comes from the SERVER because the client has neither the projection nor
   *  the author's verified address. Sending the projection instead and letting
   *  the pane resolve it would be the second implementation this whole change
   *  exists to remove. */
  viewer?: Viewer;
}

export type PreviewDataset = Record<string, unknown>[];

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
  /** Every page this publish would put live, public first. */
  pages: PreviewPage[];
  /** Whether this publish would leave the app open to anonymous visitors. False is normal: an app
   *  with no `public` block is one only its roster ever sees. */
  publicOpen: boolean;
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
