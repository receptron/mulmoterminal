// Which features the toolbar's feature menu lists, from what is set up.
import { describe, it, expect } from "vitest";
import { featureMenuEntries } from "../../../src/components/featureMenuEntries";

const gated = (rooms: boolean, worklog: boolean) => ({ prs: false, rooms, worklog });

describe("featureMenuEntries", () => {
  it("lists all seven, in order, once everything is set up", () => {
    expect(featureMenuEntries(gated(true, true))).toEqual(["rooms", "library", "blueprints", "skills", "processes", "worklog", "usage"]);
  });

  it("always offers the Library, Blueprints, Skills, Processes and Usage, so the menu is never empty", () => {
    expect(featureMenuEntries(gated(false, false))).toEqual(["library", "blueprints", "skills", "processes", "usage"]);
  });

  it.each([
    [true, false, ["rooms", "library", "blueprints", "skills", "processes", "usage"]],
    [false, true, ["library", "blueprints", "skills", "processes", "worklog", "usage"]],
  ])("rooms=%s worklog=%s lists %j", (rooms, worklog, expected) => {
    expect(featureMenuEntries(gated(rooms, worklog))).toEqual(expected);
  });

  it("ignores the pull-requests gate, which is a toolbar button of its own", () => {
    expect(featureMenuEntries({ prs: true, rooms: false, worklog: false })).toEqual(["library", "blueprints", "skills", "processes", "usage"]);
  });

  it("offers usage last, whether or not token rotation is on: the retrospective needs no setup (#3335)", () => {
    expect(featureMenuEntries(gated(false, false)).at(-1)).toBe("usage");
  });
});
