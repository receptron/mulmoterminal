// @vitest-environment node
//
// The tool's contract with the agent is ACTIONABLE PROSE, and that is the part a refusal is most
// likely to break: an operation that throws reaches the agent as a tool crash, which it will
// retry rather than report. So every path out of here is a string.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import {
  MANAGE_SHARED_APP,
  SHARED_APP_ACTIONS,
  checkKeyNote,
  checkRecordNote,
  manageSharedApp,
  openNote,
  pageNote,
  recordsHeadline,
} from "../../../server/infra/shared-app-tool.js";
import { HOST_TOOL_DEFINITIONS } from "../../../server/infra/host-tools.js";
import { groupOfTool } from "../../../common/toolGroups.js";
import { setFirestoreAccessor, setSharedCollectionsSupport } from "@mulmoclaude/core/collection/server";
import { initCollectionsBackend } from "../../../server/backends/collections.js";
import { makeTempDir } from "../../support/tempDir";
import path from "node:path";

/** The accessor hands back a Firestore adapter; `init` never uses it, but the shape is required. */
const FAKE_DOCS = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  create: () => Promise.resolve(true),
  delete: () => Promise.resolve(true),
  watch: () => () => {},
};

describe("manageSharedApp, the tool", () => {
  beforeAll(() => {
    // Discovery needs a bound host: `check` reads this repository's collections, and without the
    // binding it throws rather than reporting. ONE call per file — the binding refuses a second.
    initCollectionsBackend({ workspace: makeTempDir("mt-shared-tool-ws-") });
    // Signed out on purpose: it is the state `check` has to work in, and the state the other
    // operations have to refuse in.
    setSharedCollectionsSupport(true);
    setFirestoreAccessor(null);
  });

  it("reports an invite-only app as NOT open, and says why the `public` block is there (#1926)", () => {
    // The sentence that sent an author to check Firestore. `public.submit` on its own is what an
    // invite-only app needs for its members' pages to write records; it opens nothing, and the
    // reporting used to read the block's existence as "open".
    const declared = openNote("declared", "sakura-hair");
    expect(declared).toContain("NOT open to anonymous visitors");
    // The SWITCH is named. "declares no `public` block" was the old false-side reason and it is
    // untrue of exactly the app that most needs this sentence.
    expect(declared).toContain("`public.enabled` is not true");
    expect(declared).toContain("`public.submit`");
    // No address: an app that is not open has no public entrance to hand anybody.
    expect(declared).not.toContain("https://");

    expect(openNote("none", "sakura-hair")).toContain("declares no `public` block");
    expect(openNote("open", "sakura-hair")).toBe("The app is now OPEN to anonymous visitors at https://mulmoserver.web.app/a/sakura-hair.");
  });

  it("is registered as a host tool and reaches the group the collections live in", () => {
    expect(HOST_TOOL_DEFINITIONS.map((d) => d.name)).toContain("manageSharedApp");
    // Ungrouped would mean it is offered only through the all-tools URL — a cell with the
    // Collections pane would have the store and no way to publish it.
    expect(groupOfTool("manageSharedApp")).toBe("data");
  });

  it("names the operations in the schema the agent is given", () => {
    // `deploy` was one of these until staging was removed: an app is created (init) or published,
    // and there is nothing in between to write.
    expect(SHARED_APP_ACTIONS).toEqual(["init", "fork", "check", "preview", "invite", "publish", "unpublish"]);
    expect(MANAGE_SHARED_APP.parameters?.properties?.action).toMatchObject({ enum: [...SHARED_APP_ACTIONS] });
  });

  it("tells the agent that preview writes nothing until `confirm`, and that it must ask first", () => {
    // The gate raised in review of #1770. `preview` is the action an agent reaches for after every
    // edit, and with the 0.9.0 gesture mark an ungated one would put real records in a live app on
    // an ordinary diagnostic call. The boundary is `confirm`, NOT the undo that follows: while the
    // record exists something may act on it, and the removal can fail.
    //
    // Asserted on the PROSE because the prose is the contract here (see this file's header). What
    // the flag then does is one pass-through into `headlessPreview({ write })`, and the writerless
    // behaviour it selects is pinned against a real browser in `headlessPreview.spec.ts`
    // ("writes nothing when it is given no writer").
    // The one-liner an agent sees in the tool list has to carry it, not only the long prose —
    // a `preview` sent from the summary alone must not write.
    expect(String(MANAGE_SHARED_APP.description)).toContain("writes nothing unless you send `confirm: true`");
    const prompt = String(MANAGE_SHARED_APP.prompt);
    expect(prompt).toContain("BY DEFAULT IT WRITES NOTHING");
    expect(prompt).toMatch(/confirm: true.{0,80}WRITES a real record/s);
    expect(prompt).toContain("Ask the user before sending `confirm`");
    // And the flag's own description has to carry it too — an agent that reads only the parameter
    // must not think it is publish's override alone.
    const confirmDoc = String((MANAGE_SHARED_APP.parameters?.properties?.confirm as { description?: string })?.description);
    expect(confirmDoc).toContain("preview");
    expect(confirmDoc).toContain("ASK THE USER BEFORE SENDING IT");
  });

  it("answers an unknown action with the ones that exist", async () => {
    expect(await manageSharedApp(makeTempDir("mt-shared-tool-"), { action: "ship" })).toContain("init, fork, check, preview, invite, publish, unpublish");
    expect(await manageSharedApp(makeTempDir("mt-shared-tool-"), {})).toContain("init, fork, check, preview, invite, publish, unpublish");
  });

  it("refuses to start an app in a repository that already declares one", async () => {
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", members: {} }));
    // Overwriting would revoke the whole roster without saying so.
    expect(await manageSharedApp(root, { action: "init", name: "Second" })).toContain("already");
  });

  it("calls a sound declaration publishable while signed out", async () => {
    // The publisher check asks whether the caller is an app-wide owner, so an empty address is not
    // neutral — it reported a missing owner for every signed-out call, and `check` could never
    // come back clean. Signed out, the honest question is "would this publish for the owner it
    // names?", and the answer has to be able to be yes.
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", name: "Survey", members: { "o@e.com": { "*": "owner" } } }));

    const message = await manageSharedApp(root, { action: "check" });
    expect(message).toContain("publishable");
    expect(message).toContain("o@e.com");
  });

  it("says out loud that the records were not scanned, signed out", async () => {
    // Silence about the records reads as "the records are fine", and that is what carried 720
    // seeded rows with a `Z` in their `datetime` to a publish that refused every one (#1763).
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", name: "Survey", members: { "o@e.com": { "*": "owner" } } }));

    const message = await manageSharedApp(root, { action: "check" });
    expect(message).toContain("NOT scanned");
    // And the OTHER half of publish's gate that needs a session: the identity keys, which
    // `confirm` does not override when publish meets them.
    expect(message).toContain("Publish checks them too");
    // And the OTHER half of publish's gate that needs a session, reported separately because it
    // reads a different document: `apps/{aid}`, not the records.
    expect(message).toContain("identity keys");
    expect(message).toContain("NOT compared");
  });

  it("says a key comparison that did not run, and stays quiet about one that did", () => {
    // A clean gate is what "publishable" already means, so a comparison that RAN adds nothing. One
    // that did not has to be said: the gate reads `apps/{aid}` while the scan reads the records, so
    // a complete scan beside it is not evidence either way.
    expect(checkKeyNote({ compared: true })).toEqual([]);
    const unreadable = checkKeyNote({ compared: false, why: "unreadable-app" }).join(" ");
    expect(unreadable).toContain("NOT compared");
    expect(unreadable).toContain("DIFFERENT document");
    expect(unreadable).toContain("`confirm` does not override");
    // Nothing to compare, and the declaration's own problems already send the author to `init`.
    expect(checkKeyNote({ compared: false, why: "no-app" })).toEqual([]);
  });

  it("reports the rows it DID find beside the collection it could not read", () => {
    // `scanRecords` skips an unreadable collection and carries on, so the two outcomes coexist —
    // and answering only "could not be read" would hide rows the next publish is about to name.
    const note = checkRecordNote({
      scanned: true,
      scan: {
        lines: [
          "slots: 3 existing records would not satisfy the schema about to be written",
          "  - court-a-0800: 'startAt' = '…Z' is not a YYYY-MM-DDTHH:MM datetime",
        ],
        records: 3,
        capped: false,
        unreadable: ["rooms: permission denied"],
      },
    }).join("\n");
    expect(note).toContain("rooms: permission denied");
    expect(note).toContain("court-a-0800");
    // And it must NOT offer `confirm` here: `recordRefusal` returns on `unreadable` before it
    // weighs one, so a publish with both states refuses however it is confirmed.
    expect(note).not.toContain("only `confirm` gets past it");
    expect(note).toContain("that is the first repair");
  });

  it("does not call unread records invalid ones", () => {
    // Access and migration are opposite repairs. A collection nobody could read says nothing about
    // the rows behind it, and "the records are not publishable" reads as invalid data — sending the
    // author to migrate records they have not seen.
    const unread = recordsHeadline(
      { scanned: true, scan: { lines: [], records: 0, capped: false, unreadable: ["rooms: permission denied"] } },
      "shared collections: rooms",
    );
    expect(unread).toContain("UNKNOWN");
    expect(unread).not.toContain("are not");

    const broken = recordsHeadline({ scanned: true, scan: { lines: ["slots: 3 …"], records: 3, capped: false, unreadable: [] } }, "shared collections: slots");
    expect(broken).toContain("the records already in the app are not");

    expect(recordsHeadline({ scanned: true, scan: { lines: [], records: 0, capped: false, unreadable: [] } }, "shared collections: slots")).toBeNull();
    expect(recordsHeadline({ scanned: false, why: "no-session" }, "shared collections: slots")).toBeNull();
  });

  it("blames the declaration, not the session, when app.json does not parse", async () => {
    // Two ways of not scanning, two different repairs. Told "no session" here, an author
    // reconnects and gets the same report back.
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), "{ not json");

    const message = await manageSharedApp(root, { action: "check" });
    expect(message).toContain("NOT scanned");
    expect(message).toContain("until `app.json` parses");
    expect(message).not.toContain("session open");
  });

  it("checks the declaration without a session, and without writing", async () => {
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", members: { "o@e.com": { "*": "owner" } }, slug: "Not A Slug" }));

    const message = await manageSharedApp(root, { action: "check" });
    // The strict declaration refuses that slug's shape, and `check` is where an author is meant to
    // learn it — not at a deploy, and not from a live refusal.
    expect(message).toContain("slug");
    expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")).slug).toBe("Not A Slug");
  });

  it("adds and removes one roster entry, leaving the rest of the file alone", async () => {
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", name: "Survey", members: { "o@e.com": { "*": "owner" } } }));

    expect(await manageSharedApp(root, { action: "invite", email: "t@e.com", role: "viewer" })).toContain("viewer");
    const after = JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8"));
    expect(after.members).toEqual({ "o@e.com": { "*": "owner" }, "t@e.com": { "*": "viewer" } });
    expect(after.name).toBe("Survey");

    expect(await manageSharedApp(root, { action: "invite", email: "t@e.com" })).toContain("Removed");
    // Removed ENTIRELY rather than left as an empty object: the rules require the roster and its
    // email list to agree, and a half-removed entry is a permission somebody still holds.
    expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")).members).toEqual({ "o@e.com": { "*": "owner" } });
  });

  it("writes the SIGNED-IN address as owner, and generates the aid", async () => {
    // The whole reason `init` is an operation: the owner has to be the address the rules will see,
    // the agent cannot read it, and the address a user offers is the one that fails at deploy.
    const root = makeTempDir("mt-shared-tool-");
    setFirestoreAccessor(() => ({ docs: FAKE_DOCS, email: "signed-in@example.com", uid: "uid-1" }));
    try {
      const message = await manageSharedApp(root, { action: "init", name: "Talk feedback", slug: "aug-talk-survey" });
      expect(message).toContain("signed-in@example.com");
      const written = JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8"));
      expect(written.members).toEqual({ "signed-in@example.com": { "*": "owner" } });
      expect(written.aid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(written.name).toBe("Talk feedback");
      expect(written.slug).toBe("aug-talk-survey");
    } finally {
      setFirestoreAccessor(null);
    }
  });

  it("refuses to leave the app without an owner", async () => {
    // An app with no app-wide owner has no publisher: every deploy is refused, including the one
    // that would put an owner back.
    const root = makeTempDir("mt-shared-tool-");
    const roster = { "o@e.com": { "*": "owner" }, "t@e.com": { "*": "viewer" } };
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", members: roster }));

    expect(await manageSharedApp(root, { action: "invite", email: "o@e.com" })).toContain("no owner");
    expect(await manageSharedApp(root, { action: "invite", email: "o@e.com", role: "viewer" })).toContain("no owner");
    expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")).members).toEqual(roster);

    // With a second owner in place, the first may go.
    await manageSharedApp(root, { action: "invite", email: "t@e.com", role: "owner" });
    expect(await manageSharedApp(root, { action: "invite", email: "o@e.com" })).toContain("Removed");
  });

  it("catches, while signed in, what a deploy would refuse about `owner`", async () => {
    // `check` answers "would a deploy be refused?", so it has to run the SAME gate. A second
    // implementation answers differently, and this one answered optimistically: a declaration
    // naming somebody else's uid checked clean and was refused a moment later.
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(
      path.join(root, "app.json"),
      JSON.stringify({ aid: "a1", members: { "signed-in@example.com": { "*": "owner" } }, owner: "somebody-elses-uid" }),
    );
    setFirestoreAccessor(() => ({ docs: FAKE_DOCS, email: "signed-in@example.com", uid: "uid-1" }));
    try {
      expect(await manageSharedApp(root, { action: "check" })).toContain("somebody-elses-uid");
    } finally {
      setFirestoreAccessor(null);
    }
  });

  it("returns every refusal as text rather than throwing", async () => {
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", members: {} }));
    // The two that reach the APP need a session and say so. `check` and `invite` are about the
    // file and need none; `init` refuses here because the declaration already exists.
    for (const action of ["publish", "unpublish"]) {
      const message = await manageSharedApp(root, { action });
      expect(typeof message).toBe("string");
      expect(message).toContain("signed-in Firestore session");
    }
  });

  // The addresses this file prints are the ones the author hands to a visitor, and the router
  // that serves them is in ../mulmoserver (`src/router/index.ts`): `a/:slug` is the public face,
  // with `m/:slug` and `p/:slug` beside it. There is NO bare `/:slug` route — it
  // falls through to NotFound — so dropping the prefix is not a message that reads badly, it is
  // an address that opens nothing. It shipped that way: a published app was announced as "OPEN to
  // anonymous visitors at /meeting-rooms" while the booking page was at /a/meeting-rooms, and the
  // author went looking for the form at the URL the tool gave them.
  //
  // The ORIGIN is pinned for the same reason and cannot be inferred: this runs on the author's
  // own machine, which is not where the app is served, so a path alone is nothing they can paste
  // into an invitation.
  it("prints every entrance absolute, under the prefix the router actually serves", () => {
    const source = readFileSync(new URL("../../../server/infra/shared-app-tool.ts", import.meta.url), "utf8");
    const before = (index: number): string => source.slice(0, index);
    // Every slug or aid written as a PATH SEGMENT is an entrance, whatever sentence it sits in.
    const entrances = [...source.matchAll(/\$\{(?:result\.)?(?:slug|name|aid)\}/g)].filter((hit) => before(hit.index).endsWith("/"));
    // Not zero: a spec that passes because the strings were renamed out from under it is not a
    // guard.
    expect(entrances.length).toBeGreaterThan(4);
    for (const hit of entrances) {
      // `apps/${aid}` is a Firestore path rather than an address.
      if (before(hit.index).endsWith("apps/")) continue;
      expect(before(hit.index)).toMatch(/\$\{MULMOSERVER_ORIGIN\}\/(?:[amp]|staging)\/$/);
    }
  });

  // An app may publish pages and declare no `slug` — `withPages()` in sharedApp.spec.ts does
  // exactly that, and `PublishSuccess.slug` is optional for it. Both entrances need a URL name,
  // so there is no address to give, and the placeholder this used to print (`/m/{slug}`) is the
  // same unpasteable non-resolving thing the rest of this file exists to stop.
  it("says what is true about a page nobody can reach yet, instead of an address", () => {
    const [staff, mine] = pageNote(["desk"], ["mine"], undefined);
    expect(staff).toContain("Staff pages published: desk.");
    expect(mine).toContain("Participant pages published: mine.");
    for (const line of [staff, mine]) {
      expect(line).toContain("No address reaches them yet");
      expect(line).not.toContain("{slug}");
      expect(line).not.toContain("mulmoserver.web.app");
    }
  });

  it("gives the whole address once a URL name exists", () => {
    const [staff, mine] = pageNote(["desk"], ["mine"], "sakura-hair");
    expect(staff).toContain("Staff pages live at https://mulmoserver.web.app/m/sakura-hair: desk.");
    expect(mine).toContain("Participant pages live at https://mulmoserver.web.app/p/sakura-hair: mine.");
  });
});
