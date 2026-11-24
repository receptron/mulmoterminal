// Which skill a Skills viewer request names: `plugin` an enabled plugin, `dir` a directory a terminal
// ran in, neither the user's own skills dir. Shared by the catalog routes and the evaluation routes.
import type { SkillDocSource } from "../backends/skills/skillCatalog.js";

const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

export function docSource(query: Record<string, unknown>): SkillDocSource {
  const plugin = nonEmpty(query.plugin);
  if (plugin !== null) return { scope: "plugin", plugin };
  const dir = nonEmpty(query.dir);
  return dir === null ? { scope: "user" } : { scope: "project", dir };
}
