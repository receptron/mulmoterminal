// Reading the Skills viewer's catalog and one SKILL.md from the server (#2815). `null` is "could not
// read it", which the overlay shows as a failure rather than as an empty list.
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import type { CatalogSkill, SkillCatalog, SkillSource } from "../../common/skillCatalog";
import { isSkillUsage, usageById, type SkillUsage } from "../../common/skillUsage";

const isCatalogSkill = (value: unknown): value is CatalogSkill =>
  isRecord(value) &&
  typeof value.slug === "string" &&
  typeof value.id === "string" &&
  typeof value.description === "string" &&
  typeof value.overridesUser === "boolean";

const isSkillSource = (value: unknown): value is SkillSource =>
  isRecord(value) &&
  (value.scope === "user" || value.scope === "plugin" || value.scope === "project") &&
  typeof value.dir === "string" &&
  typeof value.plugin === "string" &&
  isUnknownArray(value.skills) &&
  value.skills.every(isCatalogSkill);

export async function loadSkillCatalog(): Promise<SkillCatalog | null> {
  try {
    const res = await fetchWithTimeout("/api/skills/catalog");
    if (!res.ok) return null;
    const data = await jsonBody(res);
    return isUnknownArray(data.sources) ? { sources: data.sources.filter(isSkillSource) } : null;
  } catch {
    return null;
  }
}

/** The SKILL.md of `slug` in `source`, or null when it could not be read. */
/** A skill's SKILL.md, and — when it is one the user may edit here — the version to save over. */
export interface SkillDoc {
  markdown: string;
  version: string | null;
}

const docParams = (source: SkillSource, slug: string): URLSearchParams => {
  const params = new URLSearchParams({ slug });
  if (source.scope === "plugin") params.set("plugin", source.plugin);
  if (source.scope === "project") params.set("dir", source.dir);
  return params;
};

export async function loadSkillDoc(source: SkillSource, slug: string): Promise<SkillDoc | null> {
  try {
    const res = await fetchWithTimeout(`/api/skills/doc?${docParams(source, slug).toString()}`);
    if (!res.ok) return null;
    const data = await jsonBody(res);
    if (typeof data.markdown !== "string") return null;
    return { markdown: data.markdown, version: data.editable === true && typeof data.version === "string" ? data.version : null };
  } catch {
    return null;
  }
}

export type SkillSaveResult = { kind: "saved"; version: string } | { kind: "changed" } | { kind: "failed" };

/** Saves a SKILL.md over the version it was opened on. */
export async function saveSkillDoc(source: SkillSource, slug: string, text: string, version: string): Promise<SkillSaveResult> {
  const body = { ...Object.fromEntries(docParams(source, slug)), text, version };
  try {
    const res = await fetchWithTimeout("/api/skills/doc", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 409) return { kind: "changed" };
    const data = res.ok ? await jsonBody(res) : {};
    return typeof data.version === "string" ? { kind: "saved", version: data.version } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** How often each skill ran, by skill id, from the Library's index (#3437) — or null when the index
 *  could not answer, which the viewer shows as nothing rather than as "never used". */
export async function loadSkillUsage(): Promise<ReadonlyMap<string, SkillUsage> | null> {
  try {
    const res = await fetchWithTimeout("/api/library/skill-usage");
    if (!res.ok) return null;
    const data = await jsonBody(res);
    return isUnknownArray(data.skills) ? usageById(data.skills.filter(isSkillUsage)) : null;
  } catch {
    return null;
  }
}
