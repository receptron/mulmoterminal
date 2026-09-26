// Builds the blueprint executor out of this server's real parts: a claude session per step and the
// Stop hook as the end of its turn. A step's session stays OFF the grid: a grid cell reconnects and
// relaunches what it shows, and another MulmoTerminal's grid adopts what this one marks — both put a
// second agent in the project folder behind the executor's back. The run view shows what it does.
//
// Claude only, deliberately: the executor learns that a step's turn ended from the Stop hook, and
// claude is the one agent whose hooks are guaranteed to be its own for a given spawn (see the
// hidden-worker note in routes/plugin-routes.ts).
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { BlueprintRefusal, createExecutor, type BlueprintExecutor, type ProjectFiles } from "./executor.js";
import { acquireLock, confirmLock, holdsLock } from "./executorLock.js";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { createRunStore } from "./runStore.js";
import { runCheck } from "./checkRunner.js";
import { mountBlueprintRoutes } from "./routes.js";
import type { PackRoot } from "./packs.js";
import { mountMarketRoutes } from "./marketRoutes.js";
import { registriesFile } from "./registry.js";
import { cloneRepo } from "./installer.js";
import { claudeTrusts } from "./trust.js";
import { registerCompletionHook } from "../session/completion-hooks.js";
import { markSessionPlaced } from "../session/registry.js";
import { tmuxHasSession, tmuxKillSession } from "../infra/tmux.js";
import { MULMOTERMINAL_HOME, PORT } from "../config/env.js";

type SpawnClaude = (sessionId: string, ws: null, resumeId: null, options: { initialPrompt: string; cwd: string }) => void;

// The packs shipped in this checkout. A marketplace install would add a second root; not yet.
const PACKS_ROOT = path.join(import.meta.dirname, "..", "..", "blueprints");
const RUNS_ROOT = path.join(MULMOTERMINAL_HOME, "blueprints", "runs");
const LOCK_FILE = path.join(MULMOTERMINAL_HOME, "blueprints", "executor.lock");
// Far longer than the gap between reading a stale lock and replacing it.
const TAKEOVER_SETTLE_MS = 250;
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
    },
    newSessionId: () => randomUUID(),
    onTurnEnded: (sessionId, callback) => registerCompletionHook(sessionId, (outcome) => callback(outcome)),
    runCheck,
    askCommand: (runId, stepId, sessionId) => askCommand(PORT, runId, stepId, sessionId),
    newRunId: () => randomUUID(),
    now: () => Date.now(),
    isTrusted: (dir) => claudeTrusts(dir),
    projectFiles,
    // The app's own teardown: the pty, the tmux session and everything it remembered about it. Marked
    // placed as well, for a session an earlier version put on the grid.
    closeSession: (sessionId) => {
      markSessionPlaced(sessionId);
      reap(sessionId);
    },
  });
  const ownedExecutor = lockedExecutor(executor);
  ownedExecutor.ensureOwner().catch((err: unknown) => console.error(`[blueprint] not driving runs: ${err instanceof Error ? err.message : String(err)}`));
  mountMarketRoutes(app, {
    builtinRoot: PACK_ROOTS[0] ?? { dir: PACKS_ROOT, source: "builtin" },
    packsDir: INSTALLED_PACKS_DIR,
    registriesFile: registriesFile(MULMOTERMINAL_HOME),
    clone: cloneRepo,
    now: () => Date.now(),
  });
  mountBlueprintRoutes(app, {
    executor: ownedExecutor.executor,
    ensureOwner: ownedExecutor.ensureOwner,
    packRoots: PACK_ROOTS,
    now: () => Date.now(),
    isTrusted: (dir) => claudeTrusts(dir),
  });
}

// Taking the lock recovers the runs, so a server that takes over from a dead holder first settles the
// sessions that holder left behind. Every change re-reads the lock: one lost to another server is
// noticed, and refused, rather than acted on. Reads work either way.
function lockedExecutor(executor: BlueprintExecutor): { executor: BlueprintExecutor; ensureOwner: () => Promise<void> } {
  const self = { pid: process.pid, port: String(PORT), token: randomUUID() };
  let owning: Promise<void> | null = null;
  const refuseFor = (holder: { port: string }): BlueprintRefusal =>
    new BlueprintRefusal(`blueprints on this machine are run by the MulmoTerminal on port ${holder.port}; make changes there`);
  const takeOwnership = async (): Promise<void> => {
    await mkdir(path.dirname(LOCK_FILE), { recursive: true });
    const decision = await acquireLock(LOCK_FILE, self);
    if (decision.kind === "held") throw refuseFor(decision.holder);
    // Two servers replacing a dead holder's lock at once can each delete the other's; the one whose
    // lock survives a moment later is the owner, and only it recovers.
    await new Promise((resolve) => setTimeout(resolve, TAKEOVER_SETTLE_MS));
    const settled = await confirmLock(LOCK_FILE, self);
    if (settled.kind === "held") throw refuseFor(settled.holder);
    await executor.recover(endOrphanedSession);
  };
  const ensureOwner = async (): Promise<void> => {
    if (owning) {
      await owning;
      if (await holdsLock(LOCK_FILE, self)) return;
      owning = null;
    }
    owning ??= takeOwnership().catch((err: unknown) => {
      owning = null;
      throw err;
    });
    return owning;
  };
  const owned =
    <A extends unknown[], R>(action: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await ensureOwner();
      return action(...args);
    };
  return {
    ensureOwner,
    executor: {
      view: (runId) => executor.view(runId),
      list: () => executor.list(),
      specView: (runId) => executor.specView(runId),
      recover: owned((endSession: Parameters<BlueprintExecutor["recover"]>[0]) => executor.recover(endSession)),
      create: owned((request: Parameters<BlueprintExecutor["create"]>[0]) => executor.create(request)),
      humanEvent: owned((...args: Parameters<BlueprintExecutor["humanEvent"]>) => executor.humanEvent(...args)),
      ask: owned((...args: Parameters<BlueprintExecutor["ask"]>) => executor.ask(...args)),
      say: owned((...args: Parameters<BlueprintExecutor["say"]>) => executor.say(...args)),
    },
  };
}
