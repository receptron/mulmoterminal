// A worked example a usecase pack ships: a base and a full set of interview answers, so someone can
// watch a whole build happen before describing a product of their own.
import { z } from "zod";
import { BLUEPRINT_SLUG_RE } from "./manifest.js";
import { hearingAnswersSchema } from "./hearing.js";

export const presetSchema = z.object({
  id: z.string().regex(BLUEPRINT_SLUG_RE),
  title: z.string().min(1),
  description: z.string().default(""),
  base: z.string().regex(BLUEPRINT_SLUG_RE),
  answers: hearingAnswersSchema,
});

export const presetsFileSchema = z.object({ presets: z.array(presetSchema) }).superRefine((file, ctx) => {
  const ids = file.presets.map((preset) => preset.id);
  ids.filter((id, index) => ids.indexOf(id) !== index).forEach((id) => ctx.addIssue({ code: "custom", message: `duplicate preset id "${id}"` }));
});

/** One preset as the new-build form lists it: which usecase it belongs to. */
export const presetListingSchema = presetSchema.extend({ usecase: z.string().regex(BLUEPRINT_SLUG_RE) });

export type Preset = z.infer<typeof presetSchema>;
export type PresetListing = z.infer<typeof presetListingSchema>;
