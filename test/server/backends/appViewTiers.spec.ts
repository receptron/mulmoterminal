// @vitest-environment node
//
// What MulmoTerminal actually writes to `apps/{aid}/{tier}/staged:config` —
// specifically the half that says what each audience may CHANGE.
//
// The projection itself is `appViewProjection.spec.ts` beside this file — pure,
// and no longer in `@mulmoclaude/core` (see
// plans/refactor-shared-app-wire-contract.md). What is pinned HERE is the JOIN:
// the pages read off disk, the tier they land in, and the config document that
// names them. The document is read by a mulmoserver that hand-declares its own
// parser, so a rename here has nothing between it and a live app except these
// two files.
//
// The failure it guards against is the one that is invisible on both sides: a
// participant handed the STAFF transition table draws an approve button, the
// page works, the projection type-checks, and the rules refuse only when
// somebody presses it. Declaration and enforcement disagreeing is exactly what
// the write projection exists to prevent.
//
// Design: plans/feat-shared-app-member-write.md
import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AuthoredAppZ, type AuthoredApp, type PublishStamp } from "@mulmoclaude/core/collection/server";
import { planAppViewTiers } from "../../../server/backends/sharedApp/appViews.js";
import { makeTempDir } from "../../support/tempDir";

const OWNER = "owner@salon.jp";
const RECEPTION = "reception@salon.jp";
const STYLIST = "stylist@salon.jp";
const OBSERVER = "observer@salon.jp";
const CUSTOMER = "customer@example.jp";

const STAMP: PublishStamp = { uid: "uid_owner", email: OWNER, publishedAt: 1_700_000_000_000, commit: "abc123" };

/** A salon whose bookings staff approve and the customer cancels — one roster
 *  carrying every role the rules distinguish, because the staff tier's single
 *  document is read by all of them.
 *
 *  Parsed through `AuthoredAppZ` rather than cast, so a declaration publish
 *  would refuse cannot be smuggled into a test that then asserts what publish
 *  writes for it. */
const salon = (): AuthoredApp =>
  AuthoredAppZ.parse({
    aid: "11111111-2222-3333-4444-555555555555",
    members: {
      [OWNER]: { "*": "owner" },
      [RECEPTION]: { bookings: "editor" },
      [STYLIST]: { bookings: "assignee" },
      [OBSERVER]: { bookings: "viewer" },
      [CUSTOMER]: { "*": "participant" },
    },
    collections: {
      bookings: {
        statusField: "status",
        transitions: { pending: ["approved", "rejected"] },
        assigneeField: "stylistEmail",
      },
    },
    public: {
      submit: {
        bookings: { auth: "verifiedEmail", emailField: "email", createFields: ["email", "startAt"], selfTransitions: { pending: ["cancelled"] } },
      },
    },
    views: [
      { id: "desk", audience: "member", path: "views/desk.html", collections: ["bookings"] },
      { id: "mine", audience: "participant", path: "views/mine.html", collections: ["bookings"] },
    ],
  });

const writeFor = async (root: string, tier: "member" | "roster") => {
  const planned = await planAppViewTiers(root, salon(), STAMP);
  expect(planned.ok, planned.ok ? "" : `refused: ${planned.problems.join(" ")}`).toBe(true);
  if (!planned.ok) throw new Error("unreachable");
  const config = planned.plans.find((plan) => plan.tier === tier)?.config;
  return (config?.write ?? []) as Record<string, unknown>[];
};

describe("what each tier is told it may change", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir("mt-app-view-tiers-");
    mkdirSync(path.join(root, "views"), { recursive: true });
    writeFileSync(path.join(root, "views", "desk.html"), "<div id='desk'></div>");
    writeFileSync(path.join(root, "views", "mine.html"), "<div id='mine'></div>");
  });

  it("hands the two audiences DIFFERENT transition tables for the same field", async () => {
    // Staff move along `collections.<cid>.transitions`, the person who booked
    // along `public.submit.<cid>.selfTransitions`. Publishing one table to both
    // is the drawn-but-refused button.
    const staff = await writeFor(root, "member");
    const theirs = await writeFor(root, "roster");
    expect(staff[0]?.statusField).toBe("status");
    expect(theirs[0]?.statusField).toBe("status");
    expect(staff[0]?.transitions).toEqual({ pending: ["approved", "rejected"] });
    expect(theirs[0]?.transitions).toEqual({ pending: ["cancelled"] });
  });

  it("says who may write, because being admitted to the staff tier is not permission", async () => {
    // `/m/{slug}` admits anybody holding a role anywhere in the app, and the
    // one `member/config` is read by all of them — so the observer receives
    // the same document as the front desk. The roster's answer therefore
    // travels with the declaration, and the page compares its own address to
    // it. Without these lists the page draws approve for the observer too.
    const staff = await writeFor(root, "member");
    expect(staff[0]?.writers).toEqual([OWNER, RECEPTION].sort());
    expect(staff[0]?.rowWriters).toEqual([STYLIST]);
    expect(staff[0]?.assigneeField).toBe("stylistEmail");
  });

  it("names nobody on the roster tier, where the rules answer from the record", async () => {
    // A participant writes their OWN row, which `ownRow` decides from the
    // document rather than from a role. An address list here would leak the
    // roster to every customer for nothing — and an EMPTY list would be worse
    // than absent: the reader treats absence as "this projection states no
    // roles", and inventing `[]` refuses the participant's own cancel.
    const theirs = await writeFor(root, "roster");
    expect(theirs[0]).toHaveProperty("transitions");
    expect(theirs[0]).not.toHaveProperty("writers");
    expect(theirs[0]).not.toHaveProperty("rowWriters");
    expect(theirs[0]).not.toHaveProperty("assigneeField");
  });
});
