// @vitest-environment node
//
// The access summary is answered from the WORKING TREE and nothing else.
//
// That is the property worth a spec of its own rather than a detail of one: the preview beside it
// needs a signed-in Firestore session because it reads the app's records, and if this grew the same
// requirement the panel would go blank on the machine of every author who has not connected — which
// is most of them, most of the time, and exactly when "who can reach this?" is being asked.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setFirestoreAccessor, setSharedCollectionsSupport } from "@mulmoclaude/core/collection/server";
import { initCollectionsBackend } from "../../../server/backends/collections.js";
import { sharedAppAccess } from "../../../server/backends/sharedApp/access.js";
import { makeTempDir } from "../../support/tempDir";

const AID = "11111111-2222-3333-4444-555555555555";

const withCollection = (root: string, slug: string): void => {
  const dir = path.join(root, ".claude", "skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + "/SKILL.md", `---\nname: ${slug}\ndescription: ${slug}\n---\n`);
  writeFileSync(
    path.join(dir, "schema.json"),
    JSON.stringify({
      title: slug,
      icon: "list",
      primaryKey: "id",
      storage: { type: "firestore" },
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        note: { type: "string", label: "Note" },
        status: { type: "string", label: "Status" },
      },
    }),
  );
};

/** The #1926 shape: a `public.submit` declaration with the switch OFF. */
const inviteOnly = (root: string): void => {
  writeFileSync(
    path.join(root, "app.json"),
    JSON.stringify({
      aid: AID,
      name: "Invite only",
      members: { "owner@example.com": { "*": "owner" }, "guest@example.com": { "*": "participant" } },
      collections: { records: { statusField: "status" } },
      participantRead: ["records"],
      public: { submit: { records: { auth: "verifiedEmail", emailField: "note", createFields: ["note", "status"], initialStatus: "new" } } },
    }),
  );
};

describe("the shared-app access summary", () => {
  let root: string;

  beforeAll(() => {
    initCollectionsBackend({ workspace: makeTempDir("mt-shared-app-access-ws-") });
    setSharedCollectionsSupport(true);
  });

  beforeEach(() => {
    root = makeTempDir("mt-shared-app-access-");
    // SIGNED OUT, and every test here leaves it that way. See the header.
    setFirestoreAccessor(null);
    withCollection(root, "records");
  });

  it("answers with no Firestore session at all", async () => {
    inviteOnly(root);
    const result = await sharedAppAccess(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.access.publicFace).toBe("declared");
    expect(result.access.collections.map((entry) => entry.cid)).toEqual(["records"]);
    expect(result.access.collections[0].access.stranger).toEqual({ read: "none", create: false, editOwn: false, editAll: false, repairMirror: false });
    expect(result.access.collections[0].census).toEqual({ writers: 1, readers: 0, participants: 1 });
  });

  it("opens the same collection once the switch and the read list say so", async () => {
    writeFileSync(
      path.join(root, "app.json"),
      JSON.stringify({
        aid: AID,
        name: "Open",
        members: { "owner@example.com": { "*": "owner" } },
        collections: { records: { statusField: "status" } },
        public: { enabled: true, read: ["records"], submit: { records: { auth: "none", createFields: ["note", "status"], initialStatus: "new" } } },
      }),
    );
    const result = await sharedAppAccess(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.access.publicFace).toBe("open");
    expect(result.access.collections[0].access.visitor).toEqual({ read: "all", create: true, editOwn: false, editAll: false, repairMirror: false });
  });

  it("still answers for a declaration a publish would refuse", async () => {
    // The author is editing while the panel is open. A summary that vanishes on every half-typed
    // manifest is a summary nobody keeps open; `publish` is the gate, not this.
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: AID, name: "No owner", members: {}, collections: { records: {} } }));
    const result = await sharedAppAccess(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.access.collections[0].access.stranger.read).toBe("none");
  });

  it("reports a manifest that cannot be parsed rather than pretending it grants nothing", async () => {
    writeFileSync(path.join(root, "app.json"), "{ not json");
    const result = await sharedAppAccess(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(" ")).not.toBe("");
  });

  it("lists a collection the declaration never mentions", async () => {
    withCollection(root, "quiet");
    inviteOnly(root);
    const result = await sharedAppAccess(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Leaving it out would read as "this one is not published", which is the opposite of true.
    expect(result.access.collections.map((entry) => entry.cid)).toEqual(["quiet", "records"]);
    expect(result.access.collections[0].takesSubmissions).toBe(false);
  });
});
