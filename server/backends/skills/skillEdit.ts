// Editing a skill's SKILL.md from the Skills viewer (#3332). Over the text it was opened on only — an
// agent or another editor may have changed it since — through the same check-and-rename as a memory.
import { BUNDLED_SKILL_NAMES } from "../../../common/bundledSkills.js";
import { writeMemory, type MemoryWriteResult } from "../library/memory-write.js";
import { MAX_SKILL_DOC_BYTES, skillDocFile, type SkillDocRequest, type SkillDocSource } from "./skillCatalog.js";

/** Whether a skill is the user's to edit here: not a plugin's (the plugin writes it again on update),
 *  and not one MulmoTerminal ships (copied over it again at every start). */
export function isEditableSkill(source: SkillDocSource, slug: string): boolean {
  if (source.scope === "plugin") return false;
  return !(source.scope === "user" && BUNDLED_SKILL_NAMES.some((name) => name === slug));
}

/** Writes `text` over the skill's SKILL.md when it is still at `version`. */
export async function writeSkillDoc(request: SkillDocRequest, text: string, version: string): Promise<MemoryWriteResult> {
  if (!isEditableSkill(request.source, request.slug) || Buffer.byteLength(text) > MAX_SKILL_DOC_BYTES) return { kind: "refused" };
  const file = await skillDocFile(request);
  return file === null ? { kind: "refused" } : writeMemory(file, text, version);
}
