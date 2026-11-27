import { describe, it, expect } from "vitest";
import { toolGroupsAnnouncementOf } from "../../common/toolGroupsAnnouncement";

describe("toolGroupsAnnouncementOf", () => {
  it("keeps groups only when they are a list of names, and an absent one absent rather than empty", () => {
    expect(toolGroupsAnnouncementOf({ sessionId: "s1", groups: ["render", "data"], extra: 1 })).toEqual({ sessionId: "s1", groups: ["render", "data"] });
    expect(toolGroupsAnnouncementOf({ sessionId: "s1", groups: [] })).toEqual({ sessionId: "s1", groups: [] });
    expect(toolGroupsAnnouncementOf({ sessionId: "s1" })).toEqual({ sessionId: "s1" });
    expect(toolGroupsAnnouncementOf({ sessionId: "s1", groups: ["render", 3] })).toEqual({ sessionId: "s1" });
    expect(toolGroupsAnnouncementOf({ sessionId: "s1", groups: "render" })).toEqual({ sessionId: "s1" });
  });
  it("reads nothing without a session", () => {
    [undefined, null, "s1", [], {}, { sessionId: "" }, { sessionId: 3 }, { groups: ["render"] }].forEach((data) =>
      expect(toolGroupsAnnouncementOf(data)).toBeNull(),
    );
  });
});
