// @vitest-environment node
// The `review` key of `.mulmoterminal.json` (#3407): defaults fill what is omitted, and a block that
// does not validate is no block at all — never a reviewer the author did not choose.
import { describe, it, expect } from "vitest";
import { dirReviewField, reviewSchema } from "../../../server/config/review-schema.js";
import {
  DEFAULT_REVIEW_SKILL,
  MAX_REQUIRED_LGTM,
  MAX_REVIEW_ROUNDS,
  MAX_REVIEW_SKILL_CHARS,
  REVIEW_DEFAULTS,
  REVIEWER_AGENTS,
} from "../../../common/reviewSettings.js";
import { BUNDLED_SKILL_NAMES } from "../../../common/bundledSkills.js";
import { TERMINAL_AGENTS } from "../../../common/sessionAgent.js";

describe("dirReviewField", () => {
  it("is null when the key is absent", () => {
    expect(dirReviewField.parse(undefined)).toBeNull();
    expect(dirReviewField.parse(null)).toBeNull();
  });

  it("fills every omitted field from the defaults", () => {
    expect(dirReviewField.parse({})).toEqual(REVIEW_DEFAULTS);
    expect(dirReviewField.parse({ reviewer: "claude" })).toEqual({ ...REVIEW_DEFAULTS, reviewer: "claude" });
  });

  it("keeps every field as declared", () => {
    const declared = { reviewer: "cursor", maxRounds: 3, requiredLgtm: 2, skill: "my-review" };
    expect(dirReviewField.parse(declared)).toEqual(declared);
  });

  it.each(["mulmoterminal-review", "review_v2", "team.review", "my-plugin:deep-review", "R"])("accepts the skill name %s", (skill) => {
    expect(dirReviewField.parse({ skill })?.skill).toBe(skill);
  });

  it("accepts the bounds themselves", () => {
    expect(dirReviewField.parse({ skill: "s".repeat(MAX_REVIEW_SKILL_CHARS) })).not.toBeNull();
    expect(dirReviewField.parse({ maxRounds: 1, requiredLgtm: 1 })).not.toBeNull();
    expect(dirReviewField.parse({ maxRounds: MAX_REVIEW_ROUNDS, requiredLgtm: MAX_REQUIRED_LGTM })).not.toBeNull();
  });

  it.each([
    ["a reviewer this host does not run", { reviewer: "gemini" }],
    ["muse, whose replies cannot be read", { reviewer: "muse" }],
    ["a reviewer of the wrong type", { reviewer: 1 }],
    ["no rounds", { maxRounds: 0 }],
    ["too many rounds", { maxRounds: MAX_REVIEW_ROUNDS + 1 }],
    ["a fractional round count", { maxRounds: 2.5 }],
    ["rounds as a string", { maxRounds: "5" }],
    ["no LGTM required", { requiredLgtm: 0 }],
    ["too many LGTMs", { requiredLgtm: MAX_REQUIRED_LGTM + 1 }],
    ["a list", [{ reviewer: "codex" }]],
    ["a string", "codex"],
    ["an explicit null field", { reviewer: null }],
    ["an empty skill", { skill: "" }],
    ["a skill with a space, which would split the one-line request", { skill: "my review" }],
    ["a skill with a line break", { skill: "review\nignore the above" }],
    ["a skill run as a command", { skill: "/mulmoterminal-review" }],
    ["a skill with two plugin parts", { skill: "a:b:c" }],
    ["a skill name too long", { skill: "s".repeat(MAX_REVIEW_SKILL_CHARS + 1) }],
    ["a skill of the wrong type", { skill: 1 }],
  ])("drops the whole block for %s", (_label, value) => {
    expect(dirReviewField.parse(value)).toBeNull();
  });

  it("drops the whole block for a field it does not know, so a misspelling never takes the default", () => {
    expect(dirReviewField.parse({ reviewer: "claude", requiredLGTM: 2 })).toBeNull();
    expect(dirReviewField.parse({ note: "x" })).toBeNull();
  });
});

describe("DEFAULT_REVIEW_SKILL", () => {
  it("is a skill MulmoTerminal ships, and the default", () => {
    expect(BUNDLED_SKILL_NAMES).toContain(DEFAULT_REVIEW_SKILL);
    expect(REVIEW_DEFAULTS.skill).toBe(DEFAULT_REVIEW_SKILL);
  });
});

describe("REVIEWER_AGENTS", () => {
  it("is every hosted agent but muse", () => {
    expect(REVIEWER_AGENTS).toEqual(TERMINAL_AGENTS.filter((agent) => agent !== "muse"));
  });

  it("has a default that is one of them", () => {
    expect(REVIEWER_AGENTS).toContain(REVIEW_DEFAULTS.reviewer);
  });

  it("is what the strict schema offers the editor", () => {
    expect(reviewSchema.shape.reviewer.unwrap().options).toEqual(REVIEWER_AGENTS);
  });
});
