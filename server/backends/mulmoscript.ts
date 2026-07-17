// Host wiring for @mulmoclaude/mulmoscript-plugin (presentMulmoScript) — phase 3b
// of mulmoclaude's plans/feat-mulmoscript-plugin.md. The heavy ops layer (mulmocast
// render/movie/PDF orchestration, realpath containment, generation tracking, the
// dispatch kind router) lives in the package's `./server` entry; this module
// supplies MulmoTerminal's backend (stories dir, artifacts FileOps, atomic write,
// ffmpeg probe, generation fan-out to the plugin pubsub) and mounts two routes:
//
//   1. POST /api/plugin/presentMulmoScript — intercepts BOTH the View's
//      `useRuntime().dispatch({kind,…})` calls (routed to the package's dispatch
//      handler) and the LLM tool-call (no `kind`; save/reopen via the phase-1 core
//      execute, wrapped with the ops' realpath guard + the `autoGenerateMovie`
//      background trigger — the generic catch-all would apply only the core's
//      lexical guard and ignore the flag). MUST be registered BEFORE mountAllRoutes.
//   2. GET /api/mulmoscript/media — movie/PDF bytes for the View's host-adapter
//      `fetchMediaBlob` (a plain <video src> can't ride the dispatch envelope).
//      Wire paths resolve through the ops' realpath containment (resolveStory).
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import type { Express, Request, Response } from "express";
import {
  createMulmoScriptServerOps,
  createMulmoScriptDispatchHandler,
  executeMulmoScriptSave,
  GENERATION_EVENT,
  type MulmoScriptServerOps,
  type MulmoScriptDispatchHandler,
} from "@mulmoclaude/mulmoscript-plugin/server";
import type { SaveMulmoScriptArgs } from "@mulmoclaude/mulmoscript-plugin";
import { artifactsFileOps } from "./artifacts.js";

/** Pubsub channel the extracted View subscribes to for generation progress —
 *  `plugin:<scope>:<event>`, matching the client runtime's channel formula
 *  (src/composables/pluginRuntime.ts) with scope "mulmoScript". */
const GENERATION_CHANNEL = `plugin:mulmoScript:${GENERATION_EVENT}`;

interface PubSubLike {
  publish(channel: string, data: unknown): void;
}

let ops: MulmoScriptServerOps | null = null;
let dispatchHandler: MulmoScriptDispatchHandler | null = null;

// undefined = probe not finished yet; the ops treat that as "assume available"
// so the startup window never blocks a render (mirrors mulmoclaude's depStatus).
let ffmpegAvailable: boolean | undefined;

function probeFfmpeg(): void {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'ffmpeg' is deliberately resolved from PATH (that's what the probe checks); fixed argv, no shell
  execFile("ffmpeg", ["-version"], (err) => {
    ffmpegAvailable = !err;
    if (err) console.warn("[mulmo-script] ffmpeg not found — movie and beat rendering will be unavailable");
  });
}

// Atomic write for mulmocast outputs (tmp alongside the destination + rename,
// parents created). The tmp suffix is per-write so concurrent generations of
// different assets can never collide on it.
let writeSeq = 0;
async function writeFileAtomic(absolutePath: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const tmp = `${absolutePath}.${process.pid}.${++writeSeq}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, absolutePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Create the ops instance against the workspace + pubsub. Call once at boot
 *  (server/index.ts), after initArtifactsBackend — the routes below 503 until
 *  then. */
export function initMulmoScriptBackend(deps: { workspace: string; pubsub: PubSubLike | null }): void {
  ops = createMulmoScriptServerOps({
    storiesDir: path.resolve(deps.workspace, "artifacts", "stories"),
    artifacts: artifactsFileOps,
    writeFileAtomic,
    isFfmpegAvailable: () => ffmpegAvailable,
    // Edge-triggered by the package's tracker; MulmoTerminal has no per-session
    // generation indicator, so the plugin channel (View spinners +
    // reload-on-finish) is the only consumer.
    onGenerationEvent: (_chatSessionId, event) => {
      deps.pubsub?.publish(GENERATION_CHANNEL, event);
    },
    log: {
      info: (message, data) => console.info(`[mulmo-script] ${message}`, data ?? ""),
      warn: (message, data) => console.warn(`[mulmo-script] ${message}`, data ?? ""),
      error: (message, data) => console.error(`[mulmo-script] ${message}`, data ?? ""),
    },
  });
  dispatchHandler = createMulmoScriptDispatchHandler(ops);
  probeFfmpeg();
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function failureStatus(code: "bad_request" | "not_found" | "server_error" | "unavailable"): number {
  if (code === "not_found") return 404;
  if (code === "bad_request") return 400;
  return 500;
}

function stringQuery(req: Request, name: string): string | null {
  const value = req.query[name];
  return typeof value === "string" && value !== "" ? value : null;
}

// The LLM tool-call (save new / reopen existing). Mirrors mulmoclaude's save
// route: realpath containment BEFORE the core's lexical guard, then the
// phase-1 execute, then the host-side `autoGenerateMovie` trigger (the dedup
// key is the realpath, so re-resolve the wire path). Failures answer as
// `{ message }` (HTTP 200) so the agent reads them and can self-correct.
async function handleToolCall(body: Record<string, unknown>, res: Response, instance: MulmoScriptServerOps): Promise<void> {
  const guard = instance.guardStoryWirePath(body.filePath);
  if (guard) {
    res.json({ message: guard.error });
    return;
  }
  const outcome = await executeMulmoScriptSave({ files: { artifacts: instance.backend.artifacts } }, body as SaveMulmoScriptArgs);
  if (!outcome.ok) {
    res.json({ message: outcome.error, instructions: "Acknowledge the error and retry with a valid `script` (new) or an existing `filePath`." });
    return;
  }
  if (body.autoGenerateMovie === true) {
    const resolved = instance.resolveStory(outcome.filePath);
    if (resolved.ok) {
      instance.triggerAutoBackgroundMovie(resolved.absolutePath, outcome.filePath, undefined);
    }
  }
  res.json({
    data: { script: outcome.script, filePath: outcome.filePath },
    message: outcome.message,
    instructions: "Display the storyboard to the user.",
  });
}

/** Intercept POST /api/plugin/presentMulmoScript for both the View's dispatch
 *  (`kind` present → the package's kind router) and the tool-call (no `kind`).
 *  Handles everything itself — MUST be registered BEFORE mountAllRoutes so the
 *  generic catch-all (lexical guard only, no movie trigger) never runs for
 *  this tool. */
export function mountMulmoScriptDispatchRoute(app: Express): void {
  app.post("/api/plugin/presentMulmoScript", async (req: Request, res: Response) => {
    if (!ops || !dispatchHandler) {
      res.status(503).json({ error: "mulmoScript backend not initialised" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      if (typeof body.kind === "string") {
        res.json(await dispatchHandler(body));
      } else {
        await handleToolCall(body, res, ops);
      }
    } catch (err) {
      res.status(500).json({ error: messageOf(err) });
    }
  });
}

/** GET /api/mulmoscript/media?moviePath=…|pdfPath=… — bytes for the View's
 *  `fetchMediaBlob` host adapter. Exactly one of the two wire paths is set
 *  (both are `stories/…` refs from the status/probe dispatches); traversal and
 *  symlink escapes are rejected by the ops' realpath containment. */
export function mountMulmoScriptMediaRoute(app: Express): void {
  app.get("/api/mulmoscript/media", (req: Request, res: Response) => {
    if (!ops) {
      res.status(503).json({ error: "mulmoScript backend not initialised" });
      return;
    }
    const wirePath = stringQuery(req, "pdfPath") ?? stringQuery(req, "moviePath");
    if (!wirePath) {
      res.status(400).json({ error: "moviePath or pdfPath is required" });
      return;
    }
    const resolved = ops.resolveStory(wirePath);
    if (!resolved.ok) {
      res.status(failureStatus(resolved.code)).json({ error: resolved.error });
      return;
    }
    res.download(resolved.absolutePath);
  });
}
