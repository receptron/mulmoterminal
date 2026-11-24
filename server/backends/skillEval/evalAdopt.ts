// Adopting an improvement (#3448): the measured candidate's SKILL.md replaces the skill's own, after the
// text it replaces is kept under `versions/`. The write is made over the version just read, so an edit
// that lands in between is refused rather than lost, and only the text that was measured is written.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SkillEvalRun } from "../../../common/skillEval.js";
import { readSkillDoc, type SkillDocRequest } from "../skills/skillCatalog.js";
import { writeSkillDoc } from "../skills/skillEdit.js";
import { memoryVersion } from "../library/memory-write.js";
import { candidateDir } from "./evalImprove.js";
import { textHash } from "./evalStore.js";

export type AdoptResult = { kind: "adopted"; backup: string } | { kind: "changed" } | { kind: "refused"; error: string };

export const versionsDir = (evalDir: string): string => path.join(evalDir, "versions");

async function keepVersion(evalDir: string, text: string, now_ms: number): Promise<string> {
  await mkdir(versionsDir(evalDir), { recursive: true });
  const file = path.join(versionsDir(evalDir), `${String(now_ms)}-${textHash(text).slice(0, 8)}.md`);
  await writeFile(file, text);
  return file;
}

export async function adoptCandidate(evalDir: string, run: SkillEvalRun, request: SkillDocRequest, now_ms: number): Promise<AdoptResult> {
  if (run.candidateId === null || run.status !== "done") return { kind: "refused", error: "only a finished improvement can be adopted" };
  const candidateText = await readFile(path.join(candidateDir(evalDir, run.candidateId), "SKILL.md"), "utf8").catch(() => null);
  if (candidateText === null) return { kind: "refused", error: "the improvement's SKILL.md is gone" };
  if (textHash(candidateText) !== run.skillHash) return { kind: "refused", error: "the improvement changed since it was measured" };
  const current = await readSkillDoc(request);
  if (current === null) return { kind: "refused", error: "the skill could not be read" };
  if (textHash(current) !== run.baseSkillHash) return { kind: "changed" };
  const backup = await keepVersion(evalDir, current, now_ms);
  const written = await writeSkillDoc(request, candidateText, memoryVersion(current));
  if (written.kind === "conflict") return { kind: "changed" };
  if (written.kind !== "written") return { kind: "refused", error: "this skill cannot be edited here" };
  return { kind: "adopted", backup };
}
