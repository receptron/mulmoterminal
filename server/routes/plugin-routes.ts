// The three GUI-plugin tool routes this server answers itself, rather than through a plugin
// package's own router.
//
// All three MUST be mounted before mountAllRoutes' /api/plugin/:toolName catch-all, which
// would otherwise take them. Their failure reporting is narration by contract — see
// plugin-narration.ts for why a failed tool call must still be a 200.
import { randomUUID } from "node:crypto";
import type { Express } from "express";

import { CLAUDE_CWD, PORT } from "../config/env.js";
import { messageOf } from "../errors.js";
import { isRecord } from "../../common/isRecord.js";
import { backgroundMarkers, markFailedWorker, markUnplacedSession, rememberSessionCollection } from "../session/registry.js";
import { runWithHiddenMarker } from "../session/hiddenMarker.js";
import { registerCompletionHook } from "../session/completion-hooks.js";
import { backgroundChatMessage, parseBackgroundChat, spawnModeFor, type SpawnMode } from "../session/background-chat.js";
import type { TerminalAgent } from "../../common/sessionAgent.js";
import { registeredGuiMcpGroups } from "../infra/gui-mcp-registration.js";
import { resolveSpawnCollection } from "../session/spawn-collection.js";
import { TOOL_GROUPS, type ToolGroup } from "../../common/toolGroups.js";
import { codexifySkillSeed } from "../agents/codex-skills.js";
import { SESSION_HEADER, sessionIdFromHeader } from "../backends/presentPathRoot.js";
import { cwdForSession } from "../session/session-cwd.js";
import { projectScopeForCwd, rootForProjectId } from "../infra/project-root.js";
import { manageCollectionHandlerFor } from "../infra/collection-tool.js";
import { runRenderShapeScript } from "../infra/shapescript-render-tool.js";
import { runExportShapeScriptUsdz } from "../infra/shapescript-usdz-tool.js";
import { manageSharedApp } from "../infra/shared-app-tool.js";
import { useSharedApp } from "../infra/use-shared-app-tool.js";
import { upstreamFailureMessage } from "./plugin-narration.js";
import type { SpawnClaudePty, SpawnCodexPty, SpawnAntigravityPty, SpawnGrokPty, SpawnMusePty } from "../session/spawners.js";

export interface PluginRouteDeps {
  spawnClaudePty: SpawnClaudePty;
  spawnCodexPty: SpawnCodexPty;
  spawnAntigravityPty: SpawnAntigravityPty;
  spawnGrokPty: SpawnGrokPty;
  spawnMusePty: SpawnMusePty;
  /** Put a hidden spawn on the scheduled-session retention (#541). Nobody watches a
   *  background worker and the chat list keeps it behind a filter, so the hook-driven reap
   *  is the only thing that would ever end it — and a worker blocked on a permission prompt
   *  never fires the hook that starts it. */
  registerBackgroundSession: (id: string) => void;
}

// Which agent to start, and how the seed reaches it — one switch over SpawnMode, so an agent added
// to TERMINAL_AGENTS reaches this as a mode with no case rather than as a silent claude spawn.
//
// ws is null on every branch: the session runs headless until the user opens it (a reattach replays
// the buffered output). A claude DRAFT spawns with no initial prompt, so it does not auto-run, and
// the text is typed into its input box afterwards; the other agents have no editable-draft path (no
// stable TUI ready-marker), so their seed always auto-runs as a first-turn prompt — codex typed in,
// agy through `--prompt-interactive`, grok and muse as a positional.
function spawnSeededSession(
  deps: PluginRouteDeps,
  mode: SpawnMode,
  { sessionId, message, mcpGroups, cwd }: { sessionId: string; message: string; mcpGroups: readonly ToolGroup[]; cwd: string },
): void {
  // GUI MCP: every branch below keeps the full toolset regardless of the directory, and that is a
  // decision rather than an oversight. `carriesFullGuiMcp()` is consulted inside each spawner —
  // claude's `attachGuiMcp` defaults true and codex is passed `true` here — so a seeded chat gets
  // the generated `--mcp-config` even when it runs in a project directory, where a plain CELL
  // would instead read the user's own `.mcp.json`.
  //
  // Why that asymmetry is right: this chat exists because a GUI action asked for it, and the seed
  // it carries names collection paths and expects the collection tools. A cell the user opened in
  // that directory has made no such request. The agents that read their groups from a file in the
  // directory get them from `groupsForSpawn(agent, cwd)` instead, which is the per-directory
  // mechanism that DOES have to follow the cwd.
  const initialPrompt = codexifySkillSeed(message);
  if (mode === "codex-run") deps.spawnCodexPty(sessionId, null, null, cwd, true, { initialPrompt });
  else if (mode === "antigravity-run") deps.spawnAntigravityPty(sessionId, null, null, cwd, { mcpGroups, initialPrompt });
  else if (mode === "grok-run") deps.spawnGrokPty(sessionId, null, null, cwd, { mcpGroups, initialPrompt });
  else if (mode === "muse-run") deps.spawnMusePty(sessionId, null, null, cwd, { mcpGroups, initialPrompt });
  else if (mode === "claude-draft") deps.spawnClaudePty(sessionId, null, null, { draft: message, cwd });
  else deps.spawnClaudePty(sessionId, null, null, { initialPrompt: message, cwd });
}

/** Where a seeded chat runs: the project it was started from, or the workspace when it named
 *  none. `null` means the request named a project this server does not know — refused rather than
 *  quietly spawned in the workspace, which is the substitution the rest of this surface refuses.
 *
 *  The id is resolved against the server's OWN list of directories; it is never a path. */
function spawnCwdFor(project: string | null): string | null {
  return project === null ? CLAUDE_CWD : rootForProjectId(project);
}

/** The GUI MCP groups a seeded spawn must be handed, resolved from the directory it will run in.
 *
 *  The agents that read their GUI MCP servers from a FILE in the working directory — agy's
 *  `.agents/mcp_config.json` and grok's `.grok/config.toml` — share that file with every other
 *  session running there, so the groups have to be resolved BEFORE the spawn rewrites it: passing
 *  none would clear the entries those sessions are using (#1095 review).
 *
 *  Which agents need them resolved here: the ones that do not get a per-spawn `--mcp-config`. agy
 *  and grok write them into a config file in the directory; muse takes them as its session's
 *  entitlement (server/session/bridge-session.ts) — and it was left out of this list when it was
 *  wired, so a background muse chat got an empty list and therefore no GUI tools, in a workspace
 *  that had them registered (Codex review on #1514).
 *
 *  Read from the SPAWN's directory, not the workspace: those config files live in the directory
 *  the session runs in, so a chat spawned in a project must be told what that project registered. */
async function groupsForSpawn(agent: TerminalAgent, cwd: string): Promise<readonly ToolGroup[]> {
  const needsGroups = agent === "antigravity" || agent === "grok" || agent === "muse";
  return needsGroups ? await registeredGuiMcpGroups(cwd, TOOL_GROUPS).catch(() => []) : [];
}

export function mountPluginRoutes(app: Express, deps: PluginRouteDeps): void {
  // Host tool: spawnBackgroundChat. Unlike a plugin (handled by mountAllRoutes'
  // catch-all), it needs server internals — it spawns a brand-new interactive Claude
  // terminal session, seeded with `message`, that the user can open from the sidebar.
  // `role` is ignored (MulmoTerminal has no roles). `hidden:true` marks it a background
  // worker: it still lists in the sidebar, but behind the Background filter and never
  // bold/unread. `draft:true` makes `message` an editable DRAFT — typed into the input box
  // but NOT auto-submitted (the collection-plugin's startNewChatDraft / template cards),
  // so the user reviews and presses Enter.
  app.post("/api/plugin/spawnBackgroundChat", async (req, res) => {
    const parsed = parseBackgroundChat(req.body);
    if (!parsed.ok) return res.json({ message: parsed.message });
    const { agent, collection, draft, hidden, message, project } = parsed.request;
    const cwd = spawnCwdFor(project);
    if (cwd === null) return res.json({ message: `spawnBackgroundChat: unknown project '${project?.replace(/[\r\n]/g, " ") ?? ""}'.` });
    const sessionId = randomUUID();
    // Resolved alongside the MCP-group read that was already being awaited here. What this await
    // buys is that the record is IN MEMORY before the id goes back: the browser places the cell the
    // moment it arrives and reads /api/session/:id exactly ONCE at mount, so a record that lands a
    // tick afterwards leaves that cell unmarked until some later turn happens to refresh it (#2020).
    // The DISK append is deliberately not awaited — see rememberSessionCollection for why a lost
    // one costs a glyph after a restart and nothing the caller could act on.
    const [mcpGroups, startedFrom] = await Promise.all([groupsForSpawn(agent, cwd), resolveSpawnCollection(collection, cwd)]);
    try {
      runWithHiddenMarker(hidden, sessionId, backgroundMarkers, () =>
        spawnSeededSession(deps, spawnModeFor(agent, draft), { sessionId, message, mcpGroups, cwd }),
      );
      // After the spawn, like the marks below: a launch that threw has no session, and a record
      // for one would sit in the log forever describing nothing.
      if (startedFrom) rememberSessionCollection(sessionId, startedFrom);
      // Visible: somebody should be able to SEE this session. The browser that asked for it
      // places it immediately (useChatLauncher), and this covers every other caller — an agent
      // calling the tool from another session, with no tab open at all. The mark is cleared the
      // moment any cell attaches, so the browser-placed case does not come back as a duplicate.
      if (!hidden) markUnplacedSession(sessionId, agent);
      if (hidden) {
        deps.registerBackgroundSession(sessionId);
        // A hidden worker is invisible on purpose, which is exactly why a FAILED one needs a
        // record: nothing pulls the user's attention and nothing waits to be clicked, so the
        // failure is otherwise never learned. The completion hook is the existing seam for it —
        // a finished turn reports success first and this never fires; reaching teardown with no
        // Stop means no turn ever completed (see completion-hooks.ts for why first-answer-wins).
        //
        // Registered AFTER the spawn: a launch that threw has no session to report on, and would
        // leave a hook nothing will ever fire or clear. Safe against the feeds engine's own hook
        // (last writer wins) because that dispatches through its own spawner, never this route.
        //
        // CLAUDE ONLY, and that is a correctness limit rather than a scope choice. The single
        // success signal a PTY-hosted agent gives us is a finished turn reported by Claude Code's
        // Stop hook (hook-routes.ts); codex and antigravity have no hook mechanism at all, so
        // they can never report success. Registering for them would mean every SUCCESSFUL hidden
        // codex worker reached reap unreported and was marked failed — a signal that is wrong
        // more often than it is right, which is worse than the silence it replaced.
        // (Codex, PR #1188.) A non-claude hidden worker therefore keeps today's behaviour: no
        // failure signal. Giving it one needs a completion signal for those agents first.
        //
        // RECORDS ONLY, and synchronously. Announcing is reap's job: it publishes one teardown
        // message carrying this outcome, which is what keeps the generic notification from
        // racing ahead of the specific one. Staying synchronous is therefore a contract, not an
        // implementation detail — reap reads the flag immediately after firing this.
        if (agent === "claude") {
          registerCompletionHook(sessionId, ({ didError }) => {
            if (didError) markFailedWorker(sessionId);
          });
        }
      }
    } catch (err) {
      console.error(`[spawnBackgroundChat] failed for ${sessionId}: ${messageOf(err)}`);
      return res.json({ message: `Failed to spawn a new session: ${messageOf(err)}` });
    }
    return res.json({ message: backgroundChatMessage(agent, draft, sessionId), jsonData: { chatId: sessionId, agent } });
  });

  // Host tool: manageAccounting. The accounting package exposes no gui-chat-protocol
  // `.` core (just the Vue View + the /api/accounting router), so — like MulmoClaude's
  // host-side passthrough execute — this route bridges the GUI MCP tool to that router.
  // The router's envelope ({ action, ...data, message }) flows straight back to the
  // broker: `data` (set for PREVIEW actions) gates the GUI publish, `message` narrates
  // to claude.
  app.post("/api/plugin/manageAccounting", async (req, res) => {
    try {
      const upstream = await fetch(`http://127.0.0.1:${PORT}/api/accounting`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isRecord(req.body) ? req.body : {}),
      });
      const body: unknown = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        // A refused request is only ever narrated to the agent, so without this it leaves no
        // trace on the server at all — and a router answering `{ error: "" }` leaves none with
        // the agent either. "Could not connect" is logged below; "connected and was refused"
        // should be too.
        const message = upstreamFailureMessage(upstream.status, body, "accounting request failed");
        console.error(`[manageAccounting] upstream ${upstream.status}: ${message || "(no message)"}`);
        return res.json({ message });
      }
      return res.json(body);
    } catch (err) {
      console.error(`[manageAccounting] dispatch failed: ${messageOf(err)}`);
      return res.json({ message: `accounting dispatch failed: ${messageOf(err)}` });
    }
  });

  mountCollectionRoute(app);
  mountRenderShapeScriptRoute(app);
  mountExportShapeScriptUsdzRoute(app);
  mountSharedAppRoute(app);
  mountUseSharedAppRoute(app);
}

/** Split out of `mountPluginRoutes` for its line budget. Both of these are host-tool dispatch
 *  routes and belong beside each other; only the enclosing function's size moved them out. */
function mountCollectionRoute(app: Express): void {
  // Host tool: manageCollection — the shared collection data plane
  // (@mulmoclaude/core/collection/server, bound in server/infra/collection-tool.ts).
  // The engine runs in-process against the configured workspace, so the route calls the
  // handler directly. The result string (JSON for the read/write actions) narrates to claude
  // via the envelope `message`; no `data`, so nothing publishes to the GUI — same as
  // MulmoClaude.
  app.post("/api/plugin/manageCollection", async (req, res) => {
    try {
      // Scoped to the SESSION's directory, not the workspace. An agent asked to make a
      // collection "here" means the folder its cell is open in, and the workspace-bound handler
      // silently made it somewhere else — the read/write surface was scoped per request while
      // this, the agent's own data plane, still resolved one fixed root.
      //
      // The session id rides in a header from the MCP broker, and `cwdForSession` is the same
      // lookup presentDocument's relative paths already resolve through, so the tool and the
      // documents it produces agree on where "here" is.
      const sessionId = sessionIdFromHeader(req.get(SESSION_HEADER));
      const handler = manageCollectionHandlerFor(projectScopeForCwd(cwdForSession(sessionId)).workspaceRoot);
      const message = await handler(isRecord(req.body) ? req.body : {});
      return res.json({ message });
    } catch (err) {
      console.error(`[manageCollection] dispatch failed: ${messageOf(err)}`);
      return res.json({ message: `manageCollection failed: ${messageOf(err)}` });
    }
  });
}

function mountRenderShapeScriptRoute(app: Express): void {
  // Host tool: renderShapeScript — rasterise a ShapeScript model to a PNG the agent
  // can read back. Unlike manageCollection this is NOT session-scoped: the image is a
  // by-product of a model, it goes to the workspace artifacts root beside the `.shape`
  // files presentShapeScript saves, and the tool answers with an ABSOLUTE path so a
  // session in any project directory can open it.
  app.post("/api/plugin/renderShapeScript", async (req, res) => {
    try {
      const { message } = await runRenderShapeScript(isRecord(req.body) ? req.body : {});
      return res.json({ message });
    } catch (err) {
      // A bad argument or an unrenderable model is the agent's to fix, so the reason
      // goes back as the envelope message rather than as a transport error.
      console.error(`[renderShapeScript] dispatch failed: ${messageOf(err)}`);
      return res.json({ message: `renderShapeScript failed: ${messageOf(err)}` });
    }
  });
}

function mountExportShapeScriptUsdzRoute(app: Express): void {
  // Host tool: exportShapeScriptUsdz — write a ShapeScript model out as a USDZ file
  // the user can open in AR. Workspace-scoped like renderShapeScript, not session-
  // scoped: the file lands beside the `.shape` sources under the artifacts root, and
  // the tool answers with an ABSOLUTE path so a session in any project can find it.
  app.post("/api/plugin/exportShapeScriptUsdz", async (req, res) => {
    try {
      const { message } = await runExportShapeScriptUsdz(isRecord(req.body) ? req.body : {});
      return res.json({ message });
    } catch (err) {
      // A bad argument or a model that will not evaluate is the agent's to fix, so the
      // reason goes back as the envelope message rather than as a transport error.
      console.error(`[exportShapeScriptUsdz] dispatch failed: ${messageOf(err)}`);
      return res.json({ message: `exportShapeScriptUsdz failed: ${messageOf(err)}` });
    }
  });
}

function mountSharedAppRoute(app: Express): void {
  // Host tool: manageSharedApp — deploy / publish / unpublish for the shared app declared by the
  // repository's app.json (server/infra/shared-app-tool.ts). MulmoTerminal's own; there is no
  // counterpart in MulmoClaude to match, which is the point of the tool existing here.
  //
  // Scoped to the SESSION's directory for the same reason manageCollection is: an app is a
  // REPOSITORY, and "deploy this app" means the one the cell is open in. Resolving it to the
  // workspace would deploy a different app than the agent is looking at — and unlike a misplaced
  // collection, that one is visible to other people the moment it lands.
  app.post("/api/plugin/manageSharedApp", async (req, res) => {
    try {
      const sessionId = sessionIdFromHeader(req.get(SESSION_HEADER));
      const root = projectScopeForCwd(cwdForSession(sessionId)).workspaceRoot;
      return res.json({ message: await manageSharedApp(root, req.body) });
    } catch (err) {
      console.error(`[manageSharedApp] dispatch failed: ${messageOf(err)}`);
      return res.json({ message: `manageSharedApp failed: ${messageOf(err)}` });
    }
  });
}

function mountUseSharedAppRoute(app: Express): void {
  // Host tool: useSharedApp — taking part in an app somebody ELSE published
  // (server/infra/use-shared-app-tool.ts).
  //
  // NOT scoped to the session's directory, and that is the difference from the route above rather
  // than an omission. `manageSharedApp` operates on the repository the cell is open in, because an
  // app IS a repository; this one operates on an app named by its URL name, whose declaration and
  // records live in Firestore and nowhere on this machine. Resolving a root here would suggest the
  // directory decided something, and nothing about a cell's directory may change what a person is
  // allowed to do inside somebody else's app — that is the deployed rules' answer about the
  // signed-in identity, and it is the same in every cell.
  //
  // The SESSION is passed, and it is the one thing about the caller this tool is allowed to know.
  // `watch` outlives its own call: what it produces is typed into a terminal minutes later, so it
  // has to be told which one. Nothing else here reads it, and it must not become a way for a cell's
  // identity to change what a person may do — that answer is the rules', and it is the same
  // everywhere (see the note above).
  app.post("/api/plugin/useSharedApp", async (req, res) => {
    try {
      // NORMALIZED, not forwarded. A header is an assertion by whatever reached this route, and for
      // `watch` an unchecked one is not a wrong directory but a live Firestore listener attached on
      // behalf of a session that does not exist — unreapable, billed to the app's owner, and, with a
      // different made-up value each time, not subject to the per-session ceiling either. `watch`
      // additionally requires the id to name a LIVE pty (`startWatch`).
      //
      // WHAT THIS IS NOT is authorization, and it is worth being exact about what remains. A caller
      // that knows ANOTHER live session's id can still aim a watch at that terminal. Three things
      // bound what that is worth: this server is reachable only from this machine (loopback — see
      // infra/loopback-listener.ts, and `isAllowedOrigin` trusts an Origin-less request only from a
      // loopback peer), every session on it belongs to the SAME local user, and the line a watch
      // types is a fixed string naming itself as mulmoterminal's, carrying none of the app's data.
      // So the actor is a local process already running as that user, and the effect is a
      // self-identifying line in another of their own terminals.
      //
      // The header has never been more than an assertion, for any of the three routes here: the two
      // above resolve ANOTHER session's directory from it just as readily, and write there. Making
      // it a binding means the broker minting a per-session secret and all three routes demanding
      // it — a change to what the header IS, not to this route, and one that has to be made once for
      // all of them rather than in the middle of a feature (Codex on #1844).
      return res.json({ message: await useSharedApp(req.body, sessionIdFromHeader(req.get(SESSION_HEADER)) ?? undefined) });
    } catch (err) {
      console.error(`[useSharedApp] dispatch failed: ${messageOf(err)}`);
      return res.json({ message: `useSharedApp failed: ${messageOf(err)}` });
    }
  });
}
