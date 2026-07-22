// The terminal WebSocket endpoints: /ws (claude), /ws/run (a one-off command), /ws/launch
// (a configured launcher) and /ws/codex. Split from index.ts (#548 step 3e) — the last of
// the terminal machinery, and the composition root that ties the spawners, the connection
// plumbing and the session decisions together.
//
// What index.ts still owns arrives as deps: the http server whose upgrade event these hang
// off, the origin check, the working/waiting flags, and the spawners it built.
import type { IPty } from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { messageOf } from "../errors.js";
import { SESSION_ID_RE } from "../config/env.js";
import { resolveWorkspace } from "../config/workspace.js";
import { getHeaderConfig } from "../config/config-routes.js";
import { buildHeaderContext, loadHeaderConfig } from "../config/header-context.js";
import { resolveButtonCommand, shellQuoteFor } from "../config/header-resolve.js";
import { resolveScript } from "../files/scripts.js";
import { refreshHostKeychainIfExpired, writeSandboxCredentials } from "../infra/sandbox.js";
import { tmuxHasSession } from "../infra/tmux.js";
import type { SpawnClaudeOptions } from "../session/spawn-claude.js";
import { launchChoiceFromParams } from "../session/launch-choice.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { codexRolloutExists } from "../agents/codex-sessions.js";
import { codexRolloutIds, markDevTerminalSession, ptys } from "../session/registry.js";
import { sandboxWouldRun } from "../session/pty-spawn.js";
import { handleCommandFrame } from "../session/pty-connection.js";
import { closeWithError } from "../session/ws-frames.js";
import { ProviderRefusedError } from "../session/provider-env.js";
import { sessionExistsOnDisk } from "../session/session-reads.js";
import { canStartLauncher, resolveReattachableId, resolveSession, type SessionResolution } from "../session/session-resolve.js";
import type { PtyEntry } from "../session/types.js";

export interface WsRouteDeps {
  /** The http server these endpoints hang their `upgrade` handler off. */
  server: Server;
  /** Only same-machine browser origins may open a terminal socket. */
  isAllowedOrigin: (origin: string | undefined) => boolean;
  claudeBin: string;
  setWaiting: (id: string, waiting: boolean) => void;
  reattachPty: (entry: PtyEntry, ws: WebSocket, sessionId: string) => PtyEntry;
  handleClientFrame: (entry: PtyEntry, ws: WebSocket, raw: { toString(): string }, sessionId: string) => void;
  handleClientClose: (entry: PtyEntry, ws: WebSocket, sessionId: string) => void;
  spawnClaudePty: (sessionId: string, resume: string | null, ws: WebSocket | null, options?: SpawnClaudeOptions) => PtyEntry;
  spawnCodexPty: (
    sessionId: string,
    ws: WebSocket | null,
    resumeRolloutId: string | null,
    cwd: string,
    attachGuiMcp: boolean,
    initialPrompt: string | null,
  ) => PtyEntry;
  spawnCommandPty: (command: string, cwd: string, ws: WebSocket) => IPty;
  spawnLauncherPty: (sessionId: string, ws: WebSocket, command: string, cwd: string) => PtyEntry;
  resolveLauncher: (index: number) => { label: string; command: string } | null;
}

// Pick the effective session id for a /ws connection: reattach a same-process live pty,
// resume an on-disk transcript, attach a live tmux session, else a fresh id. The flag
// decision lives in resolveSession (pure/tested); this only gathers the live facts —
// lazily, so a live pty short-circuits the tmux + disk probes.
// The command a launcher runs when spawned fresh. On a tmux reattach it's ignored
// (tmux new-session -A attaches the running program), so a surviving session with no
// resolvable launcher index still reattaches via this harmless fallback.
const DEFAULT_LAUNCH_CMD = process.env.SHELL || "/bin/sh";

function resolveClaudeSession(requested: string | null, cwd: string): SessionResolution {
  const hasLivePty = !!requested && ptys.has(requested);
  const tmuxAlive = !hasLivePty && !!requested && tmuxHasSession(requested);
  const onDisk = !hasLivePty && !!requested && sessionExistsOnDisk(requested, cwd);
  return resolveSession(requested, { hasLivePty, tmuxAlive, onDisk }, randomUUID);
}

// The params every terminal WebSocket reads: the request URL, the validated
// session id, and the resolved cwd. A non-UUID session id is treated as "no
// session" — it could otherwise smuggle path/flag fragments into
// sessionExistsOnDisk / --resume — and cwd (?cwd=<abs>) falls back to CLAUDE_CWD.
function wsConnectionContext(req: { url?: string }): { url: URL; requested: string | null; cwd: string } {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("session");
  const requested = raw && SESSION_ID_RE.test(raw) ? raw : null;
  const cwd = resolveWorkspace(url.searchParams.get("cwd"));
  return { url, requested, cwd };
}

async function resolveButtonRun(url: URL, cwd: string): Promise<{ command: string; cwd: string } | null> {
  const buttonId = url.searchParams.get("buttonId");
  if (!buttonId) return null;
  const sessionRaw = url.searchParams.get("session");
  const session = sessionRaw && SESSION_ID_RE.test(sessionRaw) ? sessionRaw : null;
  const agent = url.searchParams.get("agent") === "codex" ? "codex" : "claude";
  const config = loadHeaderConfig(cwd, getHeaderConfig());
  const context = await buildHeaderContext(cwd, { session, agent, model: url.searchParams.get("model") });
  const command = resolveButtonCommand(config, context, buttonId, shellQuoteFor(process.platform));
  return command ? { command, cwd } : null;
}

async function resolveRunTarget(url: URL): Promise<{ command: string; cwd: string } | null> {
  const cwd = resolveWorkspace(url.searchParams.get("cwd"));
  const byButton = await resolveButtonRun(url, cwd);
  if (byButton) return byButton;
  const indexRaw = url.searchParams.get("index");
  const index = indexRaw !== null && /^\d+$/.test(indexRaw) ? Number(indexRaw) : NaN;
  return resolveScript(cwd, index);
}

async function startRunTerminal(deps: WsRouteDeps, ws: WebSocket, url: URL): Promise<void> {
  const resolved = await resolveRunTarget(url);
  if (!resolved) return closeWithError(ws, "Command not found — check your config / script.json.");
  let term: IPty;
  try {
    term = deps.spawnCommandPty(resolved.command, resolved.cwd, ws);
  } catch (err) {
    console.error(`[ws/run] failed to start command: ${messageOf(err)}`);
    return closeWithError(ws, "Failed to start the command.");
  }
  ws.on("message", (raw) => handleCommandFrame(term, raw));
  ws.on("close", () => {
    try {
      term.kill(); // ephemeral: no reattach/grace window — the viewer is gone, so end the process
    } catch {
      // already exited — nothing to kill
    }
  });
}

// Reattach a same-process live PTY, else spawn a launcher (which itself reattaches a
// surviving tmux session or creates one). `command` is the resolved launcher command,
// or the fallback for a tmux reattach with no launcher index.
function startLaunchEntry(deps: WsRouteDeps, sessionId: string, ws: WebSocket, live: PtyEntry | undefined, command: string, cwd: string): PtyEntry {
  if (live) return deps.reattachPty(live, ws, sessionId);
  return deps.spawnLauncherPty(sessionId, ws, command, cwd);
}

// Resolve a launcher ws request to a session: reattach a live pty / surviving tmux
// session (id kept, running program picked up via `tmux new-session -A`, command ignored),
// or a fresh spawn of the indexed launcher command. Returns null when there's nothing to
// reattach AND the index isn't a configured launcher.
function resolveLaunchSession(
  deps: WsRouteDeps,
  requested: string | null,
  index: number,
  shell: boolean,
): { sessionId: string; live: PtyEntry | undefined; command: string } | null {
  const hasLivePty = !!requested && ptys.has(requested);
  const live = hasLivePty && requested ? ptys.get(requested) : undefined;
  const tmuxAlive = !live && !!requested && tmuxHasSession(requested);
  // A live PTY / surviving tmux session reattaches regardless of the index; only a fresh
  // spawn needs the launcher resolved (the pty already IS the chosen program on reattach).
  const launcher = live || tmuxAlive ? null : deps.resolveLauncher(index);
  if (!canStartLauncher({ hasLivePty, tmuxAlive, hasLauncher: !!launcher, isShell: shell })) return null;
  const { sessionId } = resolveReattachableId(requested, { hasLivePty, tmuxAlive, canResume: false }, randomUUID);
  return { sessionId, live, command: launcher?.command ?? DEFAULT_LAUNCH_CMD };
}

// codex is a first-class agent like claude, but it mints its own session id (no --session-id),
// so the browser-facing id is a mulmoterminal-minted key; we discover codex's real rollout id
// after spawn and resume it with `codex resume <id>` once the live PTY is gone. Reattach a live
// pty / surviving tmux session (running codex picked up, no resume); else cold-resume a known
// rollout id; else a fresh session (a new minted key).
// A rollout id to cold-resume for a requested session key: one we started here (key -> rollout id),
// or a rollout id straight from the sidebar (its own id), or null (start fresh).
function codexResumeIdFor(requested: string): string | null {
  const mapped = codexRolloutIds.get(requested);
  if (mapped) return mapped;
  return codexRolloutExists(codexSessionsRoot(), requested) ? requested : null;
}

function resolveCodexSession(requested: string | null): { sessionId: string; live: PtyEntry | undefined; resumeRolloutId: string | null } {
  const hasLivePty = !!requested && ptys.has(requested);
  const live = hasLivePty && requested ? ptys.get(requested) : undefined;
  const tmuxAlive = !live && !!requested && tmuxHasSession(requested);
  const resumeRolloutId = !live && !tmuxAlive && requested ? codexResumeIdFor(requested) : null;
  const { sessionId } = resolveReattachableId(requested, { hasLivePty, tmuxAlive, canResume: !!resumeRolloutId }, randomUUID);
  return { sessionId, live, resumeRolloutId };
}

function startCodexEntry(
  deps: WsRouteDeps,
  sessionId: string,
  ws: WebSocket,
  live: PtyEntry | undefined,
  resumeRolloutId: string | null,
  cwd: string,
  attachGuiMcp: boolean,
): PtyEntry {
  if (live) return deps.reattachPty(live, ws, sessionId);
  return deps.spawnCodexPty(sessionId, ws, resumeRolloutId, cwd, attachGuiMcp, null); // interactive: no seed
}

async function handleClaudeConnection(deps: WsRouteDeps, ws: WebSocket, req: { url?: string; headers?: unknown }) {
  // ?session=<id> resumes an existing conversation; absent => fresh session. For
  // new sessions we generate the id ourselves (--session-id) so the server always
  // knows the current session's id, even before any file exists.
  const { url, requested, cwd } = wsConnectionContext(req);
  // A bad id is never silently reused — closing the socket without a replacement
  // makes the client auto-reconnect with the same bad id forever, so we warn and
  // fall through to mint a fresh session, then tell the browser the new id.
  const rawSession = url.searchParams.get("session");
  if (rawSession && !requested) console.warn(`[ws] ignoring non-UUID session id: ${JSON.stringify(rawSession)} — starting fresh`);

  // ?gui=0 (the grid's dev terminals) spawns claude WITHOUT the GUI plugin MCP /
  // --strict-mcp-config, so the user's + project's MCP servers load normally. Absent
  // (the single view) keeps main's behavior: GUI MCP attached + strict.
  const attachGuiMcp = url.searchParams.get("gui") !== "0";

  // ?provider=/?model= — what the launch form picked for THIS session (#584). It replaces
  // the directory's default; absent (the usual case) leaves that default alone. Ignored on
  // a reattach, where no spawn happens and the running session keeps what it started with.
  const launch = launchChoiceFromParams(url.searchParams);

  // Decide the effective session id BEFORE telling the browser. A requested id
  // is honored only if it can actually be served: a live pty (reattach) or an
  // on-disk transcript (`--resume`). A requested id that's neither — e.g. a cell
  // reloading an idle session claude never persisted — can't be reused: claude
  // exits with "session id already in use" if we retry `--session-id <same>`.
  // So mint a fresh id; the browser adopts it from this `session` message and
  // re-persists, so the reload just reopens a working terminal seamlessly.
  const { reattachId, resume, sessionId } = resolveClaudeSession(requested, cwd);
  const live = reattachId ? ptys.get(reattachId) : undefined;

  // A dev terminal (gui=0) is a multi-terminal GRID cell: remember its session id so
  // it's excluded from the chat sidebar (see devTerminalSessions). This is the single
  // choke point for every grid attach — new, resumed, or reattached — so the mark is
  // recorded (and re-recorded after a reboot when the cell reconnects) exactly once.
  if (!attachGuiMcp) markDevTerminalSession(sessionId);

  // Tell the browser which session this is (it learns the id of new sessions) and
  // the EFFECTIVE cwd — where claude really runs. On reattach that's the live
  // PTY's own cwd (NOT this request's ?cwd=, which it ignores); otherwise it's the
  // resolved cwd the new PTY will spawn in.
  const reportedCwd = live?.cwd ?? cwd;
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd: reportedCwd }));

  // Before touching the Keychain for a sandbox session, refresh it if the token expired
  // (macOS refreshes into the Keychain, not the file — so an untouched export can be a
  // stale token the container 401s on). No-op unless a sandbox spawn/reattach applies.
  if (live?.sandbox || sandboxWouldRun(attachGuiMcp)) {
    await refreshHostKeychainIfExpired(deps.claudeBin);
    // Renewal can block for seconds (it drives the host CLI). If the client vanished
    // during that window the close handlers aren't wired yet, so spawning now would
    // leak a PTY nobody reaps — bail instead.
    if (ws.readyState !== ws.OPEN) {
      console.log(`[ws] client left during credential refresh — abandoning ${sessionId}`);
      return;
    }
  }

  let entry: PtyEntry;
  try {
    // A sandbox session's credential is snapshotted at spawn onto its mounted per-session
    // file. On reconnect, re-sync it from the (now-refreshed) Keychain so a token that
    // rotated since spawn doesn't leave the reattached session stuck at "Not logged in".
    if (live?.sandbox) writeSandboxCredentials(sessionId);
    entry = live ? deps.reattachPty(live, ws, sessionId) : deps.spawnClaudePty(sessionId, resume, ws, { cwd, attachGuiMcp, launch });
  } catch (err) {
    // A failed spawn (claude missing, or node-pty's spawn-helper not executable)
    // must close just this connection — never crash the whole server.
    console.error(`[ws] failed to start session ${sessionId}: ${messageOf(err)}`);
    // A provider refusal already says exactly what is wrong with the directory's config
    // (#579); the generic hint below would bury it.
    if (err instanceof ProviderRefusedError) return closeWithError(ws, err.message);
    closeWithError(ws, "Failed to start Claude. Is the `claude` CLI installed and on your PATH?");
    return;
  }

  // Single view (gui) = the attached session IS the actively-viewed pane, so mark it
  // read. A grid dev-terminal cell (gui=0) is only "viewed" once focused/zoomed (the
  // client then sends a `view` frame), so it stays inactive here and can surface
  // blocked/done while the user is on another cell or page.
  entry.active = attachGuiMcp;
  if (entry.active) deps.setWaiting(sessionId, false);

  ws.on("message", (raw) => deps.handleClientFrame(entry, ws, raw, sessionId));
  ws.on("close", () => deps.handleClientClose(entry, ws, sessionId));
}

// Command terminal: resolve the command SERVER-SIDE (the browser never sends a raw command) and run it
// in an ephemeral PTY. `?index=<n>&cwd=<dir>` runs <dir>/script.json[n]; `?buttonId=<id>&cwd&session&
// agent&model` runs a header run:"shell" button, re-resolved from config against the session context with
// shell-escaped ${vars}. When the socket closes, the process is killed.
function handleRunConnection(deps: WsRouteDeps, ws: WebSocket, req: { url?: string; headers?: unknown }) {
  void startRunTerminal(deps, ws, new URL(req.url ?? "/", "http://localhost"));
}

// Launcher terminal (?launcher=<index>&cwd=<dir>, ?session=<id> to reattach): run a
// configured launch command as a persistent, reattachable PTY. Reuses the /ws session
// lifecycle (reattach + reap grace + handleClientClose) but with no hooks/transcript,
// and is marked a dev-terminal session so it stays out of the chat sidebar.
function handleLaunchConnection(deps: WsRouteDeps, ws: WebSocket, req: { url?: string; headers?: unknown }) {
  const { url, requested, cwd } = wsConnectionContext(req);
  const indexRaw = url.searchParams.get("launcher");
  const index = indexRaw !== null && /^\d+$/.test(indexRaw) ? Number(indexRaw) : NaN;
  const shell = url.searchParams.get("shell") === "1";

  const resolved = resolveLaunchSession(deps, requested, index, shell);
  if (!resolved) return closeWithError(ws, "Launcher not found — check Settings → Launch commands.");
  const { sessionId, live, command } = resolved;
  markDevTerminalSession(sessionId);
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd: live?.cwd ?? cwd }));

  let entry: PtyEntry;
  try {
    entry = startLaunchEntry(deps, sessionId, ws, live, command, cwd);
  } catch (err) {
    console.error(`[ws/launch] failed to start ${sessionId}: ${messageOf(err)}`);
    return closeWithError(ws, "Failed to start the launch command.");
  }

  ws.on("message", (raw) => deps.handleClientFrame(entry, ws, raw, sessionId));
  ws.on("close", () => deps.handleClientClose(entry, ws, sessionId));
}

// codex terminal (?cwd=<dir>, ?session=<id> to reattach/resume). ?gui=0 (grid dev terminal) runs
// codex without the GUI MCP and keeps it out of the sidebar; absent (single view) attaches the GUI
// MCP so codex drives the GUI panel like claude.
function handleCodexConnection(deps: WsRouteDeps, ws: WebSocket, req: { url?: string; headers?: unknown }) {
  const { url, requested, cwd } = wsConnectionContext(req);
  const attachGuiMcp = url.searchParams.get("gui") !== "0";

  const { sessionId, live, resumeRolloutId } = resolveCodexSession(requested);
  if (!attachGuiMcp) markDevTerminalSession(sessionId);
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd: live?.cwd ?? cwd }));

  let entry: PtyEntry;
  try {
    entry = startCodexEntry(deps, sessionId, ws, live, resumeRolloutId, cwd, attachGuiMcp);
  } catch (err) {
    console.error(`[ws/codex] failed to start ${sessionId}: ${messageOf(err)}`);
    return closeWithError(ws, "Failed to start codex. Is the `codex` CLI installed and on your PATH?");
  }

  ws.on("message", (raw) => deps.handleClientFrame(entry, ws, raw, sessionId));
  ws.on("close", () => deps.handleClientClose(entry, ws, sessionId));
}

export function mountTerminalWebSockets(deps: WsRouteDeps) {
  // Terminal WebSocket. Uses noServer + manual upgrade routing so it shares the
  // HTTP server with socket.io (the pub/sub at /ws/pubsub) without the two
  // libraries fighting over the "upgrade" event.
  const wss = new WebSocketServer({ noServer: true });
  // Command terminals (the grid's Run menu) get their own WS so the plain-command
  // PTY relay stays clear of the session/hook/transcript machinery on /ws.
  const runWss = new WebSocketServer({ noServer: true });
  // Launcher terminals (a plain shell / codex / any configured command) get their own WS
  // too. Unlike /ws/run these are PERSISTENT & reattachable (they share the /ws session
  // lifecycle — ptys map, reattach, reap grace) but carry no Claude hooks/transcript.
  const runLaunchWss = new WebSocketServer({ noServer: true });
  // First-class codex sessions — persistent + reattachable like /ws/launch, but running codex
  // with session discovery + resume. Its own endpoint so /ws stays claude-only.
  const runCodexWss = new WebSocketServer({ noServer: true });
  function wssForPath(pathname: string): WebSocketServer | null {
    if (pathname === "/ws") return wss;
    if (pathname === "/ws/run") return runWss;
    if (pathname === "/ws/launch") return runLaunchWss;
    if (pathname === "/ws/codex") return runCodexWss;
    return null; // e.g. /ws/pubsub — left to socket.io's own upgrade handler
  }
  deps.server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const target = wssForPath(pathname);
    if (!target) return;
    if (!deps.isAllowedOrigin(req.headers.origin)) {
      console.warn(`[ws] rejected cross-origin upgrade from ${req.headers.origin}`);
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
  });

  wss.on("connection", (ws, req) => void handleClaudeConnection(deps, ws, req));
  runWss.on("connection", (ws, req) => handleRunConnection(deps, ws, req));
  runLaunchWss.on("connection", (ws, req) => handleLaunchConnection(deps, ws, req));
  runCodexWss.on("connection", (ws, req) => handleCodexConnection(deps, ws, req));
}
