// @vitest-environment node
//
// A `putItems` create into a collection declaring `public.submit.<cid>.stampField` is refused by
// the deployed rules WHATEVER it sends: `stampOk` wants the record to carry `request.time`, and a
// direct write can only send a literal. It sits in the top conjunction of `createWith`, so being
// the owner does not help — which is the point of the key, and the reason an app that seats agents
// reaches for it.
//
// What that costs without this guard is the error: Firestore answers "Missing or insufficient
// permissions", naming no field, no rule and no alternative. The shared-app skill has a whole
// section on that class of refusal being what makes an agent start editing `app.json`.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stampGuardProblem, withStampGuard } from "../../../server/infra/collectionToolStamp.js";
import { makeTempDir } from "../../support/tempDir";

const app = {
  aid: "app-test",
  members: { "owner@example.com": { "*": "owner" } },
  collections: { messages: { statusField: "status", transitions: { initial: ["posted"] } } },
  public: {
    enabled: true,
    read: ["messages"],
    submit: {
      messages: {
        auth: "anonymous",
        createFields: ["topicId", "body", "postedAt", "status"],
        stampField: "postedAt",
        initialStatus: "posted",
      },
    },
  },
};

let root = "";
const REACHED = "the engine ran";
const engine = async (): Promise<string> => REACHED;

beforeEach(() => {
  root = makeTempDir("mt-tool-stamp-");
  writeFileSync(path.join(root, "app.json"), JSON.stringify(app));
});

const guarded = () => withStampGuard(engine, () => root);
const put = (over: Record<string, unknown> = {}) => ({ action: "putItems", slug: "messages", ...over });

describe("the stamp guard", () => {
  it("refuses a create, because no value the caller could send would be accepted", async () => {
    const answer = await guarded()(put({ mode: "create", items: [{ id: "m1", body: "hi" }] }));
    expect(answer).not.toBe(REACHED);
    expect(answer).toContain("cannot succeed");
    // Names the field, the declaration and the way that works — the three things the permission
    // error does not carry.
    expect(answer).toContain("postedAt");
    expect(answer).toContain("public.submit.messages.stampField");
    expect(answer).toContain("useSharedApp");
  });

  it("lets an update CARRYING the stamped field through — the round trip core supports", async () => {
    // The first version of this guard refused these, and it was wrong. On an update the codec
    // (`encodeRecordTimes`) is handed the stored document, so a stamp that WAS an instant is
    // re-encoded into the identical Timestamp and `stampHeld` sees no change. Core's own comment
    // says that is what the provenance check is for: "the frozen stamp goes back unchanged, so a
    // whole-record write survives the rules". Refusing it broke `getItems` → edit → `putItems`.
    expect(await guarded()(put({ items: [{ id: "m1", postedAt: "2026-08-25T09:00:00.000000000Z", body: "言い直す" }] }))).toBe(REACHED);
  });

  it("lets an update that leaves the field alone through", async () => {
    // The other half of the same rule: `stampHeld` only asks that the value does not MOVE, so
    // correcting a body after posting is allowed and must stay allowed.
    expect(await guarded()(put({ items: [{ id: "m1", body: "言い直す" }] }))).toBe(REACHED);
  });

  it("leaves a collection with no stampField completely alone", async () => {
    expect(await guarded()(put({ slug: "topics", mode: "create", items: [{ id: "t1" }] }))).toBe(REACHED);
  });

  it("leaves every other action alone, including on the stamped collection", async () => {
    expect(await guarded()({ action: "getItems", slug: "messages" })).toBe(REACHED);
    expect(await guarded()({ action: "putSchema", slug: "messages", schema: {} })).toBe(REACHED);
  });

  it("says nothing about a repository that declares no app at all", async () => {
    // The ordinary case for a LOCAL collection. A guard that had an opinion here would be deciding
    // something about a folder that merely holds a stray file.
    const bare = withStampGuard(engine, () => makeTempDir("mt-tool-stamp-"));
    expect(await bare(put({ mode: "create", items: [{ id: "m1" }] }))).toBe(REACHED);
  });

  it("never reads the rows at all, so itemsFile costs nothing", async () => {
    // The decision is the MODE, so a batch of thousands is answered without opening the file — and
    // an upsert from one is passed through rather than guessed at.
    expect(await guarded()(put({ mode: "create", itemsFile: "/tmp/nope.json" }))).toContain("cannot succeed");
    expect(await guarded()(put({ itemsFile: "/tmp/nope.json" }))).toBe(REACHED);
  });
});

describe("stampGuardProblem", () => {
  it("defaults the mode to upsert, matching the engine", () => {
    // A call with no `mode` is an upsert, so a row that does not carry the field is fine.
    expect(stampGuardProblem({ items: [{ id: "m1" }] }, "postedAt", "messages")).toBeNull();
  });

  it("says nothing about an upsert, whatever the rows carry", () => {
    // The narrowing that matters: an upsert is core's to decide from the stored record, and this
    // guard has no business pre-empting it.
    expect(stampGuardProblem({ items: [{ postedAt: "x" }, { postedAt: "y" }] }, "postedAt", "messages")).toBeNull();
  });
});

describe("the guard is actually wired in", () => {
  // The tests above exercise the decorator directly, so all of them pass with the wrapper deleted
  // from `collection-tool.ts` — which is the half that decides whether any agent ever sees it.
  // Both handlers are pinned: the workspace one is the agent's data plane, and the per-root one is
  // what a custom view's dashboard reaches, and a doomed write is equally opaque from either.
  it("wraps BOTH manageCollection handlers", () => {
    const source = readFileSync(path.join(process.cwd(), "server/infra/collection-tool.ts"), "utf-8");
    expect(source).toContain("withStampGuard");
    expect(source.match(/withStampGuard\(/g)?.length ?? 0).toBe(2);
  });
});
