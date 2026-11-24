// @vitest-environment node
// The one-line summary Settings shows for a directory's `review` key (#3425): every setting that
// changes how the PR is reviewed is in it, the skill included.
import { describe, it, expect } from "vitest";
import { REVIEW_DEFAULTS, reviewSummary } from "../../common/reviewSettings.js";

describe("reviewSummary", () => {
  it("names the reviewer, the skill, the round limit and the LGTMs", () => {
    expect(reviewSummary({ reviewer: "claude", maxRounds: 4, requiredLgtm: 2, skill: "my-plugin:deep-review" })).toBe(
      "claude with my-plugin:deep-review, up to 4 rounds, 2 LGTM on the current head",
    );
  });

  it("shows the bundled skill when none is declared", () => {
    expect(reviewSummary(REVIEW_DEFAULTS)).toContain(`with ${REVIEW_DEFAULTS.skill},`);
  });
});
