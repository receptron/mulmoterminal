// The `review` key of `.mulmoterminal.json` (#3407): the strict shape the editor and the config skill
// validate against, and the loader built on it.
import { z } from "zod";
import { MAX_REQUIRED_LGTM, MAX_REVIEW_ROUNDS, REVIEW_DEFAULTS, REVIEWER_AGENTS, type ReviewSettings } from "../../common/reviewSettings.js";

export const reviewSchema = z.object({
  reviewer: z.enum(REVIEWER_AGENTS).optional(),
  maxRounds: z.number().int().min(1).max(MAX_REVIEW_ROUNDS).optional(),
  requiredLgtm: z.number().int().min(1).max(MAX_REQUIRED_LGTM).optional(),
});

// All or nothing, unlike the lenient fields beside it: a typo in `reviewer` must not quietly become
// the default reviewer, because that runs an agent the author did not choose. A block that does not
// validate is no block, and the directory reports the key as ignored.
export const dirReviewField = reviewSchema
  .transform((declared): ReviewSettings => ({
    reviewer: declared.reviewer ?? REVIEW_DEFAULTS.reviewer,
    maxRounds: declared.maxRounds ?? REVIEW_DEFAULTS.maxRounds,
    requiredLgtm: declared.requiredLgtm ?? REVIEW_DEFAULTS.requiredLgtm,
  }))
  .nullable()
  .catch(null);
