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
// Both from `/view`, which is where the PARENT's vocabulary lives — and where the read-back has to
// be: the root entry reaches the compiler, and the compiler imports core's server half at runtime.
import { projectedWritesOf, viewerFor, writableFields } from "@receptron/sharedapp/view";
import {
  previewPageKey,
  type PreviewDataset,
  type PreviewDatasets,
  type PreviewForm,
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
  writes: Partial<Record<TierPlan["tier"], ProjectedViewWrite[]>>;
}

export type PreviewResult = PreviewSuccess | SharedAppFailure;

/** One collection as a page asks for it: every row, or only the reader's own.
 *
 *  The narrow shape of `ProjectedViewCollection`, restated rather than imported, because only these
 *  three fields decide what to read and the rest of that type is about how a tier is projected. */
interface RequestedCollection {
  cid: string;
  scope: "all" | "own";
  emailField?: string | undefined;
  uidField?: string | undefined;
  ownDocId?: "auth.uid" | undefined;
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
  if (want.scope === "all") return rows;
  if (want.ownDocId === "auth.uid") return rows.filter((row) => row.id === handle.uid);
  // The uid before the address, matching the reader (`ownLookup` in mulmoserver): a projection
  // carries exactly one selector, and asking in a fixed order keeps the answer from depending on
  // which branch happens to be written first.
  if (want.uidField !== undefined) return rows.filter((row) => row[want.uidField ?? ""] === handle.uid);
  const field = want.emailField;
  if (field === undefined) return [];
  return rows.filter((row) => row[field] === handle.email);
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
      const key = `${want.cid}:${want.scope}:${want.emailField ?? ""}:${want.uidField ?? ""}:${want.ownDocId ?? ""}`;
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

/** The public page has no view id of its own — it is the app's one anonymous face, and the
 *  projection names it nowhere. */
const PUBLIC_PAGE_ID = "public";

/** What the anonymous page may query for. Everything at `scope: "all"`: a visitor holds no identity
 *  the rules could narrow a read by, which is why `public.read` is a list of whole collections. */
const publicRequests = (config: PublishedConfigDoc): RequestedCollection[] =>
  (config.view?.collections ?? config.read).map((cid) => ({ cid, scope: "all" as const }));

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
  const publicPages: PreviewPage[] = publicHtml === null ? [] : [{ id: PUBLIC_PAGE_ID, html: publicHtml, audience: "public" }];
  // The projection each tier writes, kept BESIDE the viewer it resolves to rather than recomputed
  // later: an intent is judged against the same `write` list this `viewer` was built from, so the
  // buttons a page draws and the moves this host will perform cannot come from two readings.
  const writes: Partial<Record<TierPlan["tier"], ProjectedViewWrite[]>> = {};
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
    return plan.pages.map((tierPage): PreviewPage => ({ id: tierPage.id, html: tierPage.html, audience: plan.tier, viewer }));
  });
  const pages = [...publicPages, ...tierPages];

  // WHICH collections, asked of each page's own PROJECTION rather than of the declaration —
  // `public.read` is what a visitor may see, and reading everything on disk would draw a page the
  // author cannot ship. Per page rather than one list for the app, because a member page may name a
  // collection the public one must never receive.
  const { datasets, unreadable } = await readDatasets(handle, aid, [
    ...(publicHtml === null ? [] : [{ key: previewPageKey("public", PUBLIC_PAGE_ID), collections: publicRequests(face.config) }]),
    ...tiers.plans.flatMap(tierRequests),
  ]);

  const form = publicFormOf(authored, schemasOf(collections));

  return {
    ok: true,
    aid,
    submit: submitDeclarations(face.config),
    config: face.config,
    form,
    writes,
    pages,
    publicOpen: face.public !== undefined,
    fromLiveApp: existingApp !== null,
    generatedForm: publicHtml === null && Object.keys(form).length > 0,
    formInputs: formInputsOf(face.config, form),
    datasets,
    unreadable,
    warnings: [...(page !== null && page.ok ? page.view.warnings : []), ...tiers.warnings],
  };
}
