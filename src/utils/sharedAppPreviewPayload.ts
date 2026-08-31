// The preview payload, narrowed rather than asserted.
//
// Its own module because narrowing an untrusted-shaped payload is a different job from drawing it:
// everything here is a pure function of the JSON and is testable without a browser or a server —
// and because the pane it serves is at its line limit, which is what forced the split.
//
// The wire shape itself lives in `common/sharedAppPreview.ts`, decided by both ends.
import type { Viewer, ViewCapability } from "@receptron/sharedapp/view";
import { isRecord } from "../../common/isRecord";
import type { PublicFace } from "../../common/sharedAppPublicFace";
import type { PreviewAudience, PreviewDataset, PreviewForm, PreviewFormField, PreviewPage, SharedAppPreview } from "../../common/sharedAppPreview";

/** The payload, narrowed rather than asserted. Every field has a floor, because a pane that threw
 *  on an unexpected shape would report a server it could not read as an app that will not publish —
 *  two very different things to be told while you are trying to fix a page. */
/** The face, narrowed to the three the type names. An unknown value falls to the CLOSED end: a
 *  header that says "roster only" about an app that is open is a diagnostic to correct, while the
 *  reverse is the alarm #1926 was filed about. */
const asPublicFace = (value: unknown): PublicFace => (value === "open" || value === "declared" ? value : "none");

export function asPayload(value: unknown): SharedAppPreview | null {
  if (!isRecord(value)) return null;
  return {
    aid: typeof value.aid === "string" ? value.aid : "",
    submit: asSubmit(value.submit),
    // ABSENT rather than "", because "" is a collection id nothing declares and the parent compares
    // this against the cid a page names. Absent is the app that publishes no articles, which is the
    // shape that must refuse an `open` rather than one that accidentally matches nothing.
    ...(typeof value.articleCid === "string" && value.articleCid !== "" ? { articleCid: value.articleCid } : {}),
    pages: Array.isArray(value.pages) ? value.pages.flatMap(asPage) : [],
    // Narrowed to the three the type names, and an unknown value falls to the CLOSED end: a header
    // that says "roster only" about an app that is open is a diagnostic to correct, while the
    // reverse is the alarm #1926 was filed about.
    publicFace: asPublicFace(value.publicFace),
    fromLiveApp: value.fromLiveApp === true,
    generatedForm: value.generatedForm === true,
    formInputs: asFormInputs(value.formInputs),
    datasets: isRecord(value.datasets) ? Object.fromEntries(Object.entries(value.datasets).map(([key, rows]) => [key, asDatasets(rows)])) : {},
    // The author's own rows. `{}` is the floor and it is the honest one: a cid ABSENT from this map
    // is "nobody looked", so an unreadable payload says nothing about any collection rather than
    // saying "you have submitted nothing" about all of them.
    own: asDatasets(value.own),
    unreadable: strings(value.unreadable),
    warnings: strings(value.warnings),
  };
}

/** What a public create may carry, per collection. Narrowed with a floor of `[]` rather than
 *  dropped: an unreadable declaration must make the parent refuse a FIELD, not refuse the whole
 *  collection — the two refusals name different repositories to whoever reads them. */
const asSubmit = (value: unknown): Record<string, { createFields: string[] }> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([cid, spec]) => [cid, { createFields: isRecord(spec) ? strings(spec.createFields) : [] }]));
};

/** The generated form's inputs. A collection whose inputs cannot be read is DROPPED rather than
 *  drawn empty: an empty form is a Send button that submits nothing, and the author would read the
 *  refusal that follows as a fault in their declaration. */
const asFormInputs = (value: unknown): PreviewForm => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([cid, fields]) => {
      const drawn = Array.isArray(fields) ? fields.flatMap(asFormField) : [];
      return drawn.length === 0 ? [] : [[cid, drawn] as const];
    }),
  );
};

const asFormField = (value: unknown): PreviewFormField[] => {
  if (!isRecord(value) || typeof value.name !== "string" || value.name === "") return [];
  const values = strings(value.values);
  return [
    {
      name: value.name,
      label: typeof value.label === "string" && value.label !== "" ? value.label : value.name,
      required: value.required === true,
      type: typeof value.type === "string" ? value.type : "string",
      ...(values.length === 0 ? {} : { values }),
    },
  ];
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

const AUDIENCES: PreviewAudience[] = ["public", "member", "roster"];

const asPage = (value: unknown): PreviewPage[] => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.html !== "string") return [];
  const audience = AUDIENCES.find((candidate) => candidate === value.audience);
  if (audience === undefined) return [];
  // `live` floors to absent rather than to `[]`, which is the same distinction the projection
  // makes: a page that watches nothing and a page whose watch list could not be read must not both
  // read as "watches nothing" — but here they may, because the only thing the pane does with it is
  // re-read, and re-reading a page that does not need it costs a poll rather than correctness.
  const live = strings(value.live);
  return [{ id: value.id, html: value.html, audience, ...asViewer(value.viewer), ...(live.length === 0 ? {} : { live }) }];
};

/** `{ <status>: [<field>...] }`, entry by entry.
 *
 *  Every value goes through `strings`, so a map whose entries are not lists of strings floors to
 *  an empty list for that status rather than reaching a caller that would send them as fields. */
const stringMap = (value: unknown): Record<string, string[]> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, held]) => [key, strings(held)]));
};

/** `{ <field>: <bytes> }`, entry by entry. A cap that is not a positive number is DROPPED rather
 *  than clamped: a page comparing a length against a malformed one would refuse a value nothing
 *  else in the stack objects to. */
const capsOf = (value: Record<string, unknown>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0),
  );

/** One collection's capability, field by field.
 *
 *  Rebuilt rather than passed through, and NOT asserted into shape: what arrives is JSON from this
 *  host's own server, but the SHAPE is decided in another repository (`@receptron/sharedapp`), and
 *  an assertion here would turn a rename there into a page drawing a control it may not use. Every
 *  flag floors to false, which is the direction that refuses. */
const asCapability = (cid: string, value: unknown): ViewCapability => {
  const from = isRecord(value) ? value : {};
  return {
    cid,
    transitionAny: from.transitionAny === true,
    transitionOwn: from.transitionOwn === true,
    assign: from.assign === true,
    assignees: strings(from.assignees),
    ...(typeof from.assigneeField === "string" ? { assigneeField: from.assigneeField } : {}),
    withdrawFrom: strings(from.withdrawFrom),
    // The fields a submitter may CORRECT in their own row, per status. Rebuilt entry by entry
    // rather than passed through, and floored to `{}` — an empty map offers no correction, which
    // is the direction that refuses.
    correctFrom: stringMap(from.correctFrom),
    // The ROLE half of a correction: any field, any row, no status. Floored to false — a page told
    // it may rewrite anything when it may not draws exactly the control this whole payload exists
    // to keep it from drawing.
    correctAny: from.correctAny === true,
    // The fields NO correction may write — the ones the rules froze when the record was created,
    // plus the status and the assignee, which move through their own asks. Floored to `[]`, which
    // is the direction that draws MORE inputs rather than fewer — the opposite of every flag above
    // — and deliberately: a preview that hid a field production allows is a preview whose author
    // cannot see the control they wrote. Being refused when pressed is the correct failure here,
    // and the refusal names the field.
    frozen: strings(from.frozen),
    // Absent rather than `{}` where the app declared none: an empty map read as a cap is "every
    // field is capped at nothing".
    ...(isRecord(from.maxBytes) ? { maxBytes: capsOf(from.maxBytes) } : {}),
    // The STAFF half of a withdrawal, and a different permission from the list above rather than a
    // wider setting of it: that one is the statuses a submitter may take their OWN row away from,
    // and this is the role (`writerDelete` + `writers`, resolved by the package).
    //
    // Rebuilt by name like everything else here, and the field that proves why: the package made it
    // REQUIRED, so leaving it out was a compile error rather than a staff page previewing without
    // the delete control that the published page draws.
    withdrawAny: from.withdrawAny === true,
    // The statuses NO delete succeeds from, whichever of the two permissions above the reader
    // holds. It has to be here for the pane to be worth anything: `withdrawAny` says "any row" and
    // the rules mean "any row the RECORD has not sealed", so a pane without it draws a delete on a
    // closed topic and the author learns the truth from production.
    //
    // The ONE field here that does not floor in the refusing direction, and it cannot: an empty
    // list reads as "nothing is sealed", and there is no value that means "assume everything is".
    // What makes that acceptable is where the floor is reached from — this JSON comes from this
    // host's own server, running the same package, where `capabilityOf` always sets the key. An
    // absent one therefore means an OLDER server, whose published pages do not honour seals
    // either, so the pane matches what that server actually serves. The refusal that is not a
    // matter of taste stays in `firestore.rules`.
    sealed: strings(from.sealed),
  };
};

/** The `{ me, can }` the server resolved for this page, or nothing.
 *
 *  A FLOOR IS NOT WANTED HERE, and that is the decision rather than an omission: inventing
 *  `{ me: null, can: {} }` for a payload that carried none is the empty viewer this whole change
 *  exists to remove — it draws a page with no buttons and says nothing about why. Absent, the pane
 *  uses the public parent, which is right for a public page and reported for any other.
 *
 *  `me` floors to null rather than to "": null is "no verified address", a member of nothing, while
 *  "" is an address that could accidentally equal an empty `assigneeField` on a record. */
const asViewer = (value: unknown): { viewer?: Viewer } => {
  if (!isRecord(value) || !isRecord(value.can)) return {};
  const me = typeof value.me === "string" && value.me !== "" ? value.me : null;
  return { viewer: { me, can: Object.fromEntries(Object.entries(value.can).map(([cid, entry]) => [cid, asCapability(cid, entry)])) } };
};

const asDatasets = (value: unknown): Record<string, PreviewDataset> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([cid, rows]) => [cid, Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => isRecord(row)) : []]),
  );
};
