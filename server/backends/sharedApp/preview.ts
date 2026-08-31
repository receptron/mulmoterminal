// preview — everything publish would write, computed and NOT written.
//
// The author's page is written by an LLM and, until this existed, was never run before it went
// out. This is the place it runs: the author's own machine, before the first byte reaches
// Firestore.
//
// Three properties are load-bearing, and each of them is a way this could have been easier and
// wrong (design: `plans/feat-shared-app-preview.md`):
//
//   IT PROJECTS THROUGH `projectPublish`, not from the working tree directly. What a visitor's
//   page reads is the PROJECTION — never the files in the repository — so a preview that handed
//   the iframe the declaration would draw collections `public.read` does not open, fields publish
//   would drop, and a config shaped unlike the published one.
//
//   IT WRITES NOTHING. It calls exactly what publish calls and keeps the answer. There used to be
//   a step between: `projectDeploy(...).staging` was taken as a value and passed to
//   `projectPublish` in place of a read, so the two-stage write survived untouched. There is one
//   stage now (`plans/feat-shared-app-no-staging.md`) and the trick is simply the call. (That
//   sentence is HISTORY, kept because it explains the shape — as of 2026-08-17 there is no
//   `deploy` operation and no `staging` tree; do not go looking for either.)
//
//   IT REQUIRES NO SLUG. `appSlugs/{slug}` is one of the three writes that cannot be taken back,
//   and it is the scarce one — the name comes out of a namespace everybody shares, and nothing can
//   ask whether one is free without consuming it. A preview that reserved a name would burn one per
//   abandoned app. So the name is publish's business; this runs before it (principle 9).
//
// What this does NOT prove is in the plan and belongs in whatever reports it: the rules do not run
// here, other people's devices do not exist here, nothing is concurrent here, and — the one that
// hides best — whether the rules a new declaration needs are deployed at all.
// `ProjectedViewWrite` is the ROOT entry's — `/view` re-exports the readers but not the shape
// they return. A type-only import, so nothing of the compiler reaches the runtime here.
import { appSchemasPath, projectPublish, type ProjectedViewWrite, type PublishedConfigDoc } from "@receptron/sharedapp";
import { readCurrentApp, schemasOf, sharedAppContext, stampFor, type SharedAppFailure, type SharedAppHandle, type SharedAppOptions } from "./context.js";
import { planAppViewTiers, type TierPlan } from "./appViews.js";
import { publicFormOf, type PublicForm } from "./publicForm.js";
import { declaredView, readAppViewFile } from "./publicView.js";
import { isRecord } from "../../../common/isRecord.js";
import { publicFaceOf } from "../../../common/sharedAppPublicFace.js";
// Both from `/view`, which is where the PARENT's vocabulary lives — and where the read-back has to
// be: the root entry reaches the compiler, and the compiler imports core's server half at runtime.
import { ownRowsFor, projectedWritesOf, PUBLIC_WRITE_TIER, viewerFor, writableFields, type Viewer } from "@receptron/sharedapp/view";
import {
  previewPageKey,
  type PreviewDataset,
  type PreviewDatasets,
  type PreviewForm,
  type PreviewAudience,
  type PreviewPage,
  type SharedAppPreview,
} from "../../../common/sharedAppPreview.js";

/** The wire shape is in `common/` — both ends decide it. What is added here is the projection the
 *  headless runner (P5) and the publish gates read and the browser has no use for. */
export interface PreviewSuccess extends SharedAppPreview {
  ok: true;
  /** `config/public` as this publish would write it — the document the anonymous page reads. */
  config: PublishedConfigDoc;
  /** The generated form's inputs, for an app that publishes a form rather than a page of its own. */
  form: PublicForm;
  /** What each tier's projection says is WRITABLE, kept for the intent path (`previewIntent.ts`).
   *
   *  Server-only, like the two above, and deliberately so: the pane is handed the resolved
   *  `viewer` and never the projection it came from. Sending this to the browser would put a second
   *  judge there — one that could disagree with the one that performs the write — which is the
   *  divergence `PreviewPage.viewer` was introduced to remove. */
  writes: Partial<Record<PreviewAudience, ProjectedViewWrite[]>>;
  /** What a LISTENER has to hold to keep this preview current: one entry per page that declared
   *  `live`, carrying the request THAT page makes of that collection.
   *
   *  Server-only, and the request rather than the cid alone: the same collection is read `all` for
   *  the desk and `own` for the participant, so one change has to become rows per page. See
   *  `previewWatch.ts`, its only caller. */
  watches: PreviewWatch[];
}

/** One collection, watched for one page. */
export interface PreviewWatch {
  /** `previewPageKey(audience, id)` — the key its rows are filed under. */
  key: string;
  want: RequestedCollection;
}

export type PreviewResult = PreviewSuccess | SharedAppFailure;

/** One collection as a page asks for it: every row, or only the reader's own.
 *
 *  The narrow shape of `ProjectedViewCollection`, restated rather than imported, because only these
 *  three fields decide what to read and the rest of that type is about how a tier is projected. */
export interface RequestedCollection {
  cid: string;
  scope: "all" | "own";
  emailField?: string | undefined;
  uidField?: string | undefined;
  ownDocId?: "auth.uid" | undefined;
  /** The id is `uid + "_" + <this field>` (`idFrom: "auth.uid+field"`).
   *
   *  The FOURTH way a row says whose it is, and the one that was missing. It is not in
   *  `ProjectedViewCollection` — a tier's read scope never needs it, because a tier lists — and it
   *  is needed here: for that strategy the identity is in the document NAME, so a collection
   *  declaring neither `uidField` nor `emailField` (`auth: "anonymous"` + `auth.uid+field`, which is
   *  live-poll's whole shape) matched nothing at all. The author's own votes were absent from
   *  `viewer.mine`, and an intent about one came back `not-in-view` about a row the page had
   *  legitimately been handed. */
  ownIdField?: string | undefined;
  /** Read only the LATEST `rows` records, ordered by `field` — the cap the page's own projection
   *  declared (`views[].limit`).
   *
   *  HERE FOR PARITY, not for cost. Production issues this as `orderBy(field, "desc") + limit(rows)`
   *  and is handed that many rows; the pane reads the collection whole either way, on the author's
   *  own machine. What it must not do is show MORE than the published page will — the one direction
   *  this whole file is not allowed to be wrong in — so the same window is taken after the read. */
  limit?: { rows: number; field: string } | undefined;
}

/** One collection's records, read with the author's own credentials.
 *
 *  A refusal is carried back rather than thrown. The most common one is the ordinary state of an
 *  app that has never been published — `apps/{aid}` does not exist, so the rules cannot resolve an
 *  owner for anything beneath it — and refusing to preview at all because there are no records yet
 *  would make the feature useless exactly when it is most wanted.
 *
 *  `scope: "own"` IS APPLIED, and this is the part that matters. Reading as the owner would return
 *  every row for a page whose reader is only ever shown their own — which makes the preview show
 *  MORE than production, the one direction it must never fail in. The author is a real reader, so
 *  the honest answer is their own rows, found the same way the page will find them. */
async function readCollection(handle: SharedAppHandle, aid: string, want: RequestedCollection): Promise<PreviewDataset> {
  const docs = await handle.docs.list(`${appSchemasPath(aid)}/${want.cid}/items`);
  // The id is put ON the record. The rules use the document id as the record's identity
  // (a booking's id IS its slot), and a page that renders a list needs it as a field.
  const rows: PreviewDataset = docs.map((doc) => ({ ...(isRecord(doc.data) ? doc.data : {}), id: doc.id }));
  if (want.scope === "all") return capped(want, rows);
  return capped(
    want,
    rows.filter((row) => ownsRow(want, row, handle)),
  );
}

/** IS THIS ROW THE READER'S OWN? — the question `ownRow` asks in the rules, asked here in the only
 *  terms this host has.
 *
 *  The uid before the address, matching the reader (`ownLookup` in mulmoserver): a projection
 *  carries exactly one selector, and asking in a fixed order keeps the answer from depending on
 *  which branch happens to be written first.
 *
 *  Its own function because two callers need it and they must not drift: the dataset read above,
 *  and the intent path, which has to decide about a row that no list ever returned — a composite id
 *  (`auth.uid+field`) is granted by NAME and cannot be listed at all, so the page finds it through
 *  `view.mine(cid, key)` and nothing else here has seen it. */
export function ownsRow(want: RequestedCollection, row: Record<string, unknown>, who: { uid: string; email: string }): boolean {
  if (want.ownDocId === "auth.uid") return row.id === who.uid;
  // REBUILT FROM THE STORED VALUE, never a prefix match on the id. That is the rules' own shape
  // (`ownRow`'s `auth.uid+field` branch) and its comment says why: an unconditional prefix match
  // would let somebody create `<victim uid>_x` in a collection with a different strategy and grow
  // self-edit rights over it.
  if (want.ownIdField !== undefined) return typeof row[want.ownIdField] === "string" && row.id === `${who.uid}_${String(row[want.ownIdField])}`;
  if (want.uidField !== undefined) return row[want.uidField] === who.uid;
  const field = want.emailField;
  if (field === undefined) return false;
  return row[field] === who.email;
}

/** One record's place in the order a cap is taken along, or null when it has none.
 *
 *  A `stampField` is written by the RULES (`request.time`), and what the host hands back for it is
 *  either the ISO text or the seconds/nanos pair, depending on which reader converted it. Both are
 *  ordered here, and anything else is treated as absent.
 *
 *  ABSENT IS EXCLUDED, not sorted last, and that is Firestore's behaviour rather than a choice: a
 *  document missing the ordered field is not returned by an ordered query at all. A preview that
 *  kept those rows would show records the published page never receives.
 *
 *  A TUPLE, not a number, and the seconds and the nanos stay APART. `seconds + nanos / 1e9` looks
 *  equivalent and is not: at epoch scale a double cannot resolve anything finer than about 240ns,
 *  so two instants inside the same second collapse to one value — and where the cap boundary falls
 *  between them, the preview would keep whichever the input order happened to put first while the
 *  published query keeps the later one. The leading rank is Firestore's own type order (number
 *  before timestamp before string), so a collection whose stamp changed shape mid-life is at least
 *  ordered the way the query would order it. */
type OrderKey = [number, number, number, string];

interface Ordered {
  row: Record<string, unknown>;
  id: string;
  key: OrderKey;
}

function orderKey(value: unknown): OrderKey | null {
  if (typeof value === "number") return [0, value, 0, ""];
  if (typeof value === "string") return [2, 0, 0, value];
  if (!isRecord(value) || typeof value.seconds !== "number") return null;
  return [1, value.seconds, typeof value.nanoseconds === "number" ? value.nanoseconds : 0, ""];
}

/** Later first — and, where two records carry the SAME stamp, the higher document id first.
 *
 *  The tie-break is not arbitrary: an ordered Firestore query carries an implicit `__name__` in the
 *  same direction, so a descending read breaks equal stamps by name descending. Returning 0 here
 *  would leave the pair in the input order instead, which is name ASCENDING — and at the cap
 *  boundary that is the opposite row from the one the published page is handed. */
function laterFirst(left: Ordered, right: Ordered): number {
  const pairs: [number | string, number | string][] = [
    [left.key[0], right.key[0]],
    [left.key[1], right.key[1]],
    [left.key[2], right.key[2]],
    [left.key[3], right.key[3]],
    [left.id, right.id],
  ];
  for (const [mine, theirs] of pairs) {
    if (mine === theirs) continue;
    return mine < theirs ? 1 : -1;
  }
  return 0;
}

/** The LATEST `rows` records, as the published page would be handed them.
 *
 *  Shared by the one-shot read and the LISTENER (`previewWatch.ts`) for the same reason `ownsRow`
 *  is: two copies of "which rows does this page see" are two chances for the pane and the page to
 *  disagree, and the disagreement is invisible until somebody counts.
 *
 *  Descending, so N means the newest N — the same direction the query carries. */
export function capped(want: RequestedCollection, rows: PreviewDataset): PreviewDataset {
  const cap = want.limit;
  if (cap === undefined) return rows;
  // The id is always a string here — the read puts the document id on the record — and it is read
  // back defensively anyway: this is also handed rows from a listener's snapshot.
  const named = rows.map((row) => ({ row, id: typeof row.id === "string" ? row.id : "", key: orderKey(row[cap.field]) }));
  const ordered = named.filter((entry): entry is Ordered => entry.key !== null);
  ordered.sort(laterFirst);
  return ordered.slice(0, cap.rows).map((entry) => entry.row);
}

/** The selector each collection's own rows are found by, per cid — see {@link ownRequests}.
 *
 *  Exported for the INTENT path, which has to decide about a row no list returned: the list can
 *  fail while the document itself is readable (a refused read on an app that has just been
 *  published, an offline moment, a transient), and the page will have found that row through
 *  `view.mine(cid, key)`, which is a `get` and not a list. Both paths then ask the same predicate,
 *  which is the point of exporting it rather than writing a second one. */
export function ownSelectors(config: PublishedConfigDoc): Record<string, RequestedCollection> {
  return Object.fromEntries(ownRequests(config).map((want) => [want.cid, want]));
}

/** Every page's records, each page asking only for what its own projection names.
 *
 *  Read once per collection and shared where two pages want the same one, but kept in per-page maps
 *  so that a collection only a member page opens never reaches the public page's frame. */
async function readDatasets(
  handle: SharedAppHandle,
  aid: string,
  wanted: { key: string; collections: RequestedCollection[] }[],
): Promise<{ datasets: PreviewDatasets; unreadable: string[] }> {
  const datasets: PreviewDatasets = {};
  const unreadable = new Set<string>();
  const cache = new Map<string, PreviewDataset | null>();
  for (const page of wanted) {
    const forPage: Record<string, PreviewDataset> = {};
    for (const want of page.collections) {
      // Keyed on the SCOPE too: the same collection read `all` for the front desk and `own` for the
      // participant is two different answers, and sharing one would hand a page rows it may not see.
      const key = `${want.cid}:${want.scope}:${want.emailField ?? ""}:${want.uidField ?? ""}:${want.ownDocId ?? ""}:${want.limit?.rows ?? ""}:${want.limit?.field ?? ""}`;
      if (!cache.has(key)) {
        cache.set(key, await readCollection(handle, aid, want).catch(() => null));
      }
      const rows = cache.get(key) ?? null;
      if (rows === null) unreadable.add(want.cid);
      else forPage[want.cid] = rows;
    }
    datasets[page.key] = forPage;
  }
  // Code-unit order, like every other list this feature reports: the same order Firestore lists
  // ids in, so a projection sorted one way against a listing sorted another does not read as a
  // change.
  return { datasets, unreadable: [...unreadable].sort((left, right) => (left < right ? -1 : 1)) };
}

/** The collections a page WATCHES, read off the projection rather than off the declaration —
 *  `withLive` in the package drops names the tier may not read, and a pane that polled for one of
 *  those would be watching something production does not.
 *
 *  A tier document lists its pages under `views`; the public one has a single `view`. */
/** ABSENT rather than empty when a page watches nothing, which is how the projection itself writes
 *  it: `live: []` on the wire would say the author declared an empty watch list. */
const watching = (live: string[]): { live?: string[] } => {
  if (live.length === 0) return {};
  return { live };
};

const liveOf = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value.live)) return [];
  return value.live.filter((cid): cid is string => typeof cid === "string");
};

const tierLive = (config: unknown, viewId: string): string[] => {
  if (!isRecord(config) || !Array.isArray(config.views)) return [];
  return liveOf(config.views.find((view) => isRecord(view) && view.id === viewId));
};

/** The anonymous page, or none. Its own function so the run above stays a list of steps: what it
 *  needs is the HTML, the viewer already resolved, and the public document's own watch list. */
const publicPageOf = (html: string | null, viewer: Viewer, config: unknown): PreviewPage[] => {
  if (html === null) return [];
  return [{ id: PUBLIC_PAGE_ID, html, audience: "public", viewer, ...watching(liveOf(isRecord(config) ? config.view : null)) }];
};

/** What every page asks for, in one list. Its own function so the run above stays a list of steps
 *  — and so the watch plan and the one-shot read cannot be built from two different readings. */
const requestsOf = (publicHtml: string | null, config: PublishedConfigDoc, plans: TierPlan[]): { key: string; collections: RequestedCollection[] }[] => {
  const anonymous = publicHtml === null ? [] : [{ key: previewPageKey("public", PUBLIC_PAGE_ID), collections: publicRequests(config) }];
  return [...anonymous, ...plans.flatMap(tierRequests)];
};

/** WHICH READS A LISTENER REPEATS: the collections each page declared `live`, paired with the
 *  request that page makes of them.
 *
 *  Intersected with what the page actually asks for rather than taken from `live` alone. `live` is
 *  a subset of `collections` by construction, and this is where that stops being trusted: a watch
 *  with no request behind it would be a listener on a collection the page never reads.
 *
 *  Pure, so the mapping is testable without a session. */
export const watchesOf = (pages: PreviewPage[], requests: { key: string; collections: RequestedCollection[] }[]): PreviewWatch[] => {
  const asked = new Map(requests.map((entry) => [entry.key, entry.collections]));
  return pages.flatMap((page) => {
    const key = previewPageKey(page.audience, page.id);
    const live = new Set(page.live ?? []);
    return (asked.get(key) ?? []).filter((want) => live.has(want.cid)).map((want) => ({ key, want }));
  });
};

/** What one tier's projection says each of its pages may query for. */
function tierRequests(plan: TierPlan): { key: string; collections: RequestedCollection[] }[] {
  const config = plan.config;
  const views = isRecord(config) && Array.isArray(config.views) ? config.views : [];
  const byId = new Map<string, RequestedCollection[]>();
  for (const view of views) {
    if (!isRecord(view) || typeof view.id !== "string") continue;
    byId.set(view.id, Array.isArray(view.collections) ? view.collections.flatMap(asRequested) : []);
  }
  return plan.pages.map((page) => ({ key: previewPageKey(plan.tier, page.id), collections: byId.get(page.id) ?? [] }));
}

/** The cap a projection carries, or nothing — BOTH halves, and only on a scope that can be
 *  ordered. Read the way the published runtime reads it (mulmoserver `appViewShape.ts`), so the
 *  pane cannot honour a shape production drops: a count with no field would take an arbitrary N
 *  here and the newest N there, which is a preview that disagrees with the page it is previewing. */
const askedCap = (value: unknown, scope: "all" | "own"): { limit?: { rows: number; field: string } } => {
  if (scope !== "all" || !isRecord(value)) return {};
  const { rows, field } = value;
  if (typeof rows !== "number" || !Number.isInteger(rows) || rows < 1) return {};
  if (typeof field !== "string" || field === "") return {};
  return { limit: { rows, field } };
};

const asRequested = (value: unknown): RequestedCollection[] => {
  if (!isRecord(value) || typeof value.cid !== "string") return [];
  const scope = value.scope === "own" ? "own" : "all";
  return [
    {
      cid: value.cid,
      scope,
      ...(typeof value.emailField === "string" ? { emailField: value.emailField } : {}),
      ...(typeof value.uidField === "string" ? { uidField: value.uidField } : {}),
      ...(value.ownDocId === "auth.uid" ? { ownDocId: "auth.uid" as const } : {}),
      ...askedCap(value.limit, scope),
    },
  ];
};

/** What a public create may carry, per collection, lifted out of the projection.
 *
 *  The projection types `submit` loosely (`Record<string, Record<string, unknown>>`) because the
 *  rules read those keys by the author's own names. Only `createFields` is read on this side, and
 *  it is narrowed here rather than at the frame, so a declaration missing it becomes "this
 *  collection accepts no fields" instead of a crash in the parent. */
function submitDeclarations(config: PublishedConfigDoc): Record<string, { createFields: string[] }> {
  return Object.fromEntries(
    Object.entries(config.submit ?? {}).map(([cid, spec]) => [
      cid,
      { createFields: Array.isArray(spec.createFields) ? spec.createFields.filter((field): field is string => typeof field === "string") : [] },
    ]),
  );
}

/** The generated form as the PANE will draw it.
 *
 *  The reduction is `writableFields` — the same function `previewWrite` and the published site's
 *  submit path call — so the boxes on screen are the boxes a visitor gets, rather than a second
 *  opinion about which of `createFields` a person answers. What is added on top is the schema's
 *  `type` and an `enum`'s choices, which come from the form publish writes to `config/public`:
 *  they are the only way either page learns them, because a visitor may not read the schema. */
function formInputsOf(config: PublishedConfigDoc, form: PublicForm): PreviewForm {
  return Object.fromEntries(
    Object.entries(form).flatMap(([cid, collection]) => {
      const spec = config.submit?.[cid];
      if (!isRecord(spec)) return [];
      const createFields = Array.isArray(spec.createFields) ? spec.createFields.filter((field): field is string => typeof field === "string") : [];
      const text = (key: string): string | undefined => (typeof spec[key] === "string" ? spec[key] : undefined);
      // The whole submit block, not a hand-picked three. Each of the fields the HOST fills in — the
      // address, the uid, the status, the stamp — is one a visitor cannot usefully answer, and
      // passing them one at a time is how a new one gets forgotten and drawn as a box. Read off the
      // SUBMIT block, which is where the rules read them from.
      const submit = { createFields, emailField: text("emailField"), uidField: text("uidField"), stampField: text("stampField") };
      const fields = writableFields({ fields: collection.fields, statusField: collection.statusField }, submit).map((field) => {
        const drawn = collection.fields[field.name];
        return {
          ...field,
          type: drawn?.type ?? "string",
          ...(drawn?.values === undefined ? {} : { values: [...drawn.values] }),
        };
      });
      // An entry with NO fields is still an entry. `publicFormOf` keeps a collection whose whole
      // submission is host-filled — a stamp, a uid, or both: "count me in" is a real declaration,
      // and the button is the submission. Dropped here, the pane shows no collection and no
      // "Send it", so the one shape whose page cannot be written by hand is the one the author
      // cannot try. What must stay dropped is a collection publish did not describe at all, which
      // never reaches this loop.
      return [[cid, fields] as const];
    }),
  );
}

/** WHERE THE AUTHOR'S OWN ROWS ARE READ FROM, per collection the app opens for submission.
 *
 *  The same FOUR selectors the rules identify an own row by, in the order `ownsRow` applies them:
 *  the document id when it IS the uid, the id rebuilt as `uid + "_" + <idField>`, the uid field,
 *  then the verified address. Read as
 *  the author (this runs on their machine) and then FILTERED to their own rows, because the reader
 *  a published page has is a visitor and the preview must never show more than production. */
const ownRequests = (config: PublishedConfigDoc): RequestedCollection[] =>
  Object.entries(config.submit ?? {}).map(([cid, spec]) => {
    const text = (key: string): string | undefined => (typeof spec[key] === "string" ? spec[key] : undefined);
    const composite = spec.idFrom === "auth.uid+field" ? text("idField") : undefined;
    return {
      cid,
      scope: "own" as const,
      ...(spec.idFrom === "auth.uid" ? { ownDocId: "auth.uid" as const } : {}),
      ...(composite === undefined ? {} : { ownIdField: composite }),
      ...(text("uidField") === undefined ? {} : { uidField: text("uidField") }),
      ...(text("emailField") === undefined ? {} : { emailField: text("emailField") }),
    };
  });

/** The key the own-rows read is cached under. Never a page's: no page is handed these as datasets —
 *  they travel as `viewer.mine`, which is a different message with a different meaning. */
const OWN_KEY = "own:reader";

/** The public page has no view id of its own — it is the app's one anonymous face, and the
 *  projection names it nowhere. */
const PUBLIC_PAGE_ID = "public";

/** What the anonymous page may query for. Everything at `scope: "all"`: a visitor holds no identity
 *  the rules could narrow a read by, which is why `public.read` is a list of whole collections. */
const publicRequests = (config: PublishedConfigDoc): RequestedCollection[] => {
  // Keyed by cid on the public document rather than riding on each entry: `view.collections` there
  // is a list of NAMES with nowhere to hang a value. `Object.hasOwn` before the lookup, because
  // `constructor` and `toString` are valid collection names and would otherwise reach a prototype
  // member.
  const caps = config.view?.limit;
  return (config.view?.collections ?? config.read).map((cid) => ({
    cid,
    scope: "all" as const,
    ...askedCap(caps !== undefined && Object.hasOwn(caps, cid) ? caps[cid] : undefined, "all"),
  }));
};

export async function previewSharedApp(root: string, opts: SharedAppOptions = {}): Promise<PreviewResult> {
  const context = await sharedAppContext(root);
  if (!context.ok) return context;
  const { authored, collections, handle } = context;
  const { aid } = authored;

  // Best effort, and a failure here is NOT fatal. A first preview runs against an app that does not
  // exist, and the rules answer that read with a denial rather than an absence (see
  // `readCurrentApp`) — so "cannot read it" and "there is nothing there" arrive as the same answer,
  // and both mean the same thing for a projection: there is nothing to carry forward.
  const current = await readCurrentApp(handle, aid, "preview", "Nothing is written by a preview.");
  const existingApp = current.ok ? current.app : null;

  const { stamp } = await stampFor(handle, root, opts);
  // The same call publish makes, asked for its answer instead of its effect. Nothing is written.
  const face = projectPublish(authored, schemasOf(collections), stamp, existingApp);

  const view = declaredView(authored);
  const page = view === null ? null : await readAppViewFile(root, view, stamp.publishedAt);
  if (page !== null && !page.ok) return { ok: false, partial: false, problems: page.problems };

  const tiers = await planAppViewTiers(root, authored, stamp);
  if (!tiers.ok) return { ok: false, partial: false, problems: tiers.problems };

  const publicHtml = page !== null && page.ok ? page.view.html : null;
  // The projection each page writes, kept BESIDE the viewer it resolves to rather than recomputed
  // later: an intent is judged against the same `write` list this `viewer` was built from, so the
  // buttons a page draws and the moves this host will perform cannot come from two readings.
  const writes: Partial<Record<PreviewAudience, ProjectedViewWrite[]>> = {};
  // THE PUBLIC PAGE HAS ONE TOO. Read off the same document the anonymous page reads, at the
  // PARTICIPANT's tier — because the rules make those two readers the same one over their own row
  // (`ownRow` asks for `authed()` and nothing else). It used to have none, so a page offering the
  // cancellation the rules were waiting to allow drew no button, and the intent behind it reached a
  // parent that dropped it.
  writes.public = projectedWritesOf(face.config);
  // `me` IS NULL, and it matches what mulmoserver posts to the live `/a/{slug}` — see
  // `publicSelfWrites.ts` there for the reasoning, which is worth repeating in one line: nothing on
  // this tier reads it, and a published page that held the visitor's address could carry it off by
  // navigating its own context once.
  //
  // The author's address is NOT substituted here either, and that is the point of the whole file: a
  // preview that handed the page one more thing than production hands it is a preview of a page
  // that does not exist. The author IS a reader here, and this is what a reader gets.
  const publicPages = publicPageOf(publicHtml, viewerFor(writes.public, null, PUBLIC_WRITE_TIER), face.config);
  const tierPages: PreviewPage[] = tiers.plans.flatMap((plan) => {
    // The author, as this tier's projection resolves them. `viewerFor` is the
    // package's, and mulmoserver calls the same one with the same projection —
    // which is the whole point: while the pane had only the PUBLIC bridge, every
    // roster page previewed here was handed `{}` and drew no buttons at all.
    // Read back through the PACKAGE's reader, which is the one mulmoserver uses on the document it
    // gets off Firestore. A looser read here would let the preview draw a control production drops
    // — the preview being looser than production, the one thing it must never be.
    const projected = projectedWritesOf(plan.config);
    writes[plan.tier] = projected;
    const viewer = viewerFor(projected, handle.email, plan.tier);
    return plan.pages.map((tierPage): PreviewPage => ({
      id: tierPage.id,
      html: tierPage.html,
      audience: plan.tier,
      viewer,
      ...watching(tierLive(plan.config, tierPage.id)),
    }));
  });
  const pages = [...publicPages, ...tierPages];

  // WHICH collections, asked of each page's own PROJECTION rather than of the declaration —
  // `public.read` is what a visitor may see, and reading everything on disk would draw a page the
  // author cannot ship. Per page rather than one list for the app, because a member page may name a
  // collection the public one must never receive.
  const requests = requestsOf(publicHtml, face.config, tiers.plans);
  const { datasets, unreadable } = await readDatasets(handle, aid, requests);

  // THE AUTHOR'S OWN ROWS, read separately from the pages and never as a page's datasets: they
  // travel as `viewer.mine`, which is a different message saying a different thing. A cid that
  // could not be read is left OUT by `readDatasets`, which is exactly the shape the port wants —
  // absent means "nobody looked", present-and-empty means "you have submitted nothing".
  const ownRead = await readDatasets(handle, aid, [{ key: OWN_KEY, collections: ownRequests(face.config) }]);

  const form = publicFormOf(authored, schemasOf(collections));
  // THE ONE LIST OF "what a page could have sent", used for the boxes the pane draws AND for the
  // projection of the author's own rows. Two computations of it is one more place for the preview
  // to hand a page a field production would have dropped.
  const formInputs = formInputsOf(face.config, form);

  return {
    ok: true,
    aid,
    submit: submitDeclarations(face.config),
    // WHICH collection the platform draws as articles, resolved by the projection rather than
    // re-derived here: `articleCid` in the package settles the single-collection case once, and a
    // second answer computed in the preview is how a pane comes to refuse an `open` the published
    // page performs.
    ...(face.config.view?.article === undefined ? {} : { articleCid: face.config.view.article.collection }),
    config: face.config,
    form,
    writes,
    pages,
    publicFace: publicFaceOf(face.public),
    fromLiveApp: existingApp !== null,
    generatedForm: publicHtml === null && Object.keys(form).length > 0,
    formInputs,
    datasets,
    watches: watchesOf(pages, requests),
    // Projected to the fields a page in this position could have SENT — the package's rule, so the
    // preview hands a page exactly what mulmoserver hands the live one. A page given one more field
    // here than production gives it is a preview of a page that does not exist.
    own: ownRowsFor(
      Object.entries(formInputs).map(([cid, fields]) => ({ cid, fields })),
      ownRead.datasets[OWN_KEY] ?? {},
      Object.keys(ownRead.datasets[OWN_KEY] ?? {}),
    ),
    unreadable,
    warnings: [...(page !== null && page.ok ? page.view.warnings : []), ...tiers.warnings],
  };
}
