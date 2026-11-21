// The Library's Repeats view over HTTP (#3334): instructions typed again and again, found on the
// index's worker from Claude Code's prompt log.
//   GET  /api/library/repeats           — the most typed candidates, and how many there are
//   GET  /api/library/repeats/:id       — one, with each time it was typed (what the skill reads)
//   POST /api/library/repeats/:id/promote { target: rule | skill } — start the skill on it
// The promote is the conversation promote's: same-origin guarded, a turn the server builds from a
// fixed target and a hex id, plan mode, in the directory the instruction was typed in most.
import type { Express } from "express";
import { isRepeatCandidate, isRepeatId, isRepeatTarget, repeatTurn } from "../../common/libraryRepeats.js";
import type { LibraryCaller } from "../backends/library/library-service.js";
import { requestOriginAllowed } from "./same-origin-guard.js";
import { requestBody } from "./requestBody.js";
import { answer } from "./library-routes.js";
import { isDirectory, startPromoteSession, type LibraryPromoteDeps } from "./library-promote-routes.js";

/** The first of the directories it was typed in (most first) that is on this machine, or null. */
async function promoteDirectory(projects: readonly string[]): Promise<string | null> {
  for (const project of projects) {
    if (await isDirectory(project)) return project;
  }
  return null;
}

export function mountRepeatRoutes(app: Express, call: LibraryCaller, promote: LibraryPromoteDeps | undefined): void {
  app.get("/api/library/repeats", async (_req, res) => {
    const list = await answer(res, call, "repeats", []);
    if (list !== undefined) res.json(list);
  });
  app.get("/api/library/repeats/:id", async (req, res) => {
    if (!isRepeatId(req.params.id)) return res.status(400).json({ error: "expected a repeat id" });
    const detail = await answer(res, call, "repeat", [req.params.id]);
    if (detail === null) return res.status(404).json({ error: "no repeated instruction has that id now" });
    if (detail !== undefined) res.json(detail);
  });
  if (promote === undefined) return;
  app.post("/api/library/repeats/:id/promote", async (req, res) => {
    if (!requestOriginAllowed(req, promote.isAllowedOrigin)) return res.status(403).end();
    const { target } = requestBody(req.body);
    const turn = isRepeatTarget(target) ? repeatTurn(target, req.params.id) : null;
    if (turn === null) return res.status(400).json({ error: "expected a repeat id and { target } one of rule, skill" });
    const found = await answer(res, call, "repeat", [req.params.id]);
    if (found === undefined) return;
    if (!isRepeatCandidate(found)) return res.status(404).json({ error: "no repeated instruction has that id now" });
    const cwd = await promoteDirectory(found.projects);
    if (cwd === null) return res.status(409).json({ error: "none of the directories it was typed in is on this machine" });
    await startPromoteSession(res, promote, cwd, turn);
  });
}
