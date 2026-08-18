// @vitest-environment node
//
// The shared-app operations, exercised end to end against an in-memory Firestore.
//
// What is pinned here is ORDER and OWNERSHIP, because those are what MulmoTerminal added and what
// nothing else checks. The projections are the publisher's and are tested there; the failure this
// file exists to catch is a write landing in the wrong sequence — `apps/{aid}.public` is what the
// deployed rules read to authorize anonymous access, so a publish that wrote it FIRST would leave
// anonymous access live against a half-published surface if the next write failed.
//
// There is no `deploy` any more, and no `apps/{aid}/staging`: an app EXISTS (init writes the app
// document and reserves the URL name) or it is PUBLISHED (publish writes everything else and opens
// it). The tests that pinned the two-stage promotion went with the code they described —
// `plans/feat-shared-app-no-staging.md` records which and why.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setFirestoreAccessor, setSharedCollectionsSupport, type FirestoreDocs, type FirestoreDoc } from "@mulmoclaude/core/collection/server";
import { initCollectionsBackend } from "../../../server/backends/collections.js";
import { publishSharedApp } from "../../../server/backends/sharedApp/publish.js";
import { unpublishSharedApp } from "../../../server/backends/sharedApp/unpublish.js";
import { makeTempDir } from "../../support/tempDir";

const AID = "app-under-test";
const OWNER = { uid: "uid-owner", email: "owner@example.com" };

/** An in-memory `FirestoreDocs` that REMEMBERS THE ORDER of writes. The order is the assertion in
 *  half this file, and a store that only kept final state would pass every one of these tests
 *  while the app opened before it had anything to show. */
class FakeDocs implements FirestoreDocs {
  readonly store = new Map<string, Map<string, Record<string, unknown>>>();
  readonly writes: string[] = [];
  /** Path/id whose next write throws — how a half-finished run is produced. */
  failAt: string | null = null;
  /** Model the rules' actual shape: a shared collection's records are authorized through
   *  `apps/{aid}`, so while that document is missing, reading them is denied rather than empty. */
  readsDeniedUntilApp = false;
  /** Collection path whose listing throws — a transient failure, as opposed to a refusal. */
  failListing: string | null = null;
  /** Refuse the app-document read even though it exists — somebody else's app. */
  readsDeniedForApp = false;
  /** The `code` a refused read carries. `failed-precondition` is a FAULT, not a refusal, and the
   *  caller has to tell them apart. */
  readErrorCode = "permission-denied";

  private bucket(collectionPath: string): Map<string, Record<string, unknown>> {
    const existing = this.store.get(collectionPath);
    if (existing) return existing;
    const created = new Map<string, Record<string, unknown>>();
    this.store.set(collectionPath, created);
    return created;
  }

  list = (collectionPath: string): Promise<FirestoreDoc[]> => {
    if (this.failListing === collectionPath) {
      return Promise.reject(new Error("unavailable (test)"));
    }
    // The rules again: a record listing is authorized through the app document, so while that is
    // missing the listing is REFUSED rather than empty.
    if (this.readsDeniedUntilApp && !this.app() && collectionPath.includes("/collections/")) {
      return Promise.reject(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
    }
    const docs = [...this.bucket(collectionPath)].sort(([left], [right]) => (left < right ? -1 : 1));
    return Promise.resolve(docs.map(([id, data]) => ({ id, data })));
  };

  get = (collectionPath: string, docId: string): Promise<unknown | null> => {
    // The rules' actual shape: `apps/{aid}`'s read resolves the roster out of the document, so a
    // document that does not exist makes the expression fail and the read is REFUSED — the same
    // answer as somebody else's app. A fake that answered `null` would let a first deploy pass a
    // test the real thing cannot pass.
    const existing = this.bucket(collectionPath).get(docId);
    if (collectionPath === "apps" && (!existing || this.readsDeniedForApp || this.readErrorCode !== "permission-denied")) {
      return Promise.reject(Object.assign(new Error("read refused (test)"), { code: this.readErrorCode }));
    }
    return Promise.resolve(existing ?? null);
  };

  set = (collectionPath: string, docId: string, data: Record<string, unknown>): Promise<void> => {
    const key = `${collectionPath}/${docId}`;
    if (this.failAt === key) return Promise.reject(new Error("permission-denied (test)"));
    // The one rule this fake models, because a caller DEPENDS on being refused: `appSlugs`'
    // update rule pins `aid`, so a write naming a different app is rejected. That refusal is how
    // the reservation code asks "is this name ours?" about a document it may not read.
    const existing = this.bucket(collectionPath).get(docId);
    if (collectionPath === "appSlugs" && existing && existing.aid !== data.aid) {
      // Rejected the way the SDK rejects: the `code` is what separates "the rules said no" from
      // "the question never got an answer", and the caller reads exactly that difference.
      return Promise.reject(Object.assign(new Error("appSlugs.aid is immutable (test)"), { code: "permission-denied" }));
    }
    this.writes.push(`set ${key}`);
    this.bucket(collectionPath).set(docId, structuredClone(data));
    return Promise.resolve();
  };

  create = (collectionPath: string, docId: string, data: Record<string, unknown>): Promise<boolean> => {
    // create-if-absent is a TRANSACTION, and it begins by reading the document. For the two
    // collections whose read rule resolves out of a document that does not exist yet
    // (`apps/{aid}`, `appSlugs/{slug}`), that read is refused — so `create` can never claim a
    // fresh id there, however atomic it looks. Modelled here because the code got it wrong once
    // and nothing in a fake that answered `false` would have said so.
    if (!this.bucket(collectionPath).has(docId) && (collectionPath === "apps" || collectionPath === "appSlugs")) {
      return Promise.reject(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
    }
    if (this.bucket(collectionPath).has(docId)) return Promise.resolve(false);
    this.writes.push(`create ${collectionPath}/${docId}`);
    this.bucket(collectionPath).set(docId, structuredClone(data));
    return Promise.resolve(true);
  };

  delete = (collectionPath: string, docId: string): Promise<boolean> => {
    this.writes.push(`delete ${collectionPath}/${docId}`);
    return Promise.resolve(this.bucket(collectionPath).delete(docId));
  };

  watch = (): (() => void) => () => {};

  app = (): Record<string, unknown> | undefined => this.store.get("apps")?.get(AID);
  doc = (collectionPath: string, docId: string): Record<string, unknown> | undefined => this.store.get(collectionPath)?.get(docId);
}

let docs = new FakeDocs();

const schemaFor = (slug: string) => ({
  title: slug,
  icon: "star",
  primaryKey: "id",
  // Exactly one of dataPath / dataSource / storage — a shared collection's records are in the
  // app, so it declares the backend and no local path at all.
  storage: { type: "firestore" },
  fields: { id: { type: "string", label: "ID", primary: true, required: true }, note: { type: "string", label: "Note" } },
});

function writeCollection(root: string, slug: string): void {
  mkdirSync(path.join(root, ".claude", "skills", slug), { recursive: true });
  writeFileSync(path.join(root, ".claude", "skills", slug, "schema.json"), JSON.stringify(schemaFor(slug)));
}

function writeApp(root: string, app: Record<string, unknown>): void {
  writeFileSync(path.join(root, "app.json"), JSON.stringify(app));
}

/** A declaration with the roster the rules require: the publisher as owner of everything. */
const declaration = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  aid: AID,
  name: "App Under Test",
  members: { [OWNER.email]: { "*": "owner" } },
  ...extra,
});

const stamp = { now: () => 1_700_000_000_000, resolveCommit: () => Promise.resolve({ commit: "c0ffee", dirty: false }) };

let root = "";

describe("shared app publish / unpublish", () => {
  beforeAll(() => {
    // ONE binding per file — `configureCollectionHost` refuses a second call with a different host.
    initCollectionsBackend({ workspace: makeTempDir("mt-shared-app-ws-") });
    setSharedCollectionsSupport(true);
    setFirestoreAccessor(() => ({ docs, email: OWNER.email, uid: OWNER.uid }));
  });

  beforeEach(() => {
    docs = new FakeDocs();
    root = makeTempDir("mt-shared-app-");
    writeApp(root, declaration());
    writeCollection(root, "bookings");
  });

  it("writes the schemas, the app document and the authorization — in that order", async () => {
    writeApp(root, declaration({ public: { enabled: true, read: ["bookings"] } }));

    const result = await publishSharedApp(root, stamp);
    expect(result.ok === false ? result.problems : []).toEqual([]);
    expect(result.ok === true && result.publicOpen).toBe(true);
    // The app document goes in FIRST here because this publish created it: the records are
    // authorized through it, so the migration gate cannot read them until it exists. Then the
    // data, and the authorization at the very end.
    //
    // The `delete` is unconditional and that is the point: `config/{docId}` is world-readable
    // forever, so a view withdrawn from the declaration and merely not rewritten stays fetchable.
    // An app that never had one pays one idempotent delete for the guarantee.
    expect(docs.writes).toEqual([
      `set apps/${AID}`,
      `set apps/${AID}/collections/bookings`,
      `set apps/${AID}/config/public`,
      `delete apps/${AID}/config/view`,
      `set apps/${AID}`,
    ]);
    expect(docs.doc(`apps/${AID}/collections`, "bookings")).toMatchObject({ publishedBy: OWNER.email, publishedCommit: "c0ffee" });
    expect(docs.app()?.public).toMatchObject({ enabled: true });
    expect(docs.app()?.memberEmails).toEqual([OWNER.email]);
  });

  it("writes nothing public when the declaration opens nothing", async () => {
    const result = await publishSharedApp(root, stamp);
    expect(result.ok === true && result.publicOpen).toBe(false);
    // `publicOn` reads THIS field, not the world-readable projection.
    expect(docs.app()).not.toHaveProperty("public");
    // The schema is written all the same: the roster reads it at `/m/{slug}`, which is what a
    // roster-only app is for.
    expect(docs.doc(`apps/${AID}/collections`, "bookings")).toBeDefined();
  });

  it("creates an app whose records cannot be read yet — the first publish of all", async () => {
    // The deadlock this pins: a shared collection's records are authorized THROUGH `apps/{aid}`,
    // so before that document exists the records cannot be read at all. The migration gate read
    // that as "the live records could not be read", which is the one refusal `confirm` may not
    // override — and a new app could never be created.
    docs.readsDeniedUntilApp = true;

    const result = await publishSharedApp(root, stamp);
    expect(result.ok === false ? result.problems : []).toEqual([]);
    expect(docs.app()).toBeDefined();
    expect(docs.doc(`apps/${AID}/collections`, "bookings")).toBeDefined();
  });

  it("runs the migration gate on records that survived their app document", async () => {
    // Firestore deletes do not cascade: `apps/{aid}` can be gone while the records under it
    // survive. A missing app document therefore proves only that the records cannot be READ right
    // now — not that they do not exist — and a publish that re-creates the app must still check
    // them, or it hands them to everybody under a schema nothing compared them against.
    docs.store.set(`apps/${AID}/collections/bookings/items`, new Map([["1", { id: "1" }]]));
    writeFileSync(
      path.join(root, ".claude", "skills", "bookings", "schema.json"),
      JSON.stringify({ ...schemaFor("bookings"), fields: { ...schemaFor("bookings").fields, note: { type: "string", label: "Note", required: true } } }),
    );

    const result = await publishSharedApp(root, stamp);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join("\n")).toContain("would not satisfy the schema");
    // The app document IS live — that is what made the records readable — and the result says so.
    expect(docs.app()).toBeDefined();
    expect(result.ok === false && result.partial).toBe(true);
    // Nothing else was written: the gate stopped before the schemas.
    expect(docs.store.get(`apps/${AID}/collections`)).toBeUndefined();
  });

  it("stops at live records that would not fit, and confirming writes them anyway", async () => {
    await publishSharedApp(root, stamp);
    docs.store.set(`apps/${AID}/collections/bookings/items`, new Map([["1", { id: "1" }]]));
    writeFileSync(
      path.join(root, ".claude", "skills", "bookings", "schema.json"),
      JSON.stringify({ ...schemaFor("bookings"), fields: { ...schemaFor("bookings").fields, note: { type: "string", label: "Note", required: true } } }),
    );

    const refused = await publishSharedApp(root, stamp);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.problems.join("\n")).toContain("would not satisfy the schema");

    const confirmed = await publishSharedApp(root, { ...stamp, confirm: true });
    expect(confirmed.ok === true && confirmed.recordIssues).toBe(1);
  });

  it("does not mistake a fault for an absent app and rebuild it", async () => {
    // `failed-precondition` is not the rules saying no — it is a missing index, a stale
    // transaction, a client the backend wants restarted. Read as a refusal, the app document looks
    // ABSENT: the publish would rebuild it from the declaration alone, dropping the held slug and
    // stranding the URL name.
    writeApp(root, declaration({ slug: "sakura-hair", public: { enabled: true, read: ["bookings"] } }));
    const first = await publishSharedApp(root, stamp);
    expect(first.ok === false ? first.problems : []).toEqual([]);
    docs.readErrorCode = "failed-precondition";

    const result = await publishSharedApp(root, stamp);
    expect(result.ok).toBe(false);
    // The app is untouched: still public, still holding its name.
    expect(docs.app()?.public).toMatchObject({ enabled: true });
    expect(docs.app()?.slug).toBe("sakura-hair");
  });

  it("says whose app it is when the id is taken and unreadable", async () => {
    // The two are indistinguishable by reading — both are refusals — so the write is what settles
    // it, and the message has to name the situation rather than repeat "insufficient permissions".
    docs.store.set("apps", new Map([[AID, { aid: AID, owner: "somebody-else" }]]));
    docs.readsDeniedForApp = true;
    // The rules refuse the WRITE too — an update needs this session to be the app's owner — and
    // that refusal is the only signal available, because the document cannot be read.
    docs.failAt = `apps/${AID}`;

    const result = await publishSharedApp(root, stamp);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join("\n")).toContain("belongs to somebody else's roster");
    expect(docs.store.get(`apps/${AID}/collections`)).toBeUndefined();
  });

  it("publishes the working tree, as it stands", async () => {
    // It used to publish what a previous deploy had STAGED, so an edit after that deploy stayed
    // unpublished until the next one. `preview` is what stands between the tree and everybody now.
    await publishSharedApp(root, stamp);
    writeFileSync(path.join(root, ".claude", "skills", "bookings", "schema.json"), JSON.stringify({ ...schemaFor("bookings"), title: "Edited" }));

    await publishSharedApp(root, stamp);
    const published = docs.doc(`apps/${AID}/collections`, "bookings");
    expect((published?.publishedSchema as { title: string }).title).toBe("Edited");
  });

  it("leaves the app PRIVATE when a publish fails part-way", async () => {
    writeApp(root, declaration({ public: { enabled: true, read: ["bookings"] } }));
    docs.failAt = `apps/${AID}/config/public`;

    const result = await publishSharedApp(root, stamp);
    expect(result.ok).toBe(false);
    // The whole point of the ordering: documents ARE live, and none of them grants anything.
    expect(result.ok === false && result.partial).toBe(true);
    expect(docs.app()).not.toHaveProperty("public");
    expect(result.ok === false && result.problems.join("\n")).toContain("Written by this publish, and live now");
    // And the two repairs that cannot be taken back are named, because a half-written app is
    // exactly the state they are reached for.
    const said = result.ok === false ? result.problems.join("\n") : "";
    expect(said).toContain(`Do not delete apps/${AID}`);
    expect(said).toContain("The records are not gone with it");
  });

  it("refuses to publish a declaration whose aid was removed, rather than minting a second app", async () => {
    // The recovery an agent reaches for — "it is stuck, clear the aid and publish again" — used to
    // work: `ensureAid` minted one, and the app holding everybody's records was left behind with
    // nothing pointing at it. Publish's question is not "is there an id?" but "is this the app?".
    const noAid = declaration();
    delete noAid.aid;
    writeApp(root, noAid);

    const result = await publishSharedApp(root, stamp);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.partial).toBe(false);
    expect(result.ok === false && result.problems.join("\n")).toContain("publish will not generate one");
    // Nothing was written, and app.json was not "helpfully" completed either.
    expect(docs.writes).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8"))).not.toHaveProperty("aid");
  });

  it("keeps a live app open when it is published again", async () => {
    writeApp(root, declaration({ public: { enabled: true, read: ["bookings"] } }));
    await publishSharedApp(root, stamp);
    expect(docs.app()?.public).toMatchObject({ enabled: true });

    await publishSharedApp(root, stamp);
    expect(docs.app()?.public).toMatchObject({ enabled: true });
  });

  it("publishes the form the public page draws from", async () => {
    // The page cannot read the schema, so the config document — the only one a visitor may read —
    // carries the labels and the choices. Without it the form is a row of unlabelled boxes.
    writeApp(
      root,
      declaration({
        collections: { bookings: { submitOnly: true } },
        public: { enabled: true, read: [], submit: { bookings: { auth: "verifiedEmail", emailField: "note", createFields: ["note"] } } },
      }),
    );
    await publishSharedApp(root, stamp);

    expect(docs.doc(`apps/${AID}/config`, "public")?.form).toEqual({ bookings: { fields: { note: { label: "Note", type: "string" } } } });
  });

  it("closes the app by removing the authorization first, and keeps the schemas", async () => {
    writeApp(root, declaration({ public: { enabled: true, read: ["bookings"] } }));
    await publishSharedApp(root, stamp);
    docs.writes.length = 0;

    const result = await unpublishSharedApp(root);
    expect(result.ok === true && result.wasOpen).toBe(true);
    // The page comes down with the settings, for the reason the publish above deletes it.
    expect(docs.writes).toEqual([`set apps/${AID}`, `delete apps/${AID}/config/public`, `delete apps/${AID}/config/view`]);
    expect(docs.app()).not.toHaveProperty("public");
    // The roster goes on using the app while it is closed, so its schemas stay.
    expect(docs.doc(`apps/${AID}/collections`, "bookings")).toBeDefined();
  });

  it("closes an app whose declaration stopped opening it", async () => {
    // Taking `public` out of app.json and publishing is how an author closes an app without
    // reaching for `unpublish`, and it has to mean the same thing. The world-readable documents
    // are the half that is easy to miss: `config/{docId}` is `allow read: if true` forever, so
    // dropping the authorization while leaving them would keep the previous public page and its
    // form fetchable by anybody who kept the path.
    mkdirSync(path.join(root, "views"), { recursive: true });
    writeFileSync(path.join(root, "views", "form.html"), "<p>book here</p>");
    const open = { enabled: true, read: ["bookings"], view: { path: "views/form.html", collections: ["bookings"] } };
    writeApp(root, declaration({ slug: "sakura-hair", public: open }));
    await publishSharedApp(root, stamp);
    expect(docs.doc(`apps/${AID}/config`, "public")).toBeDefined();
    expect(docs.doc(`apps/${AID}/config`, "view")).toBeDefined();

    writeApp(root, declaration({ slug: "sakura-hair" }));
    const closed = await publishSharedApp(root, stamp);
    expect(closed.ok === false ? closed.problems : []).toEqual([]);
    expect(closed.ok === true && closed.publicOpen).toBe(false);
    expect(docs.app()).not.toHaveProperty("public");
    expect(docs.doc(`apps/${AID}/config`, "public")).toBeUndefined();
    expect(docs.doc(`apps/${AID}/config`, "view")).toBeUndefined();
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: AID, published: false });
    // The roster's half is untouched: the app goes on being the app, for the people on it.
    expect(docs.doc(`apps/${AID}/collections`, "bookings")).toBeDefined();
  });

  it("says so rather than reporting success when there was nothing open to close", async () => {
    await publishSharedApp(root, stamp);
    const result = await unpublishSharedApp(root);
    expect(result.ok === true && result.wasOpen).toBe(false);
  });

  // --- the URL name ----------------------------------------------------------
  //
  // `init` reserves it, which is what makes `/m/{slug}` work from the moment an app exists. Publish
  // takes one only when the app gained a `slug` afterwards (or when init could not finish), and
  // otherwise just flips the reservation to resolvable.

  it("reserves a name the declaration gained after the app was created", async () => {
    writeApp(root, declaration({ slug: "sakura-hair" }));
    const result = await publishSharedApp(root, stamp);
    expect(result.ok === true && result.slug).toBe("sakura-hair");
    // `published: false` — a roster-only app holds a name nobody outside it can resolve.
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: AID, published: false });
    // On the app document, because appSlugs is unreadable to a stranger: this is the only place
    // "which name do we hold?" can be asked from.
    expect(docs.app()?.slug).toBe("sakura-hair");
  });

  it("does not reserve a SECOND name when the same app is published again", async () => {
    writeApp(root, declaration({ slug: "sakura-hair" }));
    await publishSharedApp(root, stamp);
    docs.writes.length = 0;

    const again = await publishSharedApp(root, stamp);
    expect(again.ok === true && again.slug).toBe("sakura-hair");
    // A URL is a thing people have already sent to each other (D2b). Re-reserving would hand the
    // app `sakura-hair-2` every time, and the reservation cannot be read back to notice. The
    // existing one is written again — that is the `published` flag following the app's openness —
    // and no second name is taken.
    expect(docs.doc("appSlugs", "sakura-hair-2")).toBeUndefined();
    expect(docs.writes.filter((write) => write.includes("appSlugs"))).toEqual(["set appSlugs/sakura-hair"]);
    expect(docs.app()?.slug).toBe("sakura-hair");
  });

  it("takes the next numbering when the wanted name is held by someone else", async () => {
    docs.store.set("appSlugs", new Map([["sakura-hair", { aid: "someone-else", published: true }]]));
    writeApp(root, declaration({ slug: "sakura-hair" }));

    const result = await publishSharedApp(root, stamp);
    expect(result.ok === true && result.slug).toBe("sakura-hair-2");
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: "someone-else", published: true });
    // Written BACK to app.json — the reservation cannot be read back, so a run that did not find
    // it there would reserve yet another name and leave this one held by nobody.
    expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")).slug).toBe("sakura-hair-2");
  });

  it("makes the name resolve at publish and stop at unpublish, in that order", async () => {
    writeApp(root, declaration({ slug: "sakura-hair", public: { enabled: true, read: ["bookings"] } }));
    await publishSharedApp(root, stamp);
    // Re-published, so the reservation already exists and only the flag moves.
    docs.writes.length = 0;

    const published = await publishSharedApp(root, stamp);
    expect(published.ok === true && published.slug).toBe("sakura-hair");
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: AID, published: true });
    // After everything the name points at, before the authorization: a slug that resolved first
    // would be a link that 404s inside.
    expect(docs.writes).toEqual([
      `set apps/${AID}/collections/bookings`,
      `set apps/${AID}/config/public`,
      `delete apps/${AID}/config/view`,
      `set apps/${AID}`,
      "set appSlugs/sakura-hair",
      `set apps/${AID}`,
    ]);

    docs.writes.length = 0;
    await unpublishSharedApp(root);
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: AID, published: false });
    // Reversed: what grants is taken away first.
    expect(docs.writes).toEqual([`set apps/${AID}`, "set appSlugs/sakura-hair", `delete apps/${AID}/config/public`, `delete apps/${AID}/config/view`]);
  });

  it("does not make the name resolve when the app is not open to anonymous visitors", async () => {
    // A published reservation is world-readable, and what it reveals is the aid, which addresses
    // everything under `apps/{aid}`. Publishing a roster-only declaration is a normal thing to do,
    // and it must not hand that out while the same operation reports the app is closed.
    writeApp(root, declaration({ slug: "sakura-hair" }));
    const result = await publishSharedApp(root, stamp);
    expect(result.ok === true && result.publicOpen).toBe(false);
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: AID, published: false });
  });

  it("reclaims its own reservation rather than taking a numbered one", async () => {
    // The record on the app document can be lost — a run that reserved and then failed to record
    // it, a document restored from before. `create` then fails for a name this app already holds,
    // and taking `-2` would strand the first reservation: live, held by an app that no longer
    // claims it, and unreadable by anyone who might notice.
    writeApp(root, declaration({ slug: "sakura-hair" }));
    await publishSharedApp(root, stamp);
    const app = docs.app();
    if (app) delete app.slug;

    const again = await publishSharedApp(root, stamp);
    expect(again.ok === true && again.slug).toBe("sakura-hair");
    expect(docs.doc("appSlugs", "sakura-hair-2")).toBeUndefined();
    expect(docs.app()?.slug).toBe("sakura-hair");
  });

  it("stops rather than taking a numbered name when the ownership probe cannot be answered", async () => {
    // An outage is not "somebody else's". Reading it that way turns a timeout into a second
    // reservation — and if the name being reclaimed was public, the app records the numbered one
    // while the original keeps resolving, beyond the reach of unpublish.
    writeApp(root, declaration({ slug: "sakura-hair" }));
    await publishSharedApp(root, stamp);
    const app = docs.app();
    if (app) delete app.slug;
    docs.failAt = "appSlugs/sakura-hair";

    const result = await publishSharedApp(root, stamp);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("says nothing about WHY");
    expect(docs.doc("appSlugs", "sakura-hair-2")).toBeUndefined();
  });

  it("does not tell a name-only refusal that its writes are live", async () => {
    // `partial` from the reservation means "the app is written, this is only its public name" —
    // and on this path nothing was written at all. The half-published advice (publish again, it
    // re-does every step) would contradict the line above it, which correctly says to take a
    // different name, and would claim writes that never happened.
    writeApp(root, declaration({ slug: "sakura-hair" }));
    await publishSharedApp(root, stamp);
    const app = docs.app();
    if (app) delete app.slug;
    // Every candidate belongs to somebody else: the app's own reclaim is refused too.
    for (const name of ["sakura-hair", ...Array.from({ length: 7 }, (_, index) => `sakura-hair-${index + 2}`)]) {
      docs.store.get("appSlugs")?.set(name, { aid: "somebody-else", published: false });
    }
    const before = docs.writes.length;

    const result = await publishSharedApp(root, stamp);
    expect(result.ok).toBe(false);
    const said = result.ok === false ? result.problems.join("\n") : "";
    expect(said).toContain("every candidate for the URL name is taken");
    expect(said).not.toContain("writes already landed");
    expect(docs.writes).toHaveLength(before);
  });

  it("never leaves a resolving name the app document does not know about", async () => {
    // The rename that fails between the reservation and the record. The new name is reserved
    // UNPUBLISHED whatever the app's state, so this window is a name that opens nothing — not a
    // world-resolvable name for an app whose document still says the old one, which no later
    // `unpublish` could close, because unpublish acts on the name the document says.
    writeApp(root, declaration({ slug: "sakura-hair", public: { enabled: true, read: ["bookings"] } }));
    await publishSharedApp(root, stamp);
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: AID, published: true });

    writeApp(root, declaration({ slug: "sakura-salon", public: { enabled: true, read: ["bookings"] } }));
    // The write that records the new name on the app document is the one that fails.
    docs.failAt = `apps/${AID}`;
    const failed = await publishSharedApp(root, stamp);
    expect(failed.ok).toBe(false);
    expect(docs.doc("appSlugs", "sakura-salon")).toEqual({ aid: AID, published: false });
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: AID, published: false });

    // And publishing again repairs it: the reservation is reclaimed, recorded, and flipped.
    docs.failAt = null;
    const repaired = await publishSharedApp(root, stamp);
    expect(repaired.ok === false ? repaired.problems : []).toEqual([]);
    expect(repaired.ok === true && repaired.slug).toBe("sakura-salon");
    expect(docs.doc("appSlugs", "sakura-salon")).toEqual({ aid: AID, published: true });
    expect(docs.app()?.slug).toBe("sakura-salon");
  });

  it("stops the previous name from resolving when the app is renamed", async () => {
    writeApp(root, declaration({ slug: "sakura-hair", public: { enabled: true, read: ["bookings"] } }));
    await publishSharedApp(root, stamp);
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: AID, published: true });

    // The author renames the app's URL.
    writeApp(root, declaration({ slug: "sakura-salon", public: { enabled: true, read: ["bookings"] } }));
    const renamed = await publishSharedApp(root, stamp);
    expect(renamed.ok === true && renamed.slug).toBe("sakura-salon");

    // The old one keeps pointing here — it is never deleted, because a freed name is one somebody
    // else can claim and then serve from a URL already in circulation — but it stops resolving.
    // Otherwise every later unpublish would act on the new name while the old URL still opened
    // the app.
    expect(docs.doc("appSlugs", "sakura-hair")).toEqual({ aid: AID, published: false });
    expect(docs.app()?.slug).toBe("sakura-salon");
  });

  it("keeps a renamed app OPEN while it is being published", async () => {
    // The reservation write REPLACES the app document, and the document publish projects carries
    // no `public` — it is held back for the last write. So a rename that wrote the projection
    // alone would close the app at the START of the run: a failure anywhere after that leaves it
    // dark, which is the opposite of the trade this ordering makes (open on a mixed version).
    writeApp(root, declaration({ slug: "sakura-hair", public: { enabled: true, read: ["bookings"] } }));
    await publishSharedApp(root, stamp);
    expect(docs.app()?.public).toMatchObject({ enabled: true });

    writeApp(root, declaration({ slug: "sakura-salon", public: { enabled: true, read: ["bookings"] } }));
    // The run dies after the reservation, on the first document it would write.
    docs.failAt = `apps/${AID}/collections/bookings`;
    const result = await publishSharedApp(root, stamp);
    expect(result.ok).toBe(false);
    // Still open, on the version that was live before this run.
    expect(docs.app()?.public).toMatchObject({ enabled: true });
    // And the name it took is recorded, so the next run reclaims it rather than numbering.
    expect(docs.app()?.slug).toBe("sakura-salon");
  });

  it("writes the whole app document when the publish created it", async () => {
    // `publishSteps` SKIPS the app-document write when this run established it, because `claimApp`
    // (and the reservation after it) wrote exactly the same projection. That is only true while
    // the two agree — this pins the result rather than the reasoning.
    writeApp(root, declaration({ slug: "sakura-hair", public: { enabled: true, read: ["bookings"] } }));
    const result = await publishSharedApp(root, stamp);
    expect(result.ok === false ? result.problems : []).toEqual([]);
    expect(docs.app()).toMatchObject({
      aid: AID,
      name: "App Under Test",
      owner: OWNER.uid,
      slug: "sakura-hair",
      memberEmails: [OWNER.email],
      publishedBy: OWNER.email,
      public: { enabled: true, read: ["bookings"] },
    });
  });

  // --- the app's own pages, per audience -------------------------------------

  /** A declaration with a page for the front desk and one for a participant.
   *
   *  `participantRead` is what makes the second one publishable at all: without it the participant
   *  reaches nothing in `bookings`, and the gate refuses the page rather than publishing one the
   *  rules would deny. */
  const withPages = (extra: Record<string, unknown> = {}) => {
    mkdirSync(path.join(root, "views"), { recursive: true });
    writeFileSync(path.join(root, "views", "desk.html"), "<p>front desk</p>");
    writeFileSync(path.join(root, "views", "mine.html"), "<p>your booking</p>");
    writeApp(
      root,
      declaration({
        participantRead: ["bookings"],
        views: [
          { id: "desk", audience: "member", path: "views/desk.html", collections: ["bookings"] },
          { id: "mine", audience: "participant", path: "views/mine.html", collections: ["bookings"] },
        ],
        ...extra,
      }),
    );
  };

  it("writes a page to the tier its audience can read, and nowhere else", async () => {
    withPages();
    const result = await publishSharedApp(root, stamp);
    expect(result.ok === false ? result.problems : []).toEqual([]);
    expect(result.ok && result.memberPages).toEqual(["desk"]);
    expect(result.ok && result.participantPages).toEqual(["mine"]);

    // The staff page is in the tier only a role-holder reads; the participant's is in the one the
    // whole roster reads. Splitting the PROJECTION alone would not do this — the HTML itself
    // carries the app's vocabulary.
    expect(docs.doc(`apps/${AID}/member`, "live:desk")).toMatchObject({ html: "<p>front desk</p>" });
    expect(docs.doc(`apps/${AID}/roster`, "live:mine")).toMatchObject({ html: "<p>your booking</p>" });
    expect(docs.doc(`apps/${AID}/member`, "live:mine")).toBeUndefined();
    expect(docs.doc(`apps/${AID}/roster`, "live:desk")).toBeUndefined();
  });

  it("tells each audience how to read its own data, and only its own", async () => {
    withPages();
    await publishSharedApp(root, stamp);

    // A member reads the collection whole; every read a role opens is unscoped.
    expect(docs.doc(`apps/${AID}/member`, "live:config")).toMatchObject({
      views: [{ id: "desk", collections: [{ cid: "bookings", scope: "all" }] }],
    });
    // A participant reads it whole too HERE, because `participantRead` says so — and the page is
    // told which, since an unscoped list on an own-row collection is denied rather than narrowed.
    expect(docs.doc(`apps/${AID}/roster`, "live:config")).toMatchObject({
      views: [{ id: "mine", collections: [{ cid: "bookings", scope: "all" }] }],
    });
    // The roster itself is in neither: this document is read by every participant, and the
    // addresses on it are their classmates'.
    expect(docs.doc(`apps/${AID}/roster`, "live:config")).not.toHaveProperty("members");
  });

  it("withdraws the page the declaration dropped", async () => {
    withPages();
    await publishSharedApp(root, stamp);
    expect(docs.doc(`apps/${AID}/member`, "live:desk")).toBeDefined();

    // The author withdraws the staff page. Merely not writing it again is not enough: the tier is
    // readable by everyone it admits, forever.
    writeApp(
      root,
      declaration({ participantRead: ["bookings"], views: [{ id: "mine", audience: "participant", path: "views/mine.html", collections: ["bookings"] }] }),
    );
    const again = await publishSharedApp(root, stamp);
    expect(again.ok === false ? again.problems : []).toEqual([]);
    expect(docs.doc(`apps/${AID}/member`, "live:desk")).toBeUndefined();
    expect(docs.doc(`apps/${AID}/roster`, "live:mine")).toBeDefined();
  });

  it("stamps the projection and every page with the SAME publish", async () => {
    // They are separate documents, and the runtime refuses to draw a pair that disagrees — a view
    // handed fields it has never seen.
    withPages();
    await publishSharedApp(root, stamp);
    const config = docs.doc(`apps/${AID}/member`, "live:config");
    const page = docs.doc(`apps/${AID}/member`, "live:desk");
    expect(config?.publishedAt).toBe(1_700_000_000_000);
    expect(page?.publishedAt).toBe(config?.publishedAt);
  });

  it("writes the pages before the settings that name them", async () => {
    // The order decides what a half-finished run leaves: a page nobody has been told about
    // (invisible, harmless) rather than a name pointing at a page that is not there.
    withPages();
    await publishSharedApp(root, stamp);
    const wrote = docs.writes.filter((line) => line.includes(`apps/${AID}/member/live:`));
    // Both present FIRST: two missing writes are both -1, and -1 < -1 is false, but one missing
    // write reads as an order that holds.
    expect(wrote).toContain(`set apps/${AID}/member/live:desk`);
    expect(wrote).toContain(`set apps/${AID}/member/live:config`);
    expect(wrote.indexOf(`set apps/${AID}/member/live:desk`)).toBeLessThan(wrote.indexOf(`set apps/${AID}/member/live:config`));
  });

  it("withdraws the settings last, so a stopped run never leaves a name with nothing behind it", async () => {
    withPages();
    await publishSharedApp(root, stamp);
    // Every page dropped: the whole tier is withdrawn.
    writeApp(root, declaration({ participantRead: ["bookings"] }));
    docs.writes.length = 0;
    await publishSharedApp(root, stamp);
    const removed = docs.writes.filter((line) => line.startsWith(`delete apps/${AID}/member/live:`));
    expect(removed).toContain(`delete apps/${AID}/member/live:desk`);
    expect(removed).toContain(`delete apps/${AID}/member/live:config`);
    expect(removed.indexOf(`delete apps/${AID}/member/live:desk`)).toBeLessThan(removed.indexOf(`delete apps/${AID}/member/live:config`));
  });

  it("leaves the roster's pages standing on unpublish", async () => {
    // These used to come down here, when `live:` meant "published" and the roster went on working
    // from a `staged:` copy at `/staging/{aid}`. There is no such copy any more: these documents
    // ARE the roster's app, read at `/m/{slug}` and `/p/{slug}` and gated by `staffOf` / `listedIn`
    // — never by anything unpublish touches. Deleting them would take the front desk's page away
    // from the front desk because the owner closed the app to strangers.
    withPages({ public: { enabled: true, read: ["bookings"] } });
    await publishSharedApp(root, stamp);
    expect(docs.doc(`apps/${AID}/member`, "live:desk")).toBeDefined();

    const closed = await unpublishSharedApp(root);
    expect(closed.ok === false ? closed.problems : []).toEqual([]);
    expect(docs.doc(`apps/${AID}/member`, "live:desk")).toBeDefined();
    expect(docs.doc(`apps/${AID}/roster`, "live:mine")).toBeDefined();
    // What DOES come down is the public half, and only that.
    expect(docs.app()).not.toHaveProperty("public");
    expect(docs.doc(`apps/${AID}/config`, "public")).toBeUndefined();
  });

  it("refuses a page that cannot be read, before anything is written", async () => {
    mkdirSync(path.join(root, "views"), { recursive: true });
    writeApp(root, declaration({ views: [{ id: "desk", audience: "member", path: "views/missing.html", collections: ["bookings"] }] }));
    const result = await publishSharedApp(root, stamp);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("views[0].path");
    // The name of the key the author can go and edit — not `public.view`, which is not in this
    // file.
    expect(result.ok === false && result.problems.join(" ")).not.toContain("public.view.path");
    expect(docs.store.get(`apps/${AID}/collections`)).toBeUndefined();
  });

  it("refuses a participant page whose collection the rules will not open", async () => {
    mkdirSync(path.join(root, "views"), { recursive: true });
    writeFileSync(path.join(root, "views", "mine.html"), "<p>your booking</p>");
    writeApp(root, declaration({ views: [{ id: "mine", audience: "participant", path: "views/mine.html", collections: ["bookings"] }] }));
    const refused = await publishSharedApp(root, stamp);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.problems.join(" ")).toContain("a participant cannot read");

    // The neighbouring declaration: the same page, with the read it needs.
    writeApp(
      root,
      declaration({ participantRead: ["bookings"], views: [{ id: "mine", audience: "participant", path: "views/mine.html", collections: ["bookings"] }] }),
    );
    const published = await publishSharedApp(root, stamp);
    expect(published.ok === false ? published.problems : []).toEqual([]);
  });
});
