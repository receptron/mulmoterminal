// @vitest-environment node
import { describe, it, expect } from "vitest";

import { applySkillFilter, type DiscoveredSkill } from "../../../../server/backends/remoteHost/skills.js";

const skill = (slug: string): DiscoveredSkill => ({ slug, description: `${slug} desc` });

// The per-dir Skill-menu allowlist. It decides both WHICH skills a directory offers and in
// WHAT ORDER — the menu follows the filter, not discovery order — so a regression yields a
// plausible-looking menu that is quietly wrong.
describe("applySkillFilter", () => {
  const skills = [skill("alpha"), skill("beta"), skill("gamma")];

  it("returns everything unchanged when there is no filter", () => {
    expect(applySkillFilter(skills, null)).toBe(skills);
  });

  it("keeps only the listed slugs", () => {
    expect(applySkillFilter(skills, ["gamma", "alpha"]).map((s) => s.slug)).toEqual(["gamma", "alpha"]);
  });

  // The filter's order wins — that is how a directory puts its most-used skill first.
  it("follows the filter's order, not discovery order", () => {
    expect(applySkillFilter(skills, ["gamma", "beta", "alpha"]).map((s) => s.slug)).toEqual(["gamma", "beta", "alpha"]);
  });

  // A slug the user listed but that no longer exists is dropped, not rendered as a dead entry
  // that types a slash command nothing answers.
  it("drops a listed slug that was not discovered", () => {
    expect(applySkillFilter(skills, ["alpha", "ghost"]).map((s) => s.slug)).toEqual(["alpha"]);
  });

  it("shows nothing for an empty filter", () => {
    expect(applySkillFilter(skills, [])).toEqual([]);
  });

  it("does not invent entries when nothing was discovered", () => {
    expect(applySkillFilter([], ["alpha"])).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    applySkillFilter(skills, ["gamma"]);
    expect(skills.map((s) => s.slug)).toEqual(["alpha", "beta", "gamma"]);
  });
});
