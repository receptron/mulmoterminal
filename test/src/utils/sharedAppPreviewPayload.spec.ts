// The preview payload, as the pane reads it back.
//
// Narrowing is what stands between a shape decided in `@receptron/sharedapp` and a pane that draws
// the wrong thing without failing. The capability half is the one with teeth: every flag floors to
// FALSE, so a renamed or missing field takes a control away rather than offering one the rules will
// refuse — and a control drawn on a permission nobody holds is the exact mismatch the whole viewer
// mechanism exists to prevent.
import { describe, it, expect } from "vitest";
import { asPayload } from "../../../src/utils/sharedAppPreviewPayload";

const page = (over: Record<string, unknown> = {}) => ({ id: "desk", html: "<h1>Desk</h1>", audience: "member", ...over });

describe("the preview payload", () => {
  it("carries a member page's viewer through, rebuilt field by field", () => {
    const viewer = {
      me: "desk@gym.jp",
      can: { bookings: { transitionAny: true, assignees: ["a@x.jp"], assigneeField: "coach", withdrawFrom: ["requested"] } },
    };
    const parsed = asPayload({ aid: "a", pages: [page({ viewer })] });
    expect(parsed?.pages[0]?.viewer).toEqual({
      me: "desk@gym.jp",
      can: {
        bookings: {
          cid: "bookings",
          transitionAny: true,
          transitionOwn: false,
          assign: false,
          assignees: ["a@x.jp"],
          assigneeField: "coach",
          withdrawFrom: ["requested"],
        },
      },
    });
  });

  it("floors every permission to false, so a renamed field removes a control rather than inventing one", () => {
    // The direction matters. A page handed `transitionAny: true` for a permission the reader does
    // not hold draws a button the rules refuse — a refusal that names nothing, to somebody who did
    // what the page told them to.
    const parsed = asPayload({ aid: "a", pages: [page({ viewer: { me: "x@y.jp", can: { bookings: { transitionAnyy: true, assign: "yes" } } } })] });
    const can = parsed?.pages[0]?.viewer?.can.bookings;
    expect(can?.transitionAny).toBe(false);
    expect(can?.assign).toBe(false);
    expect(can?.assignees).toEqual([]);
    expect(can?.assigneeField).toBeUndefined();
  });

  it("keeps the cid from the KEY, so an entry cannot claim to be another collection", () => {
    const parsed = asPayload({ aid: "a", pages: [page({ viewer: { me: "x@y.jp", can: { bookings: { cid: "payments", transitionAny: true } } } })] });
    expect(parsed?.pages[0]?.viewer?.can.bookings?.cid).toBe("bookings");
  });

  it("leaves a page with no viewer WITHOUT one, rather than inventing an empty answer", () => {
    // An invented `{ me: null, can: {} }` is precisely the bug this change removes: it draws a page
    // with no buttons and says nothing about why. Absent, the pane uses the public parent.
    const parsed = asPayload({ aid: "a", pages: [page()] });
    expect(parsed?.pages[0]).not.toHaveProperty("viewer");
    // And a `viewer` with no `can` is not a viewer either.
    expect(asPayload({ aid: "a", pages: [page({ viewer: { me: "x@y.jp" } })] })?.pages[0]).not.toHaveProperty("viewer");
  });

  it("reads no address as null, never as an empty string", () => {
    // `""` would equal an empty `assigneeField` on a record, which is how a reader with no address
    // ends up holding somebody's row.
    const parsed = asPayload({ aid: "a", pages: [page({ viewer: { me: "", can: {} } })] });
    expect(parsed?.pages[0]?.viewer?.me).toBeNull();
  });

  it("drops a page whose audience is not one of the three", () => {
    expect(asPayload({ aid: "a", pages: [page({ audience: "staff" })] })?.pages).toEqual([]);
  });

  it("answers a payload it cannot read at all with null, rather than throwing", () => {
    expect(asPayload("nope")).toBeNull();
    expect(asPayload({})?.pages).toEqual([]);
  });
});
