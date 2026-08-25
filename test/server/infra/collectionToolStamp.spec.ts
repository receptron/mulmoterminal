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

  it("refuses a row that carries the stamped field in any mode", async () => {
    // Meaningless whatever the mode: the server decides this value, so a caller sending one is
    // either refused (`stampOk`, `stampHeld`) or ignored.
    const answer = await guarded()(put({ items: [{ id: "m1", postedAt: "2026-08-25T09:00" }] }));
    expect(answer).not.toBe(REACHED);
    expect(answer).toContain("carry 'postedAt'");
  });

  it("lets an update that leaves the field alone through", async () => {
    // The write that still WORKS, and the reason this guard is not simply "refuse putItems here":
    // `stampHeld` only asks that the value does not move, so correcting a body after posting is
    // allowed and must stay allowed.
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

  it("does not read itemsFile, and still catches the batch that matters", async () => {
    // A generated batch is a `create`, which the mode test already answers — so the largest read in
    // the tool is not doubled to produce a diagnostic.
    const answer = await guarded()(put({ mode: "create", itemsFile: "/tmp/nope.json" }));
    expect(answer).toContain("cannot succeed");
    // And an upsert from a file is passed through rather than guessed at.
    expect(await guarded()(put({ itemsFile: "/tmp/nope.json" }))).toBe(REACHED);
  });
});

describe("stampGuardProblem", () => {
  it("defaults the mode to upsert, matching the engine", () => {
    // A call with no `mode` is an upsert, so a row that does not carry the field is fine.
    expect(stampGuardProblem({ items: [{ id: "m1" }] }, "postedAt", "messages")).toBeNull();
  });

  it("counts the rows it is refusing, so a big batch says how many", () => {
    const problem = stampGuardProblem({ items: [{ postedAt: "x" }, { body: "b" }, { postedAt: "y" }] }, "postedAt", "messages");
    expect(problem).toContain("2 of these rows");
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
