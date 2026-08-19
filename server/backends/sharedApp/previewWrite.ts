// A submission made FROM the preview, written to the real database.
//
// It goes to Firestore, and that is the decision rather than an omission. An app's records live in
// Firebase and nowhere else (`plans/feat-shared-app-preview.md`), so a scratch layer here would be a
// second implementation of the one path nobody has tested — "did the write actually land" is the
// question the preview exists to answer, and a fake destination answers it with a yes it did not
// earn. The author writes as themselves, with their own credentials, through the same rules a
// visitor meets.
//
// WHAT IS BORROWED AND WHAT IS OURS. The record, its id and whether a second document travels with
// it are `@receptron/sharedapp/view`'s — the same functions mulmoserver's public page uses, because
// a record built differently here would be a record the rules judge differently. What is ours is
// the seam to the database.
//
// AND THAT SEAM NEEDED A SECOND DOOR. Everything else under `sharedApp/` writes through
// `handle.docs`, which has `set` / `create` / `delete` and no batch. A declared `mirror` cannot be
// written that way: `firestore.rules:425` reads the second document with `getAfter()` precisely
// because "both writes are in one batch", so a mirror written singly is REFUSED — safely, and with
// nothing to tell the author about it. So a paired write goes through `writeBatch` on the Firestore
// this host already holds (`currentFirestore()`), and nothing else does.
//
// The alternative was to add a batch to `@mulmoclaude/core`'s `FirestoreDocs`. It was not taken:
// that seam exists so CORE's store code can be host-agnostic, and MulmoClaude declares no support
// for shared collections at all (it unbound its accessor — see `sharedCollections.ts`). There is no
// second host to serve, and a shared app's operations are this host's by design (D5).
import { doc, collection, serverTimestamp, writeBatch } from "firebase/firestore";
import { randomUUID } from "node:crypto";
import { appSchemasPath, type PublishedConfigDoc } from "@receptron/sharedapp";
import {
  MIRROR_OPEN,
  missingIdField,
  missingRequired,
  plannedWrite,
  recordId,
  recordOf,
  writableFields,
  type DrawnForm,
  type PlannedWrite,
  type SubmitSpec,
} from "@receptron/sharedapp/view";
import { isRecord } from "../../../common/isRecord.js";
import type { PreviewWrittenRecord } from "../../../common/sharedAppPreview.js";
import { currentFirestore } from "../remoteHost/session.js";
import { previewSharedApp } from "./preview.js";
import { sharedAppContext, type SharedAppHandle } from "./context.js";

/** Where a shared collection's records live. */
const itemsPath = (aid: string, cid: string): string => `${appSchemasPath(aid)}/${cid}/items`;

export interface PreviewWriteSuccess {
  ok: true;
  /** What was written, so the pane can remember it and offer to take it back. */
  written: PreviewWrittenRecord;
}

export interface PreviewWriteFailure {
  ok: false;
  /** Named, and named by the HOST's vocabulary. What the rules answer is
   *  "Missing or insufficient permissions", which tells an author nothing about which of their
   *  declarations it was. */
  error: string;
  /** WHOSE refusal this was.
   *
   *  Because most of the failures on this path never reach the database at all — no session, a
   *  projection that will not build, a cid nothing declares, a required field the page did not
   *  send — and a caller reporting all of them as "the deployed rules said no" sends the author to
   *  change a declaration the rules never saw. `taken` is its own answer for the same reason and a
   *  sharper one: under `idFrom: "auth.uid"` it means the AUTHOR already has a record here, which
   *  says nothing about a visitor, who has a different uid and would be accepted.
   *
   *  The pane does not read it — its reader is a person watching their own screen, who has the
   *  context this field carries. The headless run's reader is an agent that does not. */
  reason: "rules" | "taken" | "host";
}

export type PreviewWriteResult = PreviewWriteSuccess | PreviewWriteFailure;

/** One collection's declaration and form, out of the projection this publish would write. */
function specFor(config: PublishedConfigDoc, form: Record<string, DrawnForm>, cid: string): { submit: SubmitSpec; drawn: DrawnForm } | null {
  const raw = config.submit?.[cid];
  const drawn = form[cid];
  if (!isRecord(raw) || drawn === undefined) return null;
  const createFields = Array.isArray(raw.createFields) ? raw.createFields.filter((field): field is string => typeof field === "string") : [];
  const text = (key: string): string | undefined => (typeof raw[key] === "string" ? raw[key] : undefined);
  return {
    submit: {
      createFields,
      auth: text("auth"),
      emailField: text("emailField"),
      // Filled by `recordOf` from the handle below, exactly as the address is. Read off the
      // published declaration for the reason the stamp is: `uidOk` tests the submit block.
      uidField: text("uidField"),
      initialStatus: text("initialStatus"),
      idFrom: text("idFrom"),
      idField: text("idField"),
      mirror: text("mirror"),
      // Read back off the PUBLISHED declaration, which is where the rules read it from too. The
      // form beside it carries the same name, and this is deliberately not that one: `stampOk`
      // tests `"stampField" in s` against the submit block, so the submit block is the authority.
      stampField: text("stampField"),
    },
    drawn,
  };
}

/** WHY THE RULES SAID NO, asked only once they have.
 *
 *  A refusal names nothing — "Missing or insufficient permissions" is the whole of it — and the
 *  author is the one person who could act on the answer. So when a write is denied, the declaration
 *  is walked against the record to find a condition that does not hold, and THAT is reported.
 *
 *  AFTERWARDS, never before. The rules judge against `request.time` on Google's clock; this runs on
 *  the author's. A pre-flight check would refuse writes that would have succeeded on a machine
 *  whose clock is a minute slow, which is the preview becoming an authority it is not (constraint 3
 *  in the plan). Asked after a denial it cannot cause one — it can only explain one.
 *
 *  It answers null when it finds nothing, and the bare refusal is passed through rather than
 *  dressed up. A guess would be worse than the truth. */
async function explainRefusal(handle: SharedAppHandle, aid: string, raw: Record<string, unknown>, record: Record<string, unknown>): Promise<string | null> {
  const window = isRecord(raw.window) ? raw.window : null;
  if (window === null) return null;
  const now = Date.now();
  const bound = async (side: unknown, kind: "opens" | "closes"): Promise<string | null> => {
    if (!isRecord(side) || typeof side.ref !== "string" || typeof side.collection !== "string" || typeof side.field !== "string") return null;
    const id = record[side.ref];
    if (typeof id !== "string") return null;
    // BEST EFFORT, and that is the whole contract of this function. It runs because a write was
    // already refused, and the refusal is the answer being reported — if this read is refused too
    // (the same rules, a moment later, are entitled to say no to it), letting it throw would
    // replace a named failure the author can act on with a 500 the route turns into nothing.
    const doc = await handle.docs.get(itemsPath(aid, side.collection), id).catch(() => null);
    if (!isRecord(doc)) return null;
    const at = doc[side.field];
    if (typeof at !== "number") return null;
    // The same comparisons the rules make: opening is inclusive, closing is exclusive.
    if (kind === "opens" && now < at) return `the window for ${side.collection}/${id} opens at ${new Date(at).toISOString()}`;
    if (kind === "closes" && now >= at) return `the window for ${side.collection}/${id} closed at ${new Date(at).toISOString()}`;
    return null;
  };
  return (await bound(window.untilField, "closes")) ?? (await bound(window.fromField, "opens"));
}

/** The write itself. Single through the ordinary seam; paired through a batch, for the reason at
 *  the top of this file.
 *
 *  CREATE, NEVER OVERWRITE. A public submission is create-only, and for `idFrom: "field"` the id IS
 *  the thing being claimed — so an id that already exists means somebody has it. `set` would be an
 *  UPDATE, and the rules permit an owner to update an item (`allow update` on `items`): the author
 *  previewing their own app would silently replace a real visitor's booking with their test one. */
async function commit(handle: SharedAppHandle, aid: string, plan: PlannedWrite): Promise<string | null> {
  try {
    if (plan.mirror === undefined) {
      const made = await handle.docs.create(itemsPath(aid, plan.cid), plan.id, plan.record);
      return made ? null : "already-taken";
    }
    // The paired path cannot ask for create-only: the web SDK's `WriteBatch` has `set`, `update`
    // and `delete`, and no create. So the id is CHECKED first — a check, not a guarantee, and the
    // difference is a real race with anybody submitting at the same moment. What closes it is the
    // batch's own `update` on the mirror: a slot somebody else has just taken no longer satisfies
    // what the rules require of it, and the commit is refused rather than overwriting.
    const db = currentFirestore();
    const taken = await handle.docs.get(itemsPath(aid, plan.cid), plan.id);
    if (taken !== null) return "already-taken";
    const batch = writeBatch(db);
    batch.set(doc(collection(db, itemsPath(aid, plan.cid)), plan.id), plan.record);
    batch.update(doc(collection(db, itemsPath(aid, plan.mirror.cid)), plan.mirror.id), { state: plan.mirror.state });
    await batch.commit();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** WHAT THIS PROCESS WROTE, and nothing else.
 *
 *  Undo performs a delete through the AUTHOR's handle, which is authorized to delete anything in
 *  their own app. So the record it acts on must not be chooseable by whoever calls the route — a
 *  caller naming a cid and an id would be naming a stranger's real booking, and the write would
 *  succeed. The route therefore accepts a token this module minted at the moment it made the write,
 *  and looks the record up here.
 *
 *  The ROOT is part of the entry rather than trusted from the request, for the same reason: a token
 *  minted while previewing one app must not be usable to delete out of another.
 *
 *  A plain `Map`, deliberately. Its lifetime is the process's, which is the lifetime of the list on
 *  the author's screen — neither is stored, and a preview's writes become ordinary records once the
 *  session ends. Entries are removed when the undo succeeds, so a token is good for one delete. */
const undoable = new Map<string, { root: string; written: PreviewWrittenRecord }>();

/** Write one submission the author accepted in the preview.
 *
 *  `values` has already been judged by the parent in the browser against `createFields`; it is
 *  judged again here because that parent is reached over a port from a sandboxed frame, and a check
 *  made on the far side of an untrusted boundary is a courtesy, not a gate. */
export async function writePreviewSubmission(root: string, cid: string, values: Record<string, string>): Promise<PreviewWriteResult> {
  const context = await sharedAppContext(root);
  if (!context.ok) return { ok: false, reason: "host", error: context.problems.join(" ") };
  const { handle } = context;

  const preview = await previewSharedApp(root);
  if (!preview.ok) return { ok: false, reason: "host", error: preview.problems.join(" ") };

  const spec = specFor(preview.config, preview.form, cid);
  if (spec === null) return { ok: false, reason: "host", error: "unknown-collection" };
  // `needsAccount` is not asked. A handle exists only when the session has a VERIFIED address —
  // `setFirestoreAccessor` returns null otherwise (`sharedCollections.ts`) — so by the time
  // `sharedAppContext` has answered, the author is signed in. The check belongs to a host whose
  // reader may be anonymous, which is mulmoserver's public page and not this one.

  const fields = writableFields(spec.drawn, spec.submit);
  const missing = missingRequired(fields, values);
  if (missing.length > 0) return { ok: false, reason: "host", error: `missing: ${missing.join(" / ")}` };

  // `serverTimestamp` is what this host can offer where the rules require GOOGLE's clock. The
  // shared decision holds no Firestore, so the sentinel comes from the SDK this host resolved —
  // and it is handed over whether or not the app declares a `stampField`, because that is the
  // declaration's answer rather than this module's.
  const record = recordOf(fields, spec.drawn, spec.submit, values, { uid: handle.uid, email: handle.email }, serverTimestamp);

  // ASKED BEFORE THE ID IS BUILT, because both ways an absent id field went wrong were silent.
  // `idFrom: "field"` produced `""`, which is not a document id and fails at the SDK with a message
  // about paths that names no field; `idFrom: "auth.uid+field"` produced `"<uid>_"`, which IS a
  // valid id — one per person with the thing they were claiming missing, so a second claim lands on
  // the first one's document. `recordId` refuses both now; this asks first so the author is told
  // WHICH field, which is the only part of it they can act on.
  const noId = missingIdField(spec.submit, record);
  if (noId !== undefined) return { ok: false, reason: "host", error: `no-id: the submission has no value for "${noId}", which its id is built from` };
  const id = recordId(spec.submit, handle.uid, record, randomUUID());

  const plan = plannedWrite(cid, spec.submit, id, record);
  const failed = await commit(handle, preview.aid, plan);
  if (failed !== null) {
    const raw = preview.config.submit?.[cid];
    const why = isRecord(raw) ? await explainRefusal(handle, preview.aid, raw, record) : null;
    return { ok: false, reason: failed === "already-taken" ? "taken" : "rules", error: why === null ? failed : `${why} (${failed})` };
  }
  const written: PreviewWrittenRecord = {
    cid: plan.cid,
    id: plan.id,
    ...(plan.mirror === undefined ? {} : { mirror: { cid: plan.mirror.cid, id: plan.mirror.id } }),
    token: randomUUID(),
  };
  undoable.set(written.token, { root, written });
  return { ok: true, written };
}

/** Take one of those writes back.
 *
 *  Through the app's OWN withdrawal shape rather than a bare delete where a mirror is involved: the
 *  record goes and the slot it was holding returns to `open`, in one write, exactly as a
 *  participant's `selfDelete` does. A delete on its own would leave the mirror saying `taken` about
 *  a booking that no longer exists — the orphan this whole pairing exists to prevent. */
export async function undoPreviewSubmission(token: string): Promise<PreviewWriteResult> {
  // The token names the record AND the app it was written in. Nothing from the request reaches the
  // delete — that is the whole of the protection, and it is why this lookup comes first.
  const entry = undoable.get(token);
  if (entry === undefined) return { ok: false, reason: "host", error: "not-this-session" };
  const { root, written } = entry;

  const context = await sharedAppContext(root);
  if (!context.ok) return { ok: false, reason: "host", error: context.problems.join(" ") };
  const { handle, authored } = context;
  const aid = authored.aid;
  try {
    if (written.mirror === undefined) {
      await handle.docs.delete(itemsPath(aid, written.cid), written.id);
    } else {
      const db = currentFirestore();
      const batch = writeBatch(db);
      batch.delete(doc(collection(db, itemsPath(aid, written.cid)), written.id));
      batch.update(doc(collection(db, itemsPath(aid, written.mirror.cid)), written.mirror.id), { state: MIRROR_OPEN });
      await batch.commit();
    }
  } catch (err) {
    // KEPT on failure. The record is still there, so the author must still be able to try again —
    // and the list on screen is the only place it is known to be a test.
    return { ok: false, reason: "host", error: err instanceof Error ? err.message : String(err) };
  }
  // Spent. One token, one delete: a second use could only name a record this preview no longer
  // wrote, which is the thing the token exists to make impossible.
  undoable.delete(token);
  return { ok: true, written };
}
