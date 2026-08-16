// The preview payload, narrowed rather than asserted.
//
// Its own module because narrowing an untrusted-shaped payload is a different job from drawing it:
// everything here is a pure function of the JSON and is testable without a browser or a server —
// and because the pane it serves is at its line limit, which is what forced the split.
//
// The wire shape itself lives in `common/sharedAppPreview.ts`, decided by both ends.
import type { Viewer, ViewCapability } from "@receptron/sharedapp/view";
import { isRecord } from "../../common/isRecord";
import type { PreviewAudience, PreviewDataset, PreviewForm, PreviewFormField, PreviewPage, SharedAppPreview } from "../../common/sharedAppPreview";

/** The payload, narrowed rather than asserted. Every field has a floor, because a pane that threw
 *  on an unexpected shape would report a server it could not read as an app that will not publish —
 *  two very different things to be told while you are trying to fix a page. */
export function asPayload(value: unknown): SharedAppPreview | null {
  if (!isRecord(value)) return null;
  return {
    aid: typeof value.aid === "string" ? value.aid : "",
    submit: asSubmit(value.submit),
    pages: Array.isArray(value.pages) ? value.pages.flatMap(asPage) : [],
    publicOpen: value.publicOpen === true,
    fromLiveApp: value.fromLiveApp === true,
    generatedForm: value.generatedForm === true,
    formInputs: asFormInputs(value.formInputs),
    datasets: isRecord(value.datasets) ? Object.fromEntries(Object.entries(value.datasets).map(([key, rows]) => [key, asDatasets(rows)])) : {},
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
  return [{ id: value.id, html: value.html, audience, ...asViewer(value.viewer) }];
};

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
