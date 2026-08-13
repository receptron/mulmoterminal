// @vitest-environment node
//
// The per-tier projection: what each audience is handed, and what it is told it
// may change.
//
// THESE TESTS CAME FROM `@mulmoclaude/core` WITH THE CODE
// (`packages/core/test/collection/test_appViews.ts`, up to 4.0.0). They are not
// duplicated there — core keeps the half it still owns, which is normalization
// and the participant's read scope, and this file is now the only thing
// standing between a change to `{tier}/config` and a live app. See
// plans/refactor-shared-app-wire-contract.md for why the code moved.
//
// The failure being guarded is invisible on both sides: a participant handed
// the STAFF transition table draws an approve button, the page works, the
// projection type-checks, and the rules refuse only when somebody presses it.
// Declaration and enforcement disagreeing is what this projection exists to
// prevent, so every assertion below is about the two audiences DIFFERING.
//
// This file is pure — no filesystem, no Firestore. `appViewTiers.spec.ts` is
// the same subject through `planAppViewTiers`, which reads the pages off disk.
import { describe, it, expect } from "vitest";
import { AuthoredAppZ, type AuthoredApp, type PublishStamp } from "@mulmoclaude/core/collection/server";
import { projectAppViews } from "../../../server/backends/sharedApp/appViewProjection.js";

const OWNER = "owner@salon.jp";
const RECEPTION = "reception@salon.jp";
const STYLIST = "stylist@salon.jp";
const OBSERVER = "observer@salon.jp";
const CUSTOMER = "customer@example.jp";

const STAMP: PublishStamp = { uid: "u-owner", email: OWNER, publishedAt: 1_700_000_000_000 };

const app = (overrides: Record<string, unknown>): AuthoredApp =>
  AuthoredAppZ.parse({ aid: "11111111-2222-3333-4444-555555555555", members: { [OWNER]: { "*": "owner" } }, ...overrides });

const DESK = { id: "desk", audience: "member", path: "views/desk.html", collections: ["bookings"] };

/** One roster carrying every role the rules distinguish, because the staff
 *  tier's single document is read by all of them.
 *
 *  Parsed through `AuthoredAppZ` rather than cast, so a declaration publish
 *  would refuse cannot be smuggled into a test asserting what publish writes. */
const salon = (overrides: Record<string, unknown> = {}): AuthoredApp =>
  app({
    members: {
      [OWNER]: { "*": "owner" },
      [RECEPTION]: { bookings: "editor" },
      [STYLIST]: { bookings: "assignee" },
      // Holds a role, so `staffOf` admits them — and may write nothing.
      [OBSERVER]: { bookings: "viewer" },
      [CUSTOMER]: { "*": "participant" },
    },
    collections: {
      bookings: {
        statusField: "status",
        transitions: { initial: ["pending"], pending: ["approved", "rejected"], approved: ["done"] },
        assigneeField: "stylistEmail",
        mail: { toField: "email", on: { "booking-approved": { from: ["pending"], to: "approved" } } },
      },
    },
    public: {
      submit: {
        bookings: { auth: "verifiedEmail", emailField: "email", createFields: ["email", "startAt"], selfTransitions: { pending: ["cancelled"] } },
      },
    },
    views: [DESK, { id: "mine", audience: "participant", path: "views/mine.html", collections: ["bookings"] }],
    ...overrides,
  });

const writeOf = (authored: AuthoredApp, tier: "member" | "roster") =>
  projectAppViews(authored, STAMP)
    .filter((entry) => entry.tier === tier)
    .flatMap((entry) => entry.config.write);

describe("what each audience is handed", () => {
  it("separates the tiers, and a staff page is not in the participants' one", () => {
    const tiers = projectAppViews(
      app({
        participantRead: ["notices"],
        views: [
          DESK,
          { id: "mine", audience: "participant", path: "views/mine.html", collections: ["notices"] },
          { id: "public", audience: "public", path: "views/booking.html", collections: ["slots"] },
        ],
      }),
      STAMP,
    );
    const member = tiers.find((tier) => tier.audience === "member");
    const participant = tiers.find((tier) => tier.audience === "participant");
    expect(member?.tier).toBe("member");
    expect(participant?.tier).toBe("roster");
    // The front desk reads the whole collection, and only the front desk's tier
    // knows the page exists.
    expect(member?.config.views).toEqual([{ id: "desk", collections: [{ cid: "bookings", scope: "all" }] }]);
    expect(participant?.config.views).toEqual([{ id: "mine", collections: [{ cid: "notices", scope: "all" }] }]);
    // The public page is neither tier's business: it keeps config/public.
    expect(tiers.flatMap((tier) => tier.views).some((view) => view.audience === "public")).toBe(false);
  });

  it("returns both tiers even when empty, so a withdrawal has something to act on", () => {
    // An app that WITHDREW its member pages projects an empty tier. A host that
    // only saw the tiers with something in them would leave the previous pages
    // live — the failure `config/view` already had.
    expect(projectAppViews(app({}), STAMP).map((tier) => [tier.tier, tier.views.length])).toEqual([
      ["member", 0],
      ["roster", 0],
    ]);
  });

  it("follows the participantRead that will be PROMOTED, not what the manifest says", () => {
    // `projectPublish` overwrites `participantRead` with the staged schemas'
    // own, so a cid added to app.json since the last deploy is not in the rules.
    // Reading the manifest here would publish `scope: "all"` for a collection
    // the rules then deny — the page FAILS rather than showing less.
    const tiers = projectAppViews(
      app({ participantRead: ["notices"], views: [{ id: "mine", audience: "participant", path: "views/mine.html", collections: ["notices"] }] }),
      STAMP,
      { participantRead: [] },
    );
    expect(tiers.find((tier) => tier.audience === "participant")?.config.views).toEqual([{ id: "mine", collections: [] }]);
  });

  it("refuses a declaration that does not normalize, rather than publishing half of it", () => {
    // The gate has already said so; reaching here with one is a programming
    // error, and a partial projection would be published as if it were whole.
    expect(() => projectAppViews(app({ views: [DESK, { ...DESK, path: "views/other.html" }] }), STAMP)).toThrow(/not publishable/u);
  });
});

describe("what each audience may CHANGE", () => {
  it("gives the two audiences DIFFERENT transition tables for the same field", () => {
    const staff = writeOf(salon(), "member");
    const theirs = writeOf(salon(), "roster");
    expect(staff[0]?.transitions).toEqual({ initial: ["pending"], pending: ["approved", "rejected"], approved: ["done"] });
    // The participant's own transitions, and nothing of the staff's: an
    // `approved` button on their page is refused the moment it is pressed.
    expect(theirs[0]?.transitions).toEqual({ pending: ["cancelled"] });
    expect(theirs[0]?.statusField).toBe("status");
  });

  it("carries the roster's answer to WHO may write with the declaration", () => {
    // The point of the pair. One `member/config` is read by everybody the tier
    // admits — the receptionist, the stylist scoped to their own rows, and an
    // observer who may write nothing — and none of them can look their own role
    // up (`apps/{aid}` is `readerOf(a, '*')`, which a per-collection role does
    // not satisfy). Without these lists the page draws approve for all three
    // and the rules refuse two of them when pressed.
    const staff = writeOf(salon(), "member");
    expect(staff[0]?.writers).toEqual([OWNER, RECEPTION].sort());
    expect(staff[0]?.rowWriters).toEqual([STYLIST]);
    // A viewer is in neither, which is the whole difference between "holds a
    // role" and "may change this".
    expect(staff[0]?.writers).not.toContain(OBSERVER);
    expect(staff[0]?.rowWriters).not.toContain(OBSERVER);
    // And the assignment candidates are these two together — not published a
    // third time, so a third list cannot disagree with the two the rules read.
    expect([...(staff[0]?.writers ?? []), ...(staff[0]?.rowWriters ?? [])].sort()).toEqual([OWNER, RECEPTION, STYLIST].sort());
  });

  it("keeps assignment, and every address, on the staff tier only", () => {
    const staff = writeOf(salon(), "member");
    expect(staff[0]?.assigneeField).toBe("stylistEmail");
    const theirs = writeOf(salon(), "roster");
    // A participant writes their own row, which the rules answer from the
    // record rather than from a role — so an address list there would be a
    // roster leak for nothing. ABSENT rather than empty: the reader treats
    // absence as "this projection states no roles", and `[]` would refuse the
    // participant's own cancel.
    expect(theirs[0]).not.toHaveProperty("assigneeField");
    expect(theirs[0]).not.toHaveProperty("writers");
    expect(theirs[0]).not.toHaveProperty("rowWriters");
  });

  it("says nothing about assignees when there is no field to compare them against", () => {
    // `isAssigned` in the rules requires the field, so publishing `rowWriters`
    // without one would name people who cannot write after all.
    const noField = salon({ collections: { bookings: { statusField: "status", transitions: { pending: ["approved"] } } } });
    const staff = writeOf(noField, "member");
    expect(staff[0]).not.toHaveProperty("rowWriters");
    expect(staff[0]?.writers).toEqual([OWNER, RECEPTION].sort());
  });

  it("keeps the mail a transition queues on the staff tier only", () => {
    // The rules let only a writer (or the row's own assignee) queue mail, so a
    // participant handed this could only ever be refused.
    expect(writeOf(salon(), "member")[0]?.mail?.toField).toBe("email");
    expect(writeOf(salon(), "roster")[0]).not.toHaveProperty("mail");
  });

  it("leaves a collection with nothing writable ABSENT, not present and empty", () => {
    // A page draws its buttons from these entries; an empty one would be a
    // collection with a button that does nothing.
    const readOnly = salon({ collections: { bookings: { statusField: "status" } }, public: { submit: {} } });
    expect(writeOf(readOnly, "member")).toEqual([]);
    expect(writeOf(readOnly, "roster")).toEqual([]);
  });

  it("treats a status field with no table, and a table with no field, as nothing", () => {
    // Half a declaration is not half a feature: a field with no table would
    // offer every value, and a table with no field has nothing to write to.
    const noTable = salon({ collections: { bookings: { statusField: "status", assigneeField: "stylistEmail" } } });
    expect(noTable && writeOf(noTable, "member")[0]).not.toHaveProperty("transitions");
    expect(writeOf(noTable, "member")[0]?.assigneeField).toBe("stylistEmail");
    // The OTHER tier reads a different table, so dropping the staff one must
    // not take the customer's cancel with it: two independent declarations.
    expect(writeOf(noTable, "roster")[0]?.transitions).toEqual({ pending: ["cancelled"] });

    const noField = salon({ collections: { bookings: { transitions: { pending: ["approved"] } } } });
    expect(writeOf(noField, "member")).toEqual([]);
    // And with no status field there is nothing to write either table to, so
    // the participant loses their move as well — for the same reason, not by
    // accident.
    expect(writeOf(noField, "roster")).toEqual([]);
  });

  it("follows the collection config publish PROMOTES, not what the manifest says", () => {
    // The mirror of the `participantRead` case, and the same failure: at
    // publish `projectPublish` replaces `collections` with what the staged
    // schemas carry, so a manifest edited since the last deploy would advertise
    // transitions the live rules deny. Both halves are passed together — one
    // without the other publishes datasets from revision A beside buttons from
    // revision B.
    const promoted = { collections: { bookings: { statusField: "status", transitions: { pending: ["approved"] } } } };
    const staff = projectAppViews(salon({ collections: { bookings: { statusField: "state", transitions: { open: ["closed"] } } } }), STAMP, promoted)
      .filter((entry) => entry.tier === "member")
      .flatMap((entry) => entry.config.write);
    expect(staff[0]?.statusField).toBe("status");
    expect(staff[0]?.transitions).toEqual({ pending: ["approved"] });
  });
});

describe("the rest of the document", () => {
  it("lowers the submit window with core's own conversion, not a second copy of it", () => {
    // The same `public.submit` declaration also becomes `config/public`, which
    // `firestore.rules` reads — so a second ISO-to-millis lowering here is a
    // divergence nobody sees until a submit window silently stops closing.
    const timed = salon({
      public: {
        submit: {
          bookings: { auth: "verifiedEmail", emailField: "email", createFields: ["email"], window: { from: "2026-01-01T00:00:00.000Z" } },
        },
      },
    });
    const config = projectAppViews(timed, STAMP).find((tier) => tier.tier === "member")?.config;
    expect(config?.submit.bookings?.window).toEqual({ fromMs: Date.parse("2026-01-01T00:00:00.000Z") });
  });

  it("carries the app's name and the stamp, and only the collections the views draw", () => {
    const named = salon({ name: "Salon" });
    const config = projectAppViews(named, STAMP).find((tier) => tier.tier === "member")?.config;
    expect(config?.name).toBe("Salon");
    expect(config?.publishedAt).toBe(STAMP.publishedAt);
    expect(Object.keys(config?.submit ?? {})).toEqual(["bookings"]);
  });
});
