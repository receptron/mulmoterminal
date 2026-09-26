// Builds the blueprint executor out of this server's real parts: a claude session per step, placed
// on the grid like any spawned chat, and the Stop hook as the end of its turn.
//
// Claude only, deliberately: the executor learns that a step's turn ended from the Stop hook, and
// claude is the one agent whose hooks are guaranteed to be its own for a given spawn (see the
// hidden-worker note in routes/plugin-routes.ts).
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createExecutor, type ProjectFiles } from "./executor.js";
import { readFile, rm, stat } from "node:fs/promises";
import { createRunStore } from "./runStore.js";
import { runCheck } from "./checkRunner.js";
import { mountBlueprintRoutes } from "./routes.js";
import type { PackRoot } from "./packs.js";
import { mountMarketRoutes } from "./marketRoutes.js";
import { registriesFile } from "./registry.js";
import { cloneRepo } from "./installer.js";
import { claudeTrusts } from "./trust.js";
import { registerCompletionHook } from "../session/completion-hooks.js";
import { markSessionPlaced, markUnplacedSession } from "../session/registry.js";
import { tmuxHasSession, tmuxKillSession } from "../infra/tmux.js";
import { MULMOTERMINAL_HOME, PORT } from "../config/env.js";

type SpawnClaude = (sessionId: string, ws: null, resumeId: null, options: { initialPrompt: string; cwd: string }) => void;

// The packs shipped in this checkout. A marketplace install would add a second root; not yet.
const PACKS_ROOT = path.join(import.meta.dirname, "..", "..", "blueprints");
const RUNS_ROOT = path.join(MULMOTERMINAL_HOME, "blueprints", "runs");
// Packs installed from a registry. After the shipped ones, so they can never replace one.
export const INSTALLED_PACKS_DIR = path.join(MULMOTERMINAL_HOME, "blueprints", "packs");
const PACK_ROOTS: readonly PackRoot[] = [
  { dir: PACKS_ROOT, source: "builtin" },
  { dir: INSTALLED_PACKS_DIR, source: "installed" },
];

// The question travels in $QUESTION and is JSON-encoded by node, so no quoting in it can break
// the request — the agent writes prose, not JSON. node comes FIRST in a pipe: the prompt tells the
// agent to write `QUESTION='…' <this>`, and such a prefix reaches only the first command. Inside a
// `$(…)` it would reach nothing, which is how a real run posted empty questions.
const SAFE_ARG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function askCommand(port: number | string, runId: string, stepId: string, sessionId: string): string {
  // Interpolated into a shell line, so each is held to a shape that needs no quoting.
  if (!/^\d{1,5}$/.test(String(port)) || ![runId, stepId, sessionId].every((arg) => SAFE_ARG_RE.test(arg)))
    throw new Error(`unsafe ask command arguments: ${port} ${runId} ${stepId} ${sessionId}`);
  const body = `node -e 'console.log(JSON.stringify({stepId:process.argv[1],sessionId:process.argv[2],question:process.env.QUESTION}))' ${stepId} ${sessionId}`;
  // --fail-with-body: a refused question must fail the command AND say why, or the agent carries on
  // believing it asked.
  return `${body} | curl -sS --fail-with-body -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${port}/api/blueprints/runs/${runId}/ask`;
}

// The spec and the reply are small text files the agent writes; one far larger is not what was asked
// for, and is not read into memory.
const PROJECT_FILE_MAX_BYTES = 1024 * 1024;

const projectFiles: ProjectFiles = {
  async read(dir, relativePath) {
    const file = path.join(dir, relativePath);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    if (info.size > PROJECT_FILE_MAX_BYTES) return `(${relativePath} is ${info.size} bytes, too large to show)`;
    return readFile(file, "utf8");
  },
  async remove(dir, relativePath) {
    await rm(path.join(dir, relativePath), { force: true });
  },
};

// A step's session is marked unplaced so a grid can show it; one the build has ended must lose that
// mark too, or the next grid to load adopts it and resumes an agent in the project folder.
function endOrphanedSession(sessionId: string): void {
  markSessionPlaced(sessionId);
  if (tmuxHasSession(sessionId)) tmuxKillSession(sessionId);
}

export function mountBlueprints(app: Express, spawnClaudePty: SpawnClaude, reap: (sessionId: string) => void): void {
  const executor = createExecutor({
    store: createRunStore(RUNS_ROOT),
    spawnStepSession: (cwd, prompt, sessionId) => {
      spawnClaudePty(sessionId, null, null, { initialPrompt: prompt, cwd });
      markUnplacedSession(sessionId, "claude");
    },
    newSessionId: () => randomUUID(),
    onTurnEnded: (sessionId, callback) => registerCompletionHook(sessionId, (outcome) => callback(outcome)),
    runCheck,
    askCommand: (runId, stepId, sessionId) => askCommand(PORT, runId, stepId, sessionId),
    newRunId: () => randomUUID(),
    now: () => Date.now(),
    isTrusted: (dir) => claudeTrusts(dir),
    projectFiles,
    // The app's own teardown: the pty, the tmux session and everything it remembered about it.
    closeSession: (sessionId) => {
      markSessionPlaced(sessionId);
      reap(sessionId);
    },
  });
  executor
    .recover(endOrphanedSession)
    .catch((err: unknown) => console.error(`[blueprint] recovery failed: ${err instanceof Error ? err.message : String(err)}`));
  mountMarketRoutes(app, {
    builtinRoot: PACK_ROOTS[0] ?? { dir: PACKS_ROOT, source: "builtin" },
    packsDir: INSTALLED_PACKS_DIR,
    registriesFile: registriesFile(MULMOTERMINAL_HOME),
    clone: cloneRepo,
    now: () => Date.now(),
  });
  mountBlueprintRoutes(app, { executor, packRoots: PACK_ROOTS, now: () => Date.now(), isTrusted: (dir) => claudeTrusts(dir) });
}
