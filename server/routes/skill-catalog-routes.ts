// The Skills viewer over HTTP (#2815). Read-only: the catalog, one SKILL.md for the preview, and the
// skills.sh search with its preview (#2835). A skills.sh failure is 502: the request was fine, the
// directory could not be read.
import type { Express } from "express";
import { rememberedSessionCwds } from "../session/registry.js";
import { readSkillCatalog, readSkillDoc, type SkillDocSource } from "../backends/skills/skillCatalog.js";
import { MAX_QUERY_CHARS, readSkillsShSkill, searchSkillsSh, type FetchText } from "../backends/skills/skillsSh.js";
import { isRemoteSkillId, isRemoteSource } from "../../common/skillsSh.js";
import { isEditableSkill, writeSkillDoc } from "../backends/skills/skillEdit.js";
import { isFaithfulText, memoryVersion } from "../backends/library/memory-write.js";
import { memoryEditOf } from "./library-memory-routes.js";
import { requestBody } from "./requestBody.js";

const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function docSource(query: Record<string, unknown>): SkillDocSource {
  const plugin = nonEmpty(query.plugin);
  if (plugin !== null) return { scope: "plugin", plugin };
  const dir = nonEmpty(query.dir);
  return dir === null ? { scope: "user" } : { scope: "project", dir };
}

export interface SkillCatalogRouteDeps {
  /** Override the skills.sh fetch, for tests. */
  fetchSkillsSh?: FetchText;
}

const queryText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function mountSkillCatalogRoutes(app: Express, deps: SkillCatalogRouteDeps = {}): void {
  app.get("/api/skills/catalog", async (_req, res) => {
    res.json(await readSkillCatalog({ cwds: await rememberedSessionCwds() }));
  });

  // `plugin` names an enabled plugin, `dir` a directory a terminal ran in; neither means the user dir.
  app.get("/api/skills/doc", async (req, res) => {
    const slug = typeof req.query.slug === "string" ? req.query.slug : "";
    const markdown = await readSkillDoc({ source: docSource(req.query), slug, cwds: await rememberedSessionCwds() });
    if (markdown === null) {
      res.status(404).json({ error: "skill not found" });
      return;
    }
    // A version to save over, for a skill the user may edit here: one not written faithfully as text has none.
    const editable = isEditableSkill(docSource(req.query), slug) && isFaithfulText(markdown);
    res.json({ markdown, editable, ...(editable ? { version: memoryVersion(markdown) } : {}) });
  });

  // Saves a SKILL.md over the text it was opened on: 409 when it changed since, 400 when it is not one
  // to edit here (a plugin's, a bundled one, or a request that names no skill).
  app.put("/api/skills/doc", async (req, res) => {
    const body = requestBody(req.body);
    const edit = memoryEditOf(body);
    const slug = typeof body.slug === "string" ? body.slug : "";
    if (edit === null) {
      res.status(400).json({ error: "expected { slug, text, version }" });
      return;
    }
    try {
      const written = await writeSkillDoc({ source: docSource(body), slug, cwds: await rememberedSessionCwds() }, edit.text, edit.version);
      if (written.kind === "written") res.json({ version: written.version });
      else if (written.kind === "conflict") res.status(409).json({ error: "the skill changed since it was opened", version: written.version });
      else res.status(400).json({ error: "this skill cannot be edited here" });
    } catch {
      res.status(500).json({ error: "the skill could not be written" });
    }
  });

  mountSkillsShRoutes(app, deps.fetchSkillsSh);
}

function mountSkillsShRoutes(app: Express, fetchSkillsSh: FetchText | undefined): void {
  app.get("/api/skills/remote/search", async (req, res) => {
    const query = queryText(req.query.q);
    if (query === "" || query.length > MAX_QUERY_CHARS) {
      res.status(400).json({ error: `q must be 1-${String(MAX_QUERY_CHARS)} characters` });
      return;
    }
    const skills = await searchSkillsSh(query, fetchSkillsSh);
    if (skills === null) {
      res.status(502).json({ error: "skills.sh could not be searched" });
      return;
    }
    res.json({ skills });
  });

  app.get("/api/skills/remote/skill", async (req, res) => {
    const source = queryText(req.query.source);
    const skill = queryText(req.query.skill);
    if (!isRemoteSource(source) || !isRemoteSkillId(skill)) {
      res.status(400).json({ error: "source must be owner/repo and skill a skill name" });
      return;
    }
    const doc = await readSkillsShSkill(source, skill, fetchSkillsSh);
    if (doc === null) {
      res.status(502).json({ error: "the skill could not be read from skills.sh" });
      return;
    }
    res.json(doc);
  });
}
