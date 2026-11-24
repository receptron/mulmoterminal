// How often each skill ran (#3437), from the Library's index: one entry per name claude ran it by
// (`plugin:slug` for a plugin's skill, else the slug), counted over the conversations the Library lists.
// Shared because the server reads it out of the index and the Skills viewer matches it to the catalog.
import { isRecord } from "./isRecord.js";

export interface SkillUsage {
  id: string;
  conversations: number;
  /** When the last conversation that ran it ended (ms), or null when none of them recorded an end. */
  lastUsedAt: number | null;
}

export const isSkillUsage = (value: unknown): value is SkillUsage =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.conversations === "number" &&
  (value.lastUsedAt === null || typeof value.lastUsedAt === "number");

/** The entries by skill id. A user skill and a project skill of the same slug run under the same
 *  name, so the transcript cannot tell them apart and both are shown the one count. */
export function usageById(usage: readonly SkillUsage[]): ReadonlyMap<string, SkillUsage> {
  return new Map(usage.map((entry) => [entry.id, entry]));
}
