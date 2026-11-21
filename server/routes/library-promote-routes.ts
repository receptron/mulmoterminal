// POST /api/library/conversations/:id/promote — promote a conversation to a memory, a rule, a plan, an
// issue or a skill (#3334). The Library calls no AI itself: this starts a Claude session in the
// directory the conversation ran in, with the bundled skill asked to do it, and the skill writes
// nothing until the person approves.
//
// A write (it starts a process), so it is same-origin guarded like the other local-only mutations.
// The directory is never the browser's: it is the one the Library's index holds for that conversation.
import { stat } from "node:fs/promises";
import type { Express } from "express";
import { isPromoteTarget, promoteTurn } from "../../common/libraryPromote.js";
import { isLibraryConversation } from "../../common/library.js";
import type { LibraryCaller } from "../backends/library/library-service.js";
import type { SpawnIssueSession } from "../session/spawn/issue-session-spawn.js";
import { requestOriginAllowed } from "./same-origin-guard.js";
import { requestBody } from "./requestBody.js";
import { answer } from "./library-routes.js";

export interface LibraryPromoteDeps {
  spawnSession: SpawnIssueSession;
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
}

const isDirectory = async (dir: string): Promise<boolean> => (await stat(dir).catch(() => null))?.isDirectory() === true;

export function mountLibraryPromoteRoute(app: Express, call: LibraryCaller, deps: LibraryPromoteDeps): void {
  app.post("/api/library/conversations/:id/promote", async (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).end();
    const { cwd, target } = requestBody(req.body);
    const turn = isPromoteTarget(target) ? promoteTurn(target, req.params.id) : null;
    if (turn === null || (cwd !== undefined && cwd !== null && typeof cwd !== "string")) {
      return res.status(400).json({ error: "expected a conversation id, { target } one of memory, rule, plan, issue, skill, and an optional cwd" });
    }
    const found = await answer(res, call, "conversation", [req.params.id, cwd ?? null]);
    if (found === undefined) return;
    if (!isLibraryConversation(found) || found.agent !== "claude") return res.status(404).json({ error: "conversation not found" });
    if (found.cwd === null || !(await isDirectory(found.cwd))) {
      return res.status(409).json({ error: "the directory this conversation ran in is not on this machine" });
    }
    try {
      const spawned = await deps.spawnSession("claude", found.cwd, turn, true, null);
      res.json({ chatId: spawned.sessionId, agent: spawned.agent });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "the session could not be started" });
    }
  });
}
