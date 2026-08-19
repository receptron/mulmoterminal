// @vitest-environment node
//
// The preview's STATE-CHANGING half: what a submission becomes in the database, and what taking it
// back restores.
//
// Pinned here because these are the only operations in the feature that alter anything, and each of
// them has a wrong version that looks identical from the pane:
//
//   the RECORD. The address is not the visitor's to type and the status is pinned to
//   `initialStatus`; a host that wrote what the page sent and nothing else builds a document the
//   rules refuse, and the refusal names nothing.
//
//   the ID. For `idFrom: "field"` it IS the thing being claimed. A random one would take nothing,
//   successfully, while the slot stayed free.
//
//   CREATE, never overwrite. `items` carries `allow update` and the author is the owner, so a `set`
//   on an id somebody already holds would silently replace a real visitor's booking with a test.
//
//   the MIRROR travels in the SAME write. The rules read it with `getAfter()`, so a pair written
//   singly is refused — and an undo that deleted the record alone would leave the slot saying
//   `taken` about a booking that no longer exists.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setFirestoreAccessor, setSharedCollectionsSupport, type FirestoreDocs, type FirestoreDoc } from "@mulmoclaude/core/collection/server";
import { initCollectionsBackend } from "../../../server/backends/collections.js";
import { undoPreviewSubmission, writePreviewSubmission } from "../../../server/backends/sharedApp/previewWrite.js";
import { makeTempDir } from "../../support/tempDir";

const AID = "app-under-write";
const OWNER = { uid: "uid-owner", email: "owner@example.com" };

/** Every operation a batch performed, in order. The ORDER and the PAIRING are the assertions — a
 *  store that only kept final state would pass a host that wrote the two documents separately, and
 *  that is precisely what the deployed rules refuse. */
const batched: string[] = [];
let batchFails = false;

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, collectionPath: string) => ({ collectionPath }),
  // The sentinel, standing in for the one the real SDK makes. It has to be RECOGNISABLE and it must
  // not be a value this host could have computed: what the rules compare is `request.time`, and a
  // clock read here would be the author's.
  serverTimestamp: () => ({ __serverTimestamp: true }),
  doc: (parent: { collectionPath: string }, docId: string) => ({ path: `${parent.collectionPath}/${docId}` }),
  writeBatch: () => {
    const ops: string[] = [];
    return {
      set: (ref: { path: string }, data: Record<string, unknown>) => ops.push(`set ${ref.path} ${JSON.stringify(data)}`),
      update: (ref: { path: string }, data: Record<string, unknown>) => ops.push(`update ${ref.path} ${JSON.stringify(data)}`),
      delete: (ref: { path: string }) => ops.push(`delete ${ref.path}`),
      commit: () => {
        if (batchFails) return Promise.reject(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
        // Recorded only on COMMIT: an uncommitted batch changed nothing, and a test that counted
        // the calls instead would pass on a host that built the pair and never sent it.
        batched.push(...ops);
        return Promise.resolve();
      },
    };
  },
}));

vi.mock("../../../server/backends/remoteHost/session.js", () => ({ currentFirestore: () => ({}) }));

class Docs implements FirestoreDocs {
  readonly store = new Map<string, Map<string, Record<string, unknown>>>();
  readonly writes: string[] = [];

  private read(collectionPath: string): Map<string, Record<string, unknown>> {
    return this.store.get(collectionPath) ?? new Map();
  }
  private bucket(collectionPath: string): Map<string, Record<string, unknown>> {
    const existing = this.store.get(collectionPath);
    if (existing) return existing;
    const created = new Map<string, Record<string, unknown>>();
    this.store.set(collectionPath, created);
    return created;
  }

  list = (collectionPath: string): Promise<FirestoreDoc[]> =>
    Promise.resolve([...this.read(collectionPath)].sort(([l], [r]) => (l < r ? -1 : 1)).map(([id, data]) => ({ id, data })));

  get = (collectionPath: string, docId: string): Promise<unknown | null> => {
    const existing = this.read(collectionPath).get(docId);
    // The rules' shape: a missing app document is REFUSED, not absent.
    if (collectionPath === "apps" && !existing) return Promise.reject(Object.assign(new Error("refused"), { code: "permission-denied" }));
    return Promise.resolve(existing ?? null);
  };

  create = (collectionPath: string, docId: string, data: Record<string, unknown>): Promise<boolean> => {
    this.writes.push(`create ${collectionPath}/${docId} ${JSON.stringify(data)}`);
    if (this.read(collectionPath).has(docId)) return Promise.resolve(false);
    this.bucket(collectionPath).set(docId, data);
    return Promise.resolve(true);
  };

  set = (collectionPath: string, docId: string, data: Record<string, unknown>): Promise<void> => {
    this.writes.push(`set ${collectionPath}/${docId}`);
    this.bucket(collectionPath).set(docId, data);
    return Promise.resolve();
  };

  delete = (collectionPath: string, docId: string): Promise<boolean> => {
    this.writes.push(`delete ${collectionPath}/${docId}`);
    return Promise.resolve(this.bucket(collectionPath).delete(docId));
  };

  watch = (): (() => void) => () => {};
}

let docs = new Docs();
let root = "";

const schemaFor = (slug: string, fields: Record<string, unknown>) => ({
  title: slug,
  icon: "star",
  primaryKey: "id",
  storage: { type: "firestore" },
  fields: { id: { type: "string", label: "ID", primary: true, required: true }, ...fields },
});

function writeCollection(slug: string, fields: Record<string, unknown>): void {
  mkdirSync(path.join(root, ".claude", "skills", slug), { recursive: true });
  writeFileSync(path.join(root, ".claude", "skills", slug, "schema.json"), JSON.stringify(schemaFor(slug, fields)));
}

function writeApp(app: Record<string, unknown>): void {
  writeFileSync(path.join(root, "app.json"), JSON.stringify(app));
}

/** A booking app shaped like the real one: the id is the slot, the address is stamped, the status is
 *  pinned, and a mirror travels with the write. */
const bookingApp = (over: Record<string, unknown> = {}) => ({
  aid: AID,
  name: "Rooms",
  members: { [OWNER.email]: { "*": "owner" } },
  collections: { bookings: { submitOnly: true, statusField: "status", transitions: { initial: ["booked"] } }, slots: { mirrorOf: "bookings" } },
  public: {
    enabled: true,
    read: ["slots"],
    submit: {
      bookings: {
        auth: "verifiedEmail",
        emailField: "requesterEmail",
        createFields: ["requesterName", "requesterEmail", "slot", "status"],
        initialStatus: "booked",
        idFrom: "field",
        idField: "slot",
        idIn: { collection: "slots", where: { field: "state", equals: "open" } },
        mirror: "slots",
        ...(over.submit ?? {}),
      },
    },
  },
});

describe("shared app preview writes", () => {
  beforeAll(() => {
    initCollectionsBackend({ workspace: makeTempDir("mt-write-ws-") });
    setSharedCollectionsSupport(true);
    setFirestoreAccessor(() => ({ docs, email: OWNER.email, uid: OWNER.uid }));
  });

  beforeEach(() => {
    docs = new Docs();
    batched.length = 0;
    batchFails = false;
    root = makeTempDir("mt-write-");
    writeCollection("bookings", {
      requesterName: { type: "string", label: "Name", required: true },
      requesterEmail: { type: "email", label: "Email", required: true },
      slot: { type: "string", label: "Slot", required: true },
      status: { type: "enum", label: "Status", values: ["booked"] },
    });
    writeCollection("slots", { state: { type: "enum", label: "State", values: ["open", "taken"], required: true } });
    writeApp(bookingApp());
    docs.store.set("apps", new Map([[AID, { owner: OWNER.uid, members: { [OWNER.email]: { "*": "owner" } }, memberEmails: [OWNER.email] }]]));
    docs.store.set(`apps/${AID}/collections/slots/items`, new Map([["roomA-1000", { state: "open" }]]));
  });

  it("writes the record the DECLARATION describes, not the one the page sent", async () => {
    const result = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000" });

    expect(result.ok === false ? result.error : "").toBe("");
    const written = batched.find((op) => op.startsWith("set apps/"));
    const record = JSON.parse(written?.slice(written.indexOf("{")) ?? "{}") as Record<string, unknown>;
    // The address comes from the ACCOUNT — the rules compare it to the token, so a page that sent
    // one could only get it wrong — and the status from `initialStatus`, in the field the
    // collection names.
    expect(record).toEqual({ requesterName: "客", slot: "roomA-1000", requesterEmail: OWNER.email, status: "booked" });
  });

  it("carries the server-stamped field, so a first-come app's create is not refused", async () => {
    // The one that was written by nobody. `stampField` parsed, passed publish's checks and reached
    // `config/public` — and no host put the key in the record, so `stampOk` refused every create a
    // first-come app took and answered "Missing or insufficient permissions" about no field at all.
    //
    // The VALUE cannot be asserted and must not be: it is the SDK's sentinel, and the whole point
    // is that this machine does not decide what it becomes. What is asserted is that the key is
    // there, because presence is what the rule tests.
    writeCollection("bookings", {
      requesterName: { type: "string", label: "Name", required: true },
      requesterEmail: { type: "email", label: "Email", required: true },
      slot: { type: "string", label: "Slot", required: true },
      status: { type: "enum", label: "Status", values: ["booked"] },
      createdAt: { type: "datetime", label: "Queued at" },
    });
    writeApp(
      bookingApp({
        submit: {
          createFields: ["requesterName", "requesterEmail", "slot", "status", "createdAt"],
          stampField: "createdAt",
        },
      }),
    );

    // A VALUE IS SENT FOR IT, and it must not survive. Publish keeps the stamped field out of the
    // drawn form, so nothing should be able to offer one — but the only value the rules accept is
    // the one they set themselves, so the host has to be the thing that guarantees it rather than
    // the projection two layers up.
    const result = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000", createdAt: "1999-01-01T00:00:00.000Z" });

    expect(result.ok === false ? result.error : "").toBe("");
    const written = batched.find((op) => op.startsWith("set apps/"));
    const record = JSON.parse(written?.slice(written.indexOf("{")) ?? "{}") as Record<string, unknown>;
    expect(record.createdAt).toEqual({ __serverTimestamp: true });
    // And it is not offered as a box to fill in: the visitor never chooses it.
    expect(record).toEqual({
      requesterName: "客",
      slot: "roomA-1000",
      requesterEmail: OWNER.email,
      status: "booked",
      createdAt: { __serverTimestamp: true },
    });
  });

  it("carries the submitter's uid, and not the one the page sent", async () => {
    // The other field the host fills in, and the one a page can most easily get wrong: a uid is
    // not typeable, so `uidOk` refuses every value except the session's own. A pane that relayed
    // what the frame sent would make the preview fail where production succeeds, or the reverse —
    // both of which make the preview evidence of nothing.
    writeCollection("bookings", {
      requesterName: { type: "string", label: "Name", required: true },
      requesterEmail: { type: "email", label: "Email", required: true },
      slot: { type: "string", label: "Slot", required: true },
      status: { type: "enum", label: "Status", values: ["booked"] },
      uid: { type: "string", label: "Who" },
    });
    // `protocol` is not decoration here: an app declaring uidField must state the floor its readers
    // need, and the preview runs the real gate — so a fixture without it is refused before the
    // write, exactly as the author's app would be.
    writeApp({
      ...bookingApp({
        submit: {
          uidField: "uid",
          createFields: ["requesterName", "requesterEmail", "slot", "status", "uid"],
        },
      }),
      protocol: "2.0.0",
    });

    const result = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000", uid: "somebody-else" });

    expect(result.ok === false ? result.error : "").toBe("");
    const written = batched.find((op) => op.startsWith("set apps/"));
    const record = JSON.parse(written?.slice(written.indexOf("{")) ?? "{}") as Record<string, unknown>;
    expect(record.uid).toBe(OWNER.uid);
  });

  it("makes the id the thing being claimed, and pairs the mirror in ONE batch", async () => {
    const result = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000" });

    expect(result.ok).toBe(true);
    // Both operations, committed together. The rules read the second with `getAfter()`, so a pair
    // written singly is refused — and a random id would have taken nothing while the slot stayed
    // free.
    expect(batched.map((op) => op.split(" ").slice(0, 2).join(" "))).toEqual([
      `set apps/${AID}/collections/bookings/items/roomA-1000`,
      `update apps/${AID}/collections/slots/items/roomA-1000`,
    ]);
    expect(batched[1]).toContain('"state":"taken"');
    expect(result.ok && result.written).toEqual({ cid: "bookings", id: "roomA-1000", mirror: { cid: "slots", id: "roomA-1000" }, token: expect.any(String) });
  });

  it("refuses an id somebody already holds rather than replacing their record", async () => {
    docs.store.set(`apps/${AID}/collections/bookings/items`, new Map([["roomA-1000", { requesterName: "先客" }]]));

    const result = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000" });

    // `items` carries `allow update` and the author is the owner, so an overwrite would SUCCEED and
    // silently replace a real visitor's booking with a test one.
    // `taken` rather than `rules`: under `idFrom: "auth.uid"` the record it collided with is the
    // AUTHOR's own, and a visitor has a different uid — so a caller reporting this as the deployed
    // rules refusing would be saying something false about everybody else.
    expect(result).toEqual({ ok: false, reason: "taken", error: "already-taken" });
    expect(batched).toEqual([]);
  });

  it("reports a refused batch instead of claiming the booking was made", async () => {
    batchFails = true;

    const result = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("insufficient permissions");
  });

  it("refuses to delete a record this session did not write", async () => {
    // The attack the token exists for. Undo runs through the AUTHOR's handle, which may delete
    // anything in their own app — so a caller naming a collection and an id would be naming a
    // stranger's real booking, and every write would be perfectly authorized.
    const forged = await undoPreviewSubmission("bookings/roomA-1000");

    expect(forged.ok).toBe(false);
    expect(forged.ok === false && forged.error).toBe("not-this-session");
    expect(batched).toEqual([]);
  });

  it("spends the token, so one write cannot be taken back twice", async () => {
    const made = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000" });
    const token = made.ok ? made.written.token : "";
    expect(await undoPreviewSubmission(token)).toEqual(expect.objectContaining({ ok: true }));
    batched.length = 0;

    // A second use could only name a record this preview no longer wrote — which, by then, is
    // whatever somebody else has put in its place.
    const again = await undoPreviewSubmission(token);

    expect(again.ok).toBe(false);
    expect(batched).toEqual([]);
  });

  it("names the missing answer instead of writing a record the rules would refuse", async () => {
    const result = await writePreviewSubmission(root, "bookings", { slot: "roomA-1000" });

    // `requesterName` is required. Refused here so the answer names the field — the rules would
    // refuse the same document a moment later, and name nothing.
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("missing:");
    expect(batched).toEqual([]);
  });

  it("names a whitespace-only answer as missing, rather than booking under a name of one space", async () => {
    const result = await writePreviewSubmission(root, "bookings", { requesterName: "   ", slot: "roomA-1000" });

    // A required answer of spaces is not an answer. Accepted, it becomes a booking whose name
    // nobody can read — and where such a field is the id, a document id made of a space.
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("missing:");
    expect(batched).toEqual([]);
    // What is refused is the JUDGEMENT, not the value: spaces INSIDE an answer are part of it.
    const kept = await writePreviewSubmission(root, "bookings", { requesterName: " 客 ", slot: "roomA-1000" });
    expect(kept.ok).toBe(true);
    expect(batched[0]).toContain('"requesterName":" 客 "');
  });

  it("refuses a claim whose id field carries nothing, instead of claiming an empty id", async () => {
    // The id field is OPTIONAL here on purpose: a required one is stopped by `missingRequired`
    // first, and the case being pinned is the one that got past every check. `idFrom: "field"`
    // built `""` — not a document id at all — and the failure surfaced from the SDK as a complaint
    // about a path, naming no field the author could fix.
    writeCollection("bookings", {
      requesterName: { type: "string", label: "Name", required: true },
      requesterEmail: { type: "email", label: "Email", required: true },
      slot: { type: "string", label: "Slot" },
      status: { type: "enum", label: "Status", values: ["booked"] },
    });

    const result = await writePreviewSubmission(root, "bookings", { requesterName: "客" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("host");
    expect(result.ok === false && result.error).toContain("no-id");
    // The field is NAMED. It is the only part of this an author can act on.
    expect(result.ok === false && result.error).toContain("slot");
    expect(batched).toEqual([]);
    expect(docs.writes).toEqual([]);

    // And a lone space is nothing too. `missingRequired` never sees this field — it is optional —
    // so a blank value used to travel all the way to a document named " ", which no page can show
    // and no author can find.
    const blank = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "   " });
    expect(blank.ok).toBe(false);
    expect(blank.ok === false && blank.error).toContain("no-id");
    expect(blank.ok === false && blank.error).toContain("slot");
    expect(batched).toEqual([]);
    // The WHOLE log, not the creates in it: a refusal that still managed a `set` or a `delete`
    // would be a different bug wearing this one's clothes.
    expect(docs.writes).toEqual([]);
  });

  it("refuses one-per-person-per-thing when the thing is missing, rather than colliding on one document", async () => {
    // The worse half of the same bug, because `"<uid>_"` IS a valid document id: every claim by one
    // person landed on it, so a second one looked like it took something while taking nothing.
    writeCollection("bookings", {
      requesterName: { type: "string", label: "Name", required: true },
      requesterEmail: { type: "email", label: "Email", required: true },
      slot: { type: "string", label: "Slot" },
      status: { type: "enum", label: "Status", values: ["booked"] },
    });
    // No `idIn` and no mirror: the rules read `idIn` only for `idFrom: "field"`, and a declared
    // `mirrorOf` needs its half back — both are refused by the gates before any of this is reached.
    const base = bookingApp({ submit: { idFrom: "auth.uid+field", idIn: undefined, mirror: undefined } });
    writeApp({
      ...base,
      collections: { bookings: { submitOnly: true, statusField: "status", transitions: { initial: ["booked"] } }, slots: {} },
    });

    const result = await writePreviewSubmission(root, "bookings", { requesterName: "客" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("no-id");
    expect(result.ok === false && result.error).toContain("slot");
    // Every write surface, not the creates among them. The refusal has to leave the database
    // exactly as it found it, and a stray `set` or `delete` is as wrong as a create.
    expect(docs.writes).toEqual([]);
    expect(batched).toEqual([]);
    // A blank one collides in exactly the same way — `"<uid>_ "` is one document per person — and
    // is refused for the same reason.
    const blank = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: " " });
    expect(blank.ok === false && blank.error).toContain("no-id");
    expect(blank.ok === false && blank.error).toContain("slot");
    expect(docs.writes).toEqual([]);
    expect(batched).toEqual([]);
    // And the id it DOES build from a value is unchanged — the acceptance half, since a refusal
    // this near the write is satisfied by refusing everything.
    const made = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000" });
    expect(made.ok && made.written.id).toBe(`${OWNER.uid}_roomA-1000`);
    expect(docs.writes).toEqual([
      `create apps/${AID}/collections/bookings/items/${OWNER.uid}_roomA-1000 {"requesterName":"客","slot":"roomA-1000","requesterEmail":"${OWNER.email}","status":"booked"}`,
    ]);
  });

  it("gives the slot back when the write is taken away", async () => {
    const made = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000" });
    expect(made.ok).toBe(true);
    batched.length = 0;

    const undone = await undoPreviewSubmission(made.ok ? made.written.token : "");

    expect(undone.ok).toBe(true);
    // The record goes and the slot reopens IN ONE WRITE, exactly as a participant's `selfDelete`
    // does. Deleting the record alone would leave the mirror saying `taken` about a booking that no
    // longer exists — the orphan the pairing exists to prevent.
    expect(batched.map((op) => op.split(" ").slice(0, 2).join(" "))).toEqual([
      `delete apps/${AID}/collections/bookings/items/roomA-1000`,
      `update apps/${AID}/collections/slots/items/roomA-1000`,
    ]);
    expect(batched[1]).toContain('"state":"open"');
  });

  it("writes a mirrorless submission through the ordinary seam, create-only", async () => {
    // A survey: one answer per person, no resource being claimed, so no mirror and no `idIn`.
    writeApp({
      aid: AID,
      name: "Survey",
      members: { [OWNER.email]: { "*": "owner" } },
      collections: { bookings: { submitOnly: true, statusField: "status", transitions: { initial: ["booked"] } } },
      public: {
        enabled: true,
        read: [],
        submit: {
          bookings: {
            auth: "verifiedEmail",
            emailField: "requesterEmail",
            createFields: ["requesterName", "requesterEmail", "slot", "status"],
            initialStatus: "booked",
            idFrom: "auth.uid",
          },
        },
      },
    });

    const result = await writePreviewSubmission(root, "bookings", { requesterName: "客", slot: "roomA-1000" });

    expect(result.ok === false ? result.error : "").toBe("");
    // No batch at all — and `create`, not `set`, so an id already taken is refused rather than
    // replaced. The id is the submitter's uid, which is what "one answer per person" means.
    expect(batched).toEqual([]);
    expect(docs.writes.some((write) => write.startsWith(`create apps/${AID}/collections/bookings/items/${OWNER.uid} `))).toBe(true);
    expect(result.ok && result.written).toEqual({ cid: "bookings", id: OWNER.uid, token: expect.any(String) });
  });
});
