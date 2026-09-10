// @vitest-environment node
import { describe, it, expect } from "vitest";

import { asSessionCollection } from "../../common/sessionCollection";

describe("asSessionCollection", () => {
  it("reads the three fields a mark needs", () => {
    expect(asSessionCollection({ slug: "invoices", icon: "receipt_long", title: "Invoices" })).toEqual({
      slug: "invoices",
      icon: "receipt_long",
      title: "Invoices",
    });
  });

  // Extra keys are dropped rather than carried: this is the shape the UI renders, and a widened
  // server answering more must not put anything unreviewed on screen.
  it("keeps only the three", () => {
    expect(asSessionCollection({ slug: "a", icon: "b", title: "c", source: "project" })).toEqual({ slug: "a", icon: "b", title: "c" });
  });

  // A session that was not started from a collection, and one whose record is unusable, both draw
  // nothing — so both answer null rather than needing separate handling at every call site.
  it("answers null for absent, non-object and malformed", () => {
    expect(asSessionCollection(undefined)).toBeNull();
    expect(asSessionCollection(null)).toBeNull();
    expect(asSessionCollection("invoices")).toBeNull();
    expect(asSessionCollection([{ slug: "a", icon: "b", title: "c" }])).toBeNull();
    expect(asSessionCollection({ slug: "", icon: "b", title: "c" })).toBeNull();
    expect(asSessionCollection({ slug: "a", title: "c" })).toBeNull();
    expect(asSessionCollection({ slug: "a", icon: 1, title: "c" })).toBeNull();
  });

  // "" is what a collection declaring no icon answers with. The mark still has a title to name it
  // and a fallback glyph to draw, so the record is usable.
  it("keeps a collection that declares no icon", () => {
    expect(asSessionCollection({ slug: "a", icon: "", title: "c" })).toEqual({ slug: "a", icon: "", title: "c" });
  });
});
