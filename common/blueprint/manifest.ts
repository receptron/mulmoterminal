// A blueprint pack's manifest. A BASE pack says which platform it builds on (Firebase, Supabase …);
// a USECASE pack says what kind of system is built (internal tool, social …) and which bases it can
// sit on. The two are composed at run time, so neither repeats the other.
import { z } from "zod";

export const BLUEPRINT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const slug = z.string().regex(BLUEPRINT_SLUG_RE);

const requiredCliSchema = z.object({
  command: z.string().min(1),
  // Run to prove the CLI is there; exit 0 means installed.
  probe: z.string().min(1),
  installHint: z.string().optional(),
});

const manifestCommon = {
  slug,
  title: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(""),
};

export const baseManifestSchema = z.object({
  ...manifestCommon,
  kind: z.literal("base"),
  platform: z.string().min(1),
  requires: z.array(requiredCliSchema).default([]),
  credentials: z.array(z.string().min(1)).default([]),
});

export const usecaseManifestSchema = z.object({
  ...manifestCommon,
  kind: z.literal("usecase"),
  bases: z.array(slug).min(1),
});

export const blueprintManifestSchema = z.discriminatedUnion("kind", [baseManifestSchema, usecaseManifestSchema]);

export type BaseManifest = z.infer<typeof baseManifestSchema>;
export type UsecaseManifest = z.infer<typeof usecaseManifestSchema>;
export type BlueprintManifest = z.infer<typeof blueprintManifestSchema>;

/** Why this usecase cannot sit on this base, or null when it can. */
export function incompatibility(base: BaseManifest, usecase: UsecaseManifest): string | null {
  if (usecase.bases.includes(base.slug)) return null;
  return `usecase "${usecase.slug}" supports ${usecase.bases.join(", ")}, not "${base.slug}"`;
}
