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
  SCRIPT_CHANGED_EVENT,
  type MulmoScriptServerOps,
  type MulmoScriptDispatchHandler,
} from "@mulmoclaude/mulmoscript-plugin/server";
import type { MulmoScriptExecuteContext, SaveMulmoScriptArgs } from "@mulmoclaude/mulmoscript-plugin";
import { artifactsFileOps } from "./artifacts.js";
import { mulmoScriptByPath } from "./openPath.js";
import { createFileOps } from "./fileOps.js";
import { storiesRootId } from "./storiesRoot.js";
import { uniqueRootPaths } from "./storiesRootSet.js";
import { canonicalPath } from "../infra/canonical-path.js";
import { isRecord } from "../../common/isRecord.js";

/** Pubsub channel the extracted View subscribes to for generation progress —
 *  `plugin:<scope>:<event>`, matching the client runtime's channel formula
 *  (src/composables/pluginRuntime.ts) with scope "mulmoScript". */
const GENERATION_CHANNEL = `plugin:mulmoScript:${GENERATION_EVENT}`;

/** Same formula, for "this script was written" — what makes an agent's edit appear in a
 *  canvas that is already open, instead of only after the user reopens it. */
const SCRIPT_CHANGED_CHANNEL = `plugin:mulmoScript:${SCRIPT_CHANGED_EVENT}`;

interface PubSubLike {
  publish(channel: string, data: unknown): void;
}

let ops: MulmoScriptServerOps | null = null;
/** The named stories root this server actually registered with the plugin, or null before boot. */
let registeredRoots: Array<{ id: string; paths: string[] }> = [];

/** What the browser is told about the named stories root: the id a Canvas card must carry, and
 *  every spelling of the workspace it may compare a file against. The REGISTERED value, never
 *  re-derived — see initMulmoScriptBackend. Null until the backend is initialised, which reads as
 *  "no named root" and is exactly the behaviour before #1933. */
export const registeredStoriesRoots = (): ReadonlyArray<{ id: string; paths: readonly string[] }> => registeredRoots;
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
 *  then. `isFfmpegAvailable` is overridable for tests; the default is the
 *  async PATH probe above. */
export function initMulmoScriptBackend(deps: {
  workspace: string;
  extraRoots?: readonly string[];
  pubsub: PubSubLike | null;
  isFfmpegAvailable?: () => boolean | undefined;
}): void {
  // One named root: the WORKSPACE — which the launcher sets to the directory the user ran the
  // command in. A root is a SUBTREE, so this one covers every repository beneath it, and a deck
  // can live next to the notes it was written from instead of in the workspace's own stories
  // directory (receptron/mulmoclaude#3014). The plugin strips the `stories/` segment before it
  // reaches this FileOps, so `stories/myrepo/decks/talk.json` reads AND writes
  // `<workspace>/myrepo/decks/talk.json` — one addressing rule for both sides (#3020).
  // Canonicalised ONCE, and the id derived from that same value: `storiesRootId` realpaths, so
  // recomputing it later (a config request, say) can answer differently the moment a workspace
  // symlink is retargeted — and an id the plugin never registered is a `bad_request` on every card
  // that carries it (CodeRabbit on #1934). What was registered is what `registeredStoriesRoot`
  // hands the browser.
  // Every directory the user launches in, not just the workspace (#1951). A deck kept in an
  // ordinary repository was found and correctly refused, because nothing outside the one
  // registered root can be opened at all.
  //
  // Registered ONCE, here, because `createMulmoScriptServerOps` copies `extraRoots` into its own
  // map at construction AND is documented as one instance per process — it owns the in-flight
  // movie/PDF dedup sets and the generation-state tracker. Adding a root later means a new
  // instance, which means throwing those away mid-render. So the set is what boot knows, and a
  // directory first opened afterwards needs a restart. That trade is the plan's option A.
  // Grouped by the CANONICAL path, which is the key the id is derived from. Deduplicating by the
  // lexical path is not enough: a preset that is a symlink to the workspace resolves to a different
  // string and realpaths to the same directory, so it registered a SECOND root carrying the FIRST
  // one's id — two entries, one id, and one of the two directories silently dropped from
  // `extraRoots`. Found by reading this back rather than by a review bot.
  //
  // Merging them is also the right answer for the browser: the spellings become one root's `paths`,
  // which is exactly what the workspace's own two spellings already are.
  const byCanonical = new Map<string, { id: string; paths: string[] }>();
  for (const dir of uniqueRootPaths([deps.workspace, ...(deps.extraRoots ?? [])])) {
    const canonical = canonicalPath(dir);
    const seen = byCanonical.get(canonical);
    if (seen) {
      if (!seen.paths.includes(dir)) seen.paths.push(dir);
      continue;
    }
    byCanonical.set(canonical, { id: storiesRootId(canonical), paths: [...new Set([dir, canonical])] });
  }
  const dirForId = new Map([...byCanonical].map(([canonical, root]) => [root.id, canonical]));
  // BOTH spellings travel to the browser: the one the user launched with reaches the Files pane
  // through a cell's cwd, and the resolved one reaches it through `git worktree list`. The client
  // gate is lexical, so knowing only one hides the Canvas entry for every deck under the other
  // (Codex P1 iter-5 on #1934). The plugin still resolves against the canonical directory.
  registeredRoots = [...byCanonical.values()];
  ops = createMulmoScriptServerOps({
    storiesDir: path.resolve(deps.workspace, "artifacts", "stories"),
    extraRoots: Object.fromEntries([...dirForId].map(([id, dir]) => [id, dir])),
    // Registration is the containment boundary and it is checked FIRST, so answering here for an
    // id we never registered would still not widen what is addressable. The guard is the lookup.
    artifactsFor: (root) => {
      const dir = dirForId.get(root);
      return dir === undefined ? null : createFileOps(() => dir, "mulmo-stories-root");
    },
    // This host keeps no per-session generation state: `onGenerationEvent` below drops
    // `chatSessionId` and publishes to pubsub, and nothing keys pending work on
    // `(kind, filePath, key)`. So two roots cannot collapse into one entry here, and the plugin's
    // fail-closed default — written for MulmoClaude's session store — would refuse generation in a
    // named root for a danger this host does not have.
    rootScopedGenerationState: true,
    artifacts: artifactsFileOps,
    // The host's opt-in to the ABSOLUTE `filePath` form (plugin 4.6.0): a `.json` MulmoScript
    // anywhere on disk — a deck kept in a repo, a script another tool wrote — instead of only the
    // ones under a registered stories directory. Without this the plugin refuses absolute paths,
    // which is what MulmoTerminal did through 4.5.2.
    //
    // It is root-independent, and cannot be otherwise: an absolute path is relative to nothing, so
    // no `extraRoots` id selects it. Relative `filePath`s are untouched and keep going through
    // `artifacts` / `artifactsFor` exactly as before.
    byPath: mulmoScriptByPath,
    writeFileAtomic,
    isFfmpegAvailable: deps.isFfmpegAvailable ?? (() => ffmpegAvailable),
    // Edge-triggered by the package's tracker; MulmoTerminal has no per-session
    // generation indicator, so the plugin channel (View spinners +
    // reload-on-finish) is the only consumer.
    onGenerationEvent: (_chatSessionId, event) => {
      deps.pubsub?.publish(GENERATION_CHANNEL, event);
    },
    // An agent — or another window — wrote this script. Every open View reloads from disk;
    // the one that made the write recognises its own `origin` on the event and skips it.
    onScriptChanged: (event) => {
      deps.pubsub?.publish(SCRIPT_CHANGED_CHANNEL, event);
    },
    log: {
      info: (message, data) => console.info(`[mulmo-script] ${message}`, data ?? ""),
      warn: (message, data) => console.warn(`[mulmo-script] ${message}`, data ?? ""),
      error: (message, data) => console.error(`[mulmo-script] ${message}`, data ?? ""),
    },
  });
  dispatchHandler = createMulmoScriptDispatchHandler(ops);
  if (!deps.isFfmpegAvailable) probeFfmpeg();
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
/**
 * The tool call's body, narrowed to what the package accepts.
 *
 * Built from checked fields rather than asserted: every field of `SaveMulmoScriptArgs` is
 * optional, so a body that is missing or mistypes one is a valid call the package rejects on its
 * own terms — while an assertion would hand it, say, a numeric `filePath` typed as a string.
 *
 * Which is also why leaving a field OUT of this list is silent rather than an error, and why
 * `beatIndex` / `beat` being absent from it was #1880: the package saw a plain re-display request,
 * answered "Loaded MulmoScript from …", and changed nothing — indistinguishable from success to
 * the agent that asked. The tool's own description tells agents to use that pair whenever the user
 * wants part of a presentation changed, so the path was documented and dead at the same time.
 *
 * Its own function so the route can be read at a glance, and so the ONE place that decides what
 * reaches the package is a thing a test can point at.
 */
function saveArgsFrom(body: Record<string, unknown>): SaveMulmoScriptArgs {
  return {
    ...(body.script !== undefined ? { script: body.script } : {}),
    ...(typeof body.filename === "string" ? { filename: body.filename } : {}),
    ...(typeof body.filePath === "string" ? { filePath: body.filePath } : {}),
    ...(typeof body.autoGenerateMovie === "boolean" ? { autoGenerateMovie: body.autoGenerateMovie } : {}),
    ...(typeof body.beatIndex === "number" ? { beatIndex: body.beatIndex } : {}),
    ...(body.beat !== undefined ? { beat: body.beat } : {}),
  };
}

// ── What the media route may serve for an ABSOLUTE deck ──────────────────────────────────────
//
// `GET /api/mulmoscript/media` takes a wire path and streams the file. That was safe while every
// wire path was `stories/…`: the ops resolve those inside a registered stories directory, so the
// route could only ever serve something under one. An absolute deck's movie and PDF have no such
// spelling (mulmocast writes them beside the script), so they arrive as absolute paths — and
// resolving those with no further question would let the route stream ANY existing `.mp4` /
// `.mov` / `.pdf` / `.json` on disk (Codex P1 on #1971).
//
// That matters here in a way it does not in MulmoClaude, whose equivalent route sits behind
// bearer auth. THIS SERVER HAS NO AUTHENTICATION — `bindSecurityWarning` says so in as many
// words — so on a non-loopback bind the only thing between a stranger and the file is this check.
// (Such a deployment is already fully exposed: the same stranger can start a terminal. That makes
// the exposure not-new, not acceptable — a route should not widen on the way past.)
//
// So the route serves back exactly the absolute paths it has already HANDED OUT: the movie / PDF
// refs a status, probe or generation dispatch answered with. Not a directory, not a prefix — the
// individual files, by canonical path.
//
// The deck's DIRECTORY was the first attempt and it was too wide: opening
// `/home/me/decks/talk.json` also authorized `/home/me/decks/private.json` and every `.pdf`
// below, for the life of the process, to anyone who could guess the name (Codex P1, second
// round). The paths above are the ones the feature actually needs — the View asks for a movie
// because a dispatch just told it where the movie is — and nothing else on disk is reachable
// through this route at all.
//
// Said precisely, because a security note that overclaims is worse than none: this does NOT
// authorize anything against a caller who can already POST to the dispatch route — such a caller
// asks for a status and is handed a path. What it does is stop the media route being a STANDALONE
// file reader, reachable with a bare GET and no prior request. Media follows the deck; it is not
// a door of its own.
//
// Canonical paths, because a lexical answer only constrains the string: `/a/./out.mp4` and a
// symlink to the same file are the same file, and the set has to say so.
const mintedAbsoluteMedia = new Set<string>();

/** The `moviePath` / `pdfPath` values in a dispatch answer, however deep the shape nests them.
 *
 *  Reads the RESPONSE rather than re-deriving where mulmocast would have written: the package owns
 *  that layout and moves it (`outputRef`, `freshOutputRef`, the generate ops), so a copy of the
 *  rule here would authorize the wrong file the day it changes. What was answered is what may be
 *  fetched — the two cannot drift, because they are one value. */
function collectMediaPaths(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || !isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if ((key === "moviePath" || key === "pdfPath") && typeof entry === "string" && entry !== "") out.push(entry);
    else if (Array.isArray(entry)) entry.forEach((item) => collectMediaPaths(item, out, depth + 1));
    else collectMediaPaths(entry, out, depth + 1);
  }
}

/** Remember every absolute media path a dispatch just answered with, so the View can fetch it.
 *  Relative ones need no entry — `resolveStory` already confines those to a stories root. */
function rememberMintedMedia(result: unknown): void {
  const paths: string[] = [];
  collectMediaPaths(result, paths);
  for (const value of paths) {
    if (path.isAbsolute(value)) mintedAbsoluteMedia.add(canonicalPath(value));
  }
}

/** Whether an absolute media path is one this server handed out. */
function servableAbsoluteMedia(absolutePath: string): boolean {
  return mintedAbsoluteMedia.has(canonicalPath(absolutePath));
}

/** The core execute context for a tool call, read off the BACKEND rather than rebuilt.
 *
 *  Both capabilities have to be the ones the ops layer was constructed with, or the tool call and
 *  the View's dispatch (which the package builds its own context for, from the same backend)
 *  answer differently for one file — the split that let an absolute `filePath` work in one and
 *  fail in the other. `byPath` is spread conditionally so an unset backend stays `undefined`
 *  rather than becoming an explicit `undefined` property under `exactOptionalPropertyTypes`.
 *
 *  Typed as the package's own `MulmoScriptExecuteContext` rather than a structural copy: the shape
 *  is the package's to change, and a copy here would keep compiling on the day it gains a member. */
function executeContextFor(instance: MulmoScriptServerOps): MulmoScriptExecuteContext {
  const { artifacts, byPath } = instance.backend;
  return { files: { artifacts, ...(byPath ? { byPath } : {}) } };
}

async function handleToolCall(body: Record<string, unknown>, res: Response, instance: MulmoScriptServerOps): Promise<void> {
  const guard = instance.guardStoryWirePath(body.filePath);
  if (guard) {
    res.json({ message: guard.error });
    return;
  }
  const args = saveArgsFrom(body);
  const outcome = await executeMulmoScriptSave(executeContextFor(instance), args);
  if (!outcome.ok) {
    res.json({ message: outcome.error, instructions: "Acknowledge the error and retry with a valid `script` (new) or an existing `filePath`." });
    return;
  }
  // A beat replacement rewrote a file the canvas may ALREADY have open, and the pubsub broadcast
  // is the only way that canvas hears about it — a new save gets redrawn because the response
  // tells the agent to display the story, which opens the new file, but replacing one beat of an
  // open story changes nothing on screen without this (#1880).
  //
  // Read off `args`, NOT off `body`, and the difference is not cosmetic: `args` is what the
  // package was actually handed, so the allowlist above and this condition cannot drift into
  // disagreeing. Asking `body` again re-derives the same decision twice — and a mutation proved
  // it, by restoring #1880's dropped allowlist and leaving these broadcasts green, publishing a
  // change to a file nothing had written.
  //
  // `executeMulmoScriptSave` does not report which branch it took, so this is the closest
  // available fact: the package requires the pair together (it refuses one without the other) and
  // `outcome.ok` is established, so "both reached it and the save succeeded" is "a beat was
  // written".
  //
  // No `origin`, deliberately. The package's own contract says why: "A View passes its own id on
  // every write and ignores the echo of its own … An agent write carries no origin, so every View
  // reloads." This IS an agent write, and inventing an id here would make some View treat our
  // broadcast as its own echo and skip the reload — the exact silence being fixed.
  if (args.beatIndex !== undefined && args.beat !== undefined) {
    instance.publishScriptChanged(outcome.filePath);
  }
  // The save succeeded either way; `movieNote` tells the agent whether the
  // requested background generation actually started. The package only
  // applies ffmpegGuard on the FOREGROUND generate ops — the background
  // trigger bypasses it — so gate here rather than kick off a job that is
  // doomed to fail encoding (Codex P2 on this route).
  let movieNote = "";
  if (body.autoGenerateMovie === true) {
    const ffmpeg = instance.ffmpegGuard();
    if (ffmpeg) {
      movieNote = ` (movie generation was NOT started: ${ffmpeg.error})`;
    } else {
      const resolved = instance.resolveStory(outcome.filePath);
      if (resolved.ok) {
        instance.triggerAutoBackgroundMovie(resolved.absolutePath, outcome.filePath, undefined);
        movieNote = " (movie generation started in the background)";
      }
    }
  }
  res.json({
    data: { script: outcome.script, filePath: outcome.filePath },
    message: `${outcome.message}${movieNote}`,
    instructions: "Display the storyboard to the user.",
  });
}

/**
 * Why the browser's own containment check cannot be the authority, and what stands in for it.
 *
 * The client decides whether to OFFER the Canvas from a lexical prefix test — it has no realpath.
 * The named root, meanwhile, is the directory this server resolved at boot and the plugin caches
 * that resolution. Those two can part company while the server runs: retarget the workspace
 * symlink and the file tree lists the NEW directory while the plugin still serves the old one, so
 * `stories/decks/talk.json` names one file on screen and a DIFFERENT file with the same relative
 * path on disk. Opening the wrong deck without saying so is the failure this whole feature has
 * been avoiding (Codex P1 iter-6 on #1934).
 *
 * So the browser sends the absolute path it actually saw, and the authority — the side that CAN
 * realpath — checks that the wire path still names that same file. A mismatch is refused with a
 * sentence rather than answered with the other file. `expectPath` is optional: a request without
 * it (the agent's own tool call) is unaffected.
 */
async function wirePathMismatch(body: Record<string, unknown>, instance: MulmoScriptServerOps): Promise<string | null> {
  const expectPath = body.expectPath;
  const filePath = body.filePath;
  if (typeof expectPath !== "string" || typeof filePath !== "string") return null;
  const root = typeof body.root === "string" ? body.root : undefined;
  const resolved = instance.resolveStory(filePath, root);
  // A path that does not resolve is the DISPATCH's business, not this check's: it answers with the
  // id it could not find ("unknown stories root \"…\"") where the ops' own text is a bare
  // "Unknown stories root". Letting it through keeps the more specific sentence, and this function
  // is left with the one case only it can see — a path that resolves to a DIFFERENT file.
  if (!resolved.ok) return null;
  const [served, seen] = await Promise.all([realpathOrNull(resolved.absolutePath), realpathOrNull(expectPath)]);
  if (served !== null && seen !== null && served === seen) return null;
  return "that deck is not the file this server serves under that path — the workspace may have moved since MulmoTerminal started; restart it to pick up the new one";
}

const realpathOrNull = async (p: string): Promise<string | null> => {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
};

/** Intercept POST /api/plugin/presentMulmoScript for both the View's dispatch
 *  (`kind` present → the package's kind router) and the tool-call (no `kind`).
 *  Handles everything itself — MUST be registered BEFORE mountAllRoutes so the
 *  generic catch-all (lexical guard only, no movie trigger) never runs for
 *  this tool. */
/** Drive the script-changed broadcast without a real write — the publish is the feature, and
 *  it has no other observable, so a test needs a way to reach it. */
export function publishMulmoScriptChangedForTest(filePath: string, origin?: string): void {
  ops?.publishScriptChanged(filePath, origin);
}

export function mountMulmoScriptDispatchRoute(app: Express): void {
  app.post("/api/plugin/presentMulmoScript", async (req: Request, res: Response) => {
    if (!ops || !dispatchHandler) {
      res.status(503).json({ error: "mulmoScript backend not initialised" });
      return;
    }
    const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
    try {
      const mismatch = await wirePathMismatch(body, ops);
      if (mismatch) {
        res.status(400).json({ ok: false, code: "bad_request", error: mismatch });
        return;
      }
      if (typeof body.kind === "string") {
        const result = await dispatchHandler(body);
        // Every absolute movie / PDF path this answer carries becomes fetchable through the media
        // route, and nothing else does — see `mintedAbsoluteMedia`. Only the kind router mints
        // them; the tool call answers a script and a filePath, never an output path.
        rememberMintedMedia(result);
        res.json(result);
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
    // An absolute wire path is only servable as the output of a deck this server opened — see
    // `openedAbsoluteDirs`. A relative one is already confined to a registered stories root by
    // `resolveStory`, and is unaffected.
    if (path.isAbsolute(wirePath) && !servableAbsoluteMedia(resolved.absolutePath)) {
      res.status(400).json({ error: "Invalid filePath" });
      return;
    }
    res.download(resolved.absolutePath);
  });
}
