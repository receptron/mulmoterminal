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
import { CLAUDE_CWD, SESSION_ID_RE } from "../config/env.js";
import { workspaceRequest } from "../config/workspace.js";
import { getHeaderConfig } from "../config/config-routes.js";
import { buildHeaderContext, loadHeaderConfig } from "../config/header-context.js";
import { resolveButtonCommand, shellQuoteFor } from "../config/header-resolve.js";
import { resolveScript } from "../files/scripts.js";
import { tmuxHasSession } from "../infra/tmux.js";
import { launchChoiceFromParams } from "../session/launch-choice.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { antigravityBrainRoot, antigravityConversationExists } from "../agents/antigravity-session.js";
import { grokConversationExists, grokSessionsRoot } from "../agents/grok-session.js";
import { codexRolloutExists } from "../agents/codex-sessions.js";
import {
  antigravityConversations,
  antigravityConversationsHydrated,
  customAgentSessionsHydrated,
  codexRollouts,
  codexRolloutsHydrated,
  markDevTerminalSession,
  markAttachedSessionPlaced,
  ptys,
} from "../session/registry.js";
import { SpawnRefusedError, ptyWouldReattach } from "../session/pty-spawn.js";
import { bufferEarlyFrames, type EarlyFrames } from "../session/early-frames.js";
import { registeredGuiMcpGroups } from "../infra/gui-mcp-registration.js";
import { TOOL_GROUPS, type ToolGroup } from "../../common/toolGroups.js";
import { parseTerminalSize, type TerminalSize } from "../../common/terminalSize.js";
import { handleCommandFrame } from "../session/pty-connection.js";
import { closeWithError } from "../session/ws-frames.js";
import { replayLiveCwd } from "../session/live-cwd.js";
import { ProviderRefusedError } from "../session/provider-env.js";
import { sessionExistsOnDisk } from "../session/session-reads.js";
import { canStartLauncher, isContinuingSession, resolveReattachableId, resolveSession, type SessionResolution } from "../session/session-resolve.js";
import type { PtyEntry } from "../session/types.js";
import type {
  SpawnClaudePty,
  SpawnCodexPty,
  SpawnAntigravityPty,
  SpawnGrokPty,
  SpawnCommandPty,
  SpawnLauncherPty,
  ResolveLauncher,
} from "../session/spawners.js";
import type { SpawnDirectoryMcpPty } from "../session/spawn-directory-mcp.js";
import { terminalWsKind, type TerminalWsKind } from "./terminal-ws-path.js";
import { normalizeAgent, parseIndexParam } from "./routeParams.js";
import { agentResumeId } from "../agents/agent-resume.js";
import { claimLaunch, worktreeOccupancy } from "../session/worktree-session-limit.js";
import { worktreeRefusal } from "../../common/worktreeSession.js";
import { ensureWorktreeEnv } from "../config/worktree-env.js";
import { isCustomAgentId } from "../../common/customAgents.js";

export interface WsRouteDeps {
  /** The http server these endpoints hang their `upgrade` handler off. */
  server: Server;
  /** Only same-machine browser origins may open a terminal socket. */
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  claudeBin: string;
  setWaiting: (id: string, waiting: boolean) => void;
  reattachPty: (entry: PtyEntry, ws: WebSocket, sessionId: string) => PtyEntry;
  handleClientFrame: (entry: PtyEntry, ws: WebSocket, raw: { toString(): string }, sessionId: string) => void;
  handleClientClose: (entry: PtyEntry, ws: WebSocket, sessionId: string) => void;
  spawnClaudePty: SpawnClaudePty;
  spawnCodexPty: SpawnCodexPty;
  spawnAntigravityPty: SpawnAntigravityPty;
  spawnGrokPty: SpawnGrokPty;
  spawnCommandPty: SpawnCommandPty;
  spawnLauncherPty: SpawnLauncherPty;
  resolveLauncher: ResolveLauncher;
  /** The `--mcp-config` payload for a session, built per spawn (see session/mcp-config.ts). Needed
   *  here, not only in the spawners, because a LAUNCHER chip running claude in the workspace gets
   *  the same GUI MCP a claude cell there does — and its only lever is the command line. */
  mcpConfigJson: (sessionId: string, host?: string) => string;
  /** The fully-qualified GUI tool names such a chip pre-approves — the cell's `--allowedTools`. */
  guiMcpTools: string;
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
/**
 * Where a session actually runs, for the value that gets REMEMBERED (#1021).
 *
 * A reattach often carries no `?cwd=` — and `resolveWorkspace` answers the default workspace when
 * it is missing, so trusting the request would record CLAUDE_CWD for a session running somewhere
 * else entirely, and the phone would later show that directory's PR (found by Codex review). The
 * live PTY knows where claude really is; the request only decides where a NEW one will spawn.
 * Same rule the `session` message already follows when it reports the cwd back to the browser.
 */
export function effectiveSessionCwd(liveCwd: string | undefined, requestCwd: string): string {
  return liveCwd ?? requestCwd;
}

// The slice of Node's IncomingMessage the upgrade handlers read. Structural rather than the
// real type so a test can hand over a literal; `| undefined` because IncomingMessage.url is
// genuinely absent on some upgrades.
type WsUpgradeRequest = { url?: string | undefined; headers?: unknown };

// The default is still what an unusable `?cwd=` resolves to, because a REATTACH is allowed to
// proceed on it (see refuseUnusableWorkspace) and handing tmux a directory that is not there
// would break the one path this must not break.
export function workspaceFromUrl(url: URL): { cwd: string; unusable: string | null } {
  // getAll, not get: a repeated `?cwd=a&cwd=b` names two directories, and `get` would silently
  // pick the first — the same swap this exists to stop, and the HTTP routes already refuse it
  // (express hands them the array). Passing the array on keeps ONE rule for both transports.
  const values = url.searchParams.getAll("cwd");
  const request = workspaceRequest(values.length > 1 ? values : values[0]);
  if (request.kind === "unusable") return { cwd: CLAUDE_CWD, unusable: request.problem };
  return { cwd: request.cwd, unusable: null };
}

function wsConnectionContext(req: WsUpgradeRequest): { url: URL; requested: string | null; cwd: string; unusable: string | null; size: TerminalSize | null } {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("session");
  const requested = raw && SESSION_ID_RE.test(raw) ? raw : null;
  return { url, requested, size: sizeFromUrl(url), ...workspaceFromUrl(url) };
}

/** The geometry the browser has already fitted its terminal to, or null when it sent none it can
 *  stand behind — the same bounds a `resize` frame is held to. */
function sizeFromUrl(url: URL): TerminalSize | null {
  return parseTerminalSize(url.searchParams.get("cols"), url.searchParams.get("rows"));
}

// Put the browser's geometry on the pty the moment it exists. A pty is created at the server's
// default and learns the real size from the first `resize` frame — a SEPARATE message, which has to
// survive the spawn to be heard at all (#1178). Applying the URL's size here means the program
// inside never draws a frame at a size nobody asked for, and a lost first frame costs nothing.
// A reattach gets it too: the browser's current size is what that session should be at.
function applyClientSize(term: IPty, size: TerminalSize | null, tag: string, sessionId: string): void {
  if (!size) return;
  try {
    term.resize(size.cols, size.rows);
  } catch (err) {
    // e.g. the pty exited between the spawn and here — the resize frame will retry it.
    console.warn(`[ws/${tag}] ${sessionId}: initial resize dropped: ${messageOf(err)}`);
  }
}

// A directory was named and cannot be entered. For a FRESH start that is the end of it: this is
// the refusal `ptySpawn` would have made (#1078), moved to the only place it can still happen —
// `resolveWorkspace` used to swap the path for the default workspace first, so the terminal came
// up silently in another project and #1146 had no symptom but "it opened somewhere else" (#1151).
//
// A reattach is let through with a warning, exactly as `refuseUnusableCwd` lets one through:
// shutting someone out of an agent that is still running because they moved its directory would
// be a worse bug than the one being reported. It runs no new program, and the cwd it reports
// comes from the live PTY rather than from this request (effectiveSessionCwd).
export function refuseUnusableWorkspace(ws: WebSocket, kind: TerminalWsKind, unusable: string | null, requested: string | null): boolean {
  if (!unusable) return false;
  if (requested && (ptys.has(requested) || tmuxHasSession(requested))) {
    console.warn(`[ws/${kind}] attaching ${requested} despite an unusable ?cwd= — ${unusable}`);
    return false;
  }
  console.warn(`[ws/${kind}] refusing to start — ${unusable}`);
  closeWithError(ws, unusable);
  return true;
}

/**
 * Refuse a FRESH agent session in a worktree that already has one (#1207).
 *
 * Only a fresh one: reattaching or resuming a session that already exists is the whole point of
 * the rule, not a violation of it. The refusal has to happen before the browser is told a session
 * id, or a cell adopts an id for a terminal that is about to be closed under it.
 *
 * "Fresh" is read off the id the resolver settled on rather than re-listing the ways a session can
 * continue: every resolver here keeps the REQUESTED id exactly when something can serve it (a live
 * pty, a surviving tmux session, a transcript or rollout to resume) and mints a new one otherwise.
 * Codex caught the first version spelling that list out per call site and omitting tmux-only
 * liveness — which reads a reconnect after a server restart as a brand-new session (#1208).
 */
async function refuseSecondWorktreeSession(
  ws: WebSocket,
  kind: TerminalWsKind,
  cwd: string,
  session: { requested: string | null; sessionId: string },
): Promise<boolean> {
  if (isContinuingSession(session.requested, session.sessionId)) return false;
  // Claimed BEFORE the occupancy read, which is asynchronous: two launches aimed at one worktree
  // would otherwise both read it as free and both spawn (#1208, found by Codex). The claim is
  // dropped with the socket, which covers every early return below as well as a client that leaves
  // mid-check; a claim held past the spawn costs nothing, since the pty then occupies the worktree
  // on its own account.
  const claim = claimLaunch(cwd);
  ws.once("close", claim.release);
  const { isWorktree, session: occupied } = await worktreeOccupancy(cwd);
  if (!isWorktree) return false;
  const reason = worktreeRefusal(occupied, claim.contended);
  if (!reason) return false;
  console.warn(`[ws/${kind}] refusing a second session in ${cwd} — ${reason}`);
  closeWithError(ws, reason);
  return true;
}

/**
 * Everything an agent endpoint does between resolving its session and spawning it, in the order
 * the four of them (claude, launch, codex, antigravity) already ran it in.
 *
 * The order is the fragile part: the worktree refusal has to happen BEFORE the browser is told a
 * session id (#1207), and the dev-terminal mark has to be recorded on every attach — new, resumed
 * or reattached — which is what makes this the single choke point for the chat sidebar's exclusion
 * list (see devTerminalSessions).
 *
 * Returns null when the socket was refused and closed: the caller must return without spawning.
 */
async function admitAgentSession(
  ws: WebSocket,
  kind: TerminalWsKind,
  session: {
    requested: string | null;
    sessionId: string;
    live: PtyEntry | undefined;
    cwd: string;
    /** A grid cell rather than the single view: keep it out of the chat sidebar. */
    devTerminal: boolean;
    /** False for a launcher, which runs a command rather than an agent session and so is free of
     *  the one-session-per-worktree rule. Every agent path leaves it at the default. */
    worktreeLimited?: boolean;
  },
): Promise<EarlyFrames | null> {
  const { requested, sessionId, live, cwd, devTerminal, worktreeLimited = true } = session;
  if (worktreeLimited && (await refuseSecondWorktreeSession(ws, kind, cwd, { requested, sessionId }))) return null;
  if (devTerminal) markDevTerminalSession(sessionId, effectiveSessionCwd(live?.cwd, cwd));
  markAttachedSessionPlaced(sessionId, requested);
  // The EFFECTIVE cwd, not this request's: on a reattach the live PTY's own directory is where the
  // agent really runs, and the request's `?cwd=` is ignored by everything downstream.
  return announceSession(ws, sessionId, live?.cwd ?? cwd, !!live);
}

async function resolveButtonRun(url: URL, cwd: string): Promise<{ command: string; cwd: string } | null> {
  const buttonId = url.searchParams.get("buttonId");
  if (!buttonId) return null;
  const sessionRaw = url.searchParams.get("session");
  const session = sessionRaw && SESSION_ID_RE.test(sessionRaw) ? sessionRaw : null;
  const agent = normalizeAgent(url.searchParams.get("agent"));
  const config = loadHeaderConfig(cwd, getHeaderConfig());
  const context = await buildHeaderContext(cwd, { session, agent, model: url.searchParams.get("model") });
  const command = resolveButtonCommand(config, context, buttonId, shellQuoteFor(process.platform));
  return command ? { command, cwd } : null;
}

async function resolveRunTarget(url: URL, cwd: string): Promise<{ command: string; cwd: string } | null> {
  const byButton = await resolveButtonRun(url, cwd);
  if (byButton) return byButton;
  return resolveScript(cwd, parseIndexParam(url.searchParams.get("index")));
}

// A terminal socket is a raw EventEmitter: an unhandled 'error' (a client whose network
// drops mid-session emits ECONNRESET/EPIPE) is re-thrown by the ws library and would crash
// the whole backend — disconnecting EVERY terminal, not just this one, and leaving the Vite
// dev proxy to flood the console with ECONNREFUSED. Attach a no-op-but-logging listener
// before the connection handler runs so one dropped client stays one dropped client. Wired
// at the single handleUpgrade choke point, so it covers claude/run/launch/codex alike.
export function attachSocketErrorLogger(ws: Pick<WebSocket, "on">, kind: TerminalWsKind): void {
  ws.on("error", (err) => console.warn(`[ws] socket error (${kind}): ${messageOf(err)}`));
}

/** Reserve the directory's per-tree PORT / DB_NAME (#1367), for a connection that is about to
 *  SPAWN. Awaited here because the spawners are synchronous and only read what is already
 *  reserved — a path that skips this starts a terminal without the project's values.
 *
 *  Skipped on a reattach, and not merely as an optimisation: no process starts, so nothing would
 *  read the values, and `cwd` on a reattach is the least trustworthy thing in the request — it is
 *  often absent and then falls back to the default workspace (see effectiveSessionCwd). Reserving
 *  from it would hand a slot to a directory nobody is launching in. Same "only for a spawn" shape
 *  the GUI-tool-group lookup below already has, for the same reason. (Codex review on #1367.)
 *
 *  BOTH kinds of reattach, which is why this asks ptyWouldReattach rather than testing `live`:
 *  `live` is only a same-process pty, and a session that survived a server restart is picked up
 *  from tmux with `live === undefined` — the case a `!live` test reads as a fresh spawn. It is the
 *  same predicate ptySpawn itself will apply, given the same id, so the two cannot disagree.
 *
 *  `session: null` is an ephemeral terminal (/ws/run): no session identity, no tmux, so it always
 *  spawns.
 */
export async function reserveWorktreeEnvForSpawn(cwd: string, session: { id: string; live: PtyEntry | undefined } | null): Promise<void> {
  if (session && (session.live || ptyWouldReattach(session.id, true))) return;
  await ensureWorktreeEnv(cwd);
}

async function startRunTerminal(deps: WsRouteDeps, ws: WebSocket, url: URL): Promise<void> {
  // No session to reattach: /ws/run is ephemeral, so an unusable directory is always a refusal.
  const { cwd, unusable } = workspaceFromUrl(url);
  if (refuseUnusableWorkspace(ws, "run", unusable, null)) return;
  const resolved = await resolveRunTarget(url, cwd);
  if (!resolved) return closeWithError(ws, "Command not found — check your config / script.json.");
  // Against `resolved.cwd`, not the URL's: a header button's command can resolve a different
  // directory, and the pty gets that one. /ws/run never reattaches, so it always reserves.
  await reserveWorktreeEnvForSpawn(resolved.cwd, null);
  beginRunTerminal(deps, ws, resolved, sizeFromUrl(url));
}

// Spawn the ephemeral Run PTY and wire its lifecycle. resolveRunTarget above can await a git
// subprocess (buildHeaderContext for a button command), and the viewer can leave during that
// window — before any close handler is wired. Spawning then leaks a PTY nobody reaps (/ws/run
// is ephemeral: no reattach, no reap/grace, so its only kill is the close handler below). Bail
// if the socket has since closed — the same guard handleClaudeConnection applies after its
// keychain refresh.
export function beginRunTerminal(deps: WsRouteDeps, ws: WebSocket, resolved: { command: string; cwd: string }, size: TerminalSize | null = null): void {
  if (ws.readyState !== ws.OPEN) return;
  let term: IPty;
  try {
    term = deps.spawnCommandPty(resolved.command, resolved.cwd, ws);
  } catch (err) {
    console.error(`[ws/run] failed to start command: ${messageOf(err)}`);
    return closeWithError(ws, `Failed to start the command: ${messageOf(err)}`);
  }
  applyClientSize(term, size, "run", "command");
  ws.on("message", (raw) => handleCommandFrame(term, raw));
  ws.on("close", () => {
    try {
      term.kill(); // ephemeral: no reattach/grace window — the viewer is gone, so end the process
    } catch {
      // already exited — nothing to kill
    }
  });
}

/** What is still RUNNING under a requested id — the two facts every reattachable endpoint starts
 *  from, gathered in one place because they are asked in a fixed order and one of them costs a
 *  subprocess: `tmuxHasSession` shells out, so a same-process pty must short-circuit it.
 *
 *  `hasLivePty` is `!!live` rather than a separate `ptys.has`, which is what it always meant —
 *  the map holds no undefined entries — and saying it once removes the chance of the two answers
 *  parting company. */
function liveSessionFacts(requested: string | null): { hasLivePty: boolean; live: PtyEntry | undefined; tmuxAlive: boolean } {
  const live = requested ? ptys.get(requested) : undefined;
  const tmuxAlive = !live && !!requested && tmuxHasSession(requested);
  return { hasLivePty: !!live, live, tmuxAlive };
}

/** The session a self-identifying agent connects as: the id it will run under, the same-process
 *  pty to reattach if there is one, and the conversation to resume if there is one. */
interface ResumableSession {
  sessionId: string;
  live: PtyEntry | undefined;
  resumeConversationId: string | null;
}

/** The session a self-identifying agent (codex, antigravity, grok) connects as.
 *
 *  All three mint their OWN conversation id and tell nobody, so the id the browser holds is a key
 *  this server minted and the conversation behind it has to be looked up. What differs between
 *  them is only that lookup — a map on disk, a probe, or both — so it arrives as `resumeIdFor`
 *  and everything around it is decided here.
 *
 *  claude is deliberately not one of these: it takes `--session-id`, so its id IS the
 *  conversation's and resolveClaudeSession answers a different question (resume from disk).
 */
function resolveResumableSession(
  requested: string | null,
  resumeIdFor: (facts: { hasLivePty: boolean; tmuxAlive: boolean }) => string | null,
): ResumableSession {
  const { hasLivePty, live, tmuxAlive } = liveSessionFacts(requested);
  const resumeConversationId = resumeIdFor({ hasLivePty, tmuxAlive });
  const { sessionId } = resolveReattachableId(requested, { hasLivePty, tmuxAlive, canResume: !!resumeConversationId }, randomUUID);
  return { sessionId, live, resumeConversationId };
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
  const { hasLivePty, live, tmuxAlive } = liveSessionFacts(requested);
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
function resolveCodexSession(requested: string | null): { sessionId: string; live: PtyEntry | undefined; resumeRolloutId: string | null } {
  const { sessionId, live, resumeConversationId } = resolveResumableSession(requested, ({ hasLivePty, tmuxAlive }) =>
    agentResumeId(requested, {
      mappedId: requested ? codexRollouts.get(requested)?.conversationId : null,
      conversationExists: () => !!requested && codexRolloutExists(codexSessionsRoot(), requested),
      hasLivePty,
      tmuxAlive,
    }),
  );
  // "rollout" is codex's own word for the conversation file it resumes from — kept at this
  // boundary, since everything downstream of here is codex-specific and reads better in it.
  return { sessionId, live, resumeRolloutId: resumeConversationId };
}

// Grouped rather than eight positional arguments: what this needs is a session to (re)attach,
// a directory, and the GUI-tool decision — the last of which is now two values that only make
// sense together (attach everything, or exactly these groups).
interface CodexStart {
  sessionId: string;
  live: PtyEntry | undefined;
  resumeRolloutId: string | null;
  cwd: string;
  attachGuiMcp: boolean;
  mcpGroups: readonly ToolGroup[];
}

function startCodexEntry(deps: WsRouteDeps, ws: WebSocket, start: CodexStart): PtyEntry {
  const { sessionId, live, resumeRolloutId, cwd, attachGuiMcp, mcpGroups } = start;
  if (live) return deps.reattachPty(live, ws, sessionId);
  return deps.spawnCodexPty(sessionId, ws, resumeRolloutId, cwd, attachGuiMcp, { mcpGroups }); // interactive: no seed
}

async function handleClaudeConnection(deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  // ?session=<id> resumes an existing conversation; absent => fresh session. For
  // new sessions we generate the id ourselves (--session-id) so the server always
  // knows the current session's id, even before any file exists.
  const { url, requested, cwd, unusable, size } = wsConnectionContext(req);
  if (refuseUnusableWorkspace(ws, "claude", unusable, requested)) return;
  // A bad id is never silently reused — closing the socket without a replacement
  // makes the client auto-reconnect with the same bad id forever, so we warn and
  // fall through to mint a fresh session, then tell the browser the new id.
  const rawSession = url.searchParams.get("session");
  if (rawSession && !requested) console.warn(`[ws] ignoring non-UUID session id: ${JSON.stringify(rawSession)} — starting fresh`);

  // ?gui=0 (the grid's dev terminals) spawns claude WITHOUT the GUI plugin MCP, so its GUI tools
  // come from whatever the directory registered. Absent (the single view) attaches ours on the
  // all-tools url. Either way the user's + project's MCP servers load — that is not what this
  // switch decides, and welding it to one was #1338 / #1385.
  const attachGuiMcp = url.searchParams.get("gui") !== "0";

  // ?provider=/?model= — what the launch form picked for THIS session (#584). It replaces
  // the directory's default; absent (the usual case) leaves that default alone. Ignored on
  // a reattach, where no spawn happens and the running session keeps what it started with.
  const launch = launchChoiceFromParams(url.searchParams);

  // ?customAgent=<id> — the Agent Picker chose one of the user's OWN ways of starting Claude Code
  // (#1414). Only the id travels: the configured list is the allowlist and it is resolved at spawn
  // (see spawnClaudePty), so the browser can never name a program that is not in the config. A
  // malformed id is dropped here rather than passed on, which starts plain claude — the same thing
  // an entry the user has since deleted does.
  const customAgentParam = url.searchParams.get("customAgent");
  const customAgentId = isCustomAgentId(customAgentParam) ? customAgentParam : undefined;

  // Decide the effective session id BEFORE telling the browser. A requested id
  // is honored only if it can actually be served: a live pty (reattach) or an
  // on-disk transcript (`--resume`). A requested id that's neither — e.g. a cell
  // reloading an idle session claude never persisted — can't be reused: claude
  // exits with "session id already in use" if we retry `--session-id <same>`.
  // So mint a fresh id; the browser adopts it from this `session` message and
  // re-persists, so the reload just reopens a working terminal seamlessly.
  // Before resolving, not after: which custom agent a session was started on lives on disk, and a
  // resume that arrives while the log is still being read would see an empty map and continue the
  // conversation on plain claude — a different model, mid-thread. Same guard the antigravity
  // conversation map takes, for the same restart case.
  await customAgentSessionsHydrated;
  const { reattachId, resume, sessionId } = resolveClaudeSession(requested, cwd);
  const live = reattachId ? ptys.get(reattachId) : undefined;
  // Buffered from the announcement on, like every other terminal endpoint: the browser's first
  // frame is the terminal's geometry and it arrives while this handler may still be awaiting the
  // Keychain — /ws was the one route that let it fall on the floor (#1178, see early-frames.ts).
  await reserveWorktreeEnvForSpawn(cwd, { id: sessionId, live });
  const early = await admitAgentSession(ws, "claude", { requested, sessionId, live, cwd, devTerminal: !attachGuiMcp });
  if (!early) return;

  // A provider refusal already says exactly what is wrong with the directory's config (#579), and a
  // refused spawn already names the binary and the PATH it searched, or the directory that is gone
  // (#1063, #1078); a generic hint would bury either.
  const startFailureMessage = (err: unknown): string =>
    err instanceof ProviderRefusedError || err instanceof SpawnRefusedError ? err.message : `Failed to start Claude: ${messageOf(err)}`;

  startAndWire(deps, ws, { id: sessionId, tag: "claude", early, startFailureMessage, size }, () => {
    const entry = live ? deps.reattachPty(live, ws, sessionId) : deps.spawnClaudePty(sessionId, resume, ws, { cwd, attachGuiMcp, launch, customAgentId });
    // Single view (gui) = the attached session IS the actively-viewed pane, so mark it
    // read. A grid dev-terminal cell (gui=0) is only "viewed" once focused/zoomed (the
    // client then sends a `view` frame), so it stays inactive here and can surface
    // blocked/done while the user is on another cell or page.
    entry.active = attachGuiMcp;
    if (entry.active) deps.setWaiting(sessionId, false);
    return entry;
  });
}

// Command terminal: resolve the command SERVER-SIDE (the browser never sends a raw command) and run it
// in an ephemeral PTY. `?index=<n>&cwd=<dir>` runs <dir>/script.json[n]; `?buttonId=<id>&cwd&session&
// agent&model` runs a header run:"shell" button, re-resolved from config against the session context with
// shell-escaped ${vars}. When the socket closes, the process is killed.
function handleRunConnection(deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  void startRunTerminal(deps, ws, new URL(req.url ?? "/", "http://localhost"));
}

// A refused spawn already carries its own diagnosis — the missing CLI with the PATH that was
// searched (#1063), or the directory that is gone (#1078). Passing that through rather than
// wrapping it is what puts the real reason in the terminal instead of `spawn ENOENT`; everything
// else is an error nobody wrote for a reader, so it gets named.
export const startFailureMessageFor =
  (what: string) =>
  (err: unknown): string =>
    err instanceof SpawnRefusedError ? err.message : `Failed to start ${what}: ${messageOf(err)}`;

// Start the pty for a resolved session, then hand the socket to it — or fail the socket cleanly.
//
// One function for both agents because the ORDER is the fragile part, not the lines: the buffered
// early frames may only be replayed once the real message listener is installed, or a frame that
// lands mid-replay overtakes the ones before it (see early-frames.ts). Inlined, that rule was
// written as a comment on the codex path and nowhere on the launch path.
//
// `start` throwing is the spawn refusing — a missing CLI, a directory that vanished. The buffer is
// dropped rather than replayed: there is no pty to replay it into, and the socket is closing.
// `startFailureMessage` takes the error rather than being a fixed string, because what the user
// needs to read differs by cause: a pre-spawn diagnosis is already a sentence (#1063), anything
// else needs naming.
export function startAndWire(
  deps: Pick<WsRouteDeps, "handleClientFrame" | "handleClientClose">,
  ws: WebSocket,
  session: {
    id: string;
    tag: string;
    early: EarlyFrames;
    startFailureMessage: (err: unknown) => string;
    /** The browser's own geometry, off the connect URL. */
    size?: TerminalSize | null;
  },
  start: () => PtyEntry,
): void {
  let entry: PtyEntry;
  try {
    entry = start();
  } catch (err) {
    console.error(`[ws/${session.tag}] failed to start ${session.id}: ${messageOf(err)}`);
    session.early.discard();
    return closeWithError(ws, session.startFailureMessage(err));
  }
  applyClientSize(entry.term, session.size ?? null, session.tag, session.id);
  const deliver = (raw: { toString(): string }) => deps.handleClientFrame(entry, ws, raw, session.id);
  ws.on("message", deliver);
  ws.on("close", () => deps.handleClientClose(entry, ws, session.id));
  session.early.release(deliver);
}

// Tell the browser which session this is, and from that moment collect what it sends: its first
// frame is the terminal's real geometry, and it arrives while the caller is still reading config
// files, so without this it lands on the floor (see early-frames.ts).
function announceSession(ws: WebSocket, sessionId: string, cwd: string, _reattached = false): EarlyFrames {
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd }));
  replayLiveCwd(ws, sessionId, cwd);
  return bufferEarlyFrames(ws);
}

// False when the client left during those reads — the caller must return WITHOUT spawning. A spawn
// for a socket that has already closed leaks a pty nobody reaps, because the close handlers are not
// installed until startAndWire.
function clientStillConnected(ws: WebSocket, tag: string, sessionId: string, early: EarlyFrames): boolean {
  if (ws.readyState === ws.OPEN) return true;
  console.log(`[ws/${tag}] client left before spawn — abandoning ${sessionId}`);
  early.discard();
  return false;
}

// Launcher terminal (?launcher=<index>&cwd=<dir>, ?session=<id> to reattach): run a
// configured launch command as a persistent, reattachable PTY. Reuses the /ws session
// lifecycle (reattach + reap grace + handleClientClose) but with no hooks/transcript,
// and is marked a dev-terminal session so it stays out of the chat sidebar.
async function handleLaunchConnection(deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  const { url, requested, cwd, unusable, size } = wsConnectionContext(req);
  if (refuseUnusableWorkspace(ws, "launch", unusable, requested)) return;
  const index = parseIndexParam(url.searchParams.get("launcher"));
  const shell = url.searchParams.get("shell") === "1";

  const resolved = resolveLaunchSession(deps, requested, index, shell);
  if (!resolved) return closeWithError(ws, "Launcher not found — check Settings → Launch commands.");
  const { sessionId, live, command } = resolved;
  // Never worktree-limited. The rule is one AGENT SESSION per worktree, and a launcher is not one:
  // it is a command line this app does not read. It used to read it — a command starting with the
  // word `codex` was held to the limit (#1207, #1208) — but that is a guess about someone else's
  // text, and the guess cuts both ways: it also refused `codex-review-notes.sh`. A worktree is
  // exactly where someone wants `yarn dev` or `lazygit` open beside the agent.
  //
  // The hole this leaves is real and deliberate: a chip whose command is `codex` can start a second
  // agent in a worktree the Agent Picker has already occupied. Nothing on the launcher side can
  // close it without guessing again.
  await reserveWorktreeEnvForSpawn(cwd, { id: sessionId, live });
  const early = await admitAgentSession(ws, "launch", { requested, sessionId, live, cwd, devTerminal: true, worktreeLimited: false });
  if (!early) return;

  if (!clientStillConnected(ws, "launch", sessionId, early)) return;

  // The command runs VERBATIM. A launcher is the user's own command line and nothing else, so
  // nothing is inserted into it — no flags, no MCP, whatever program the line happens to name.
  //
  // It did once: a chip whose command was `claude` or `codex` was rewritten to carry the GUI MCP,
  // for parity with the same agent started from the Agent Picker (#1040, #1358). That parity is
  // deliberately gone. A chip is a command, the Agent Picker is a session — conflating the two is
  // what made the two controls impossible to tell apart, and a chip that silently runs something
  // other than what it says is the wrong half of the pair to keep. A chip that wants GUI tools
  // now asks for them the way any other command would: in the flags the user writes.
  //
  // Consequence, stated so it is not rediscovered as a bug: a `codex` chip has no Canvas, and a
  // `claude` chip reads only its directory's own MCP config.
  //
  // A launcher runs the user's own command line, so there is no binary pre-flight — but its cwd
  // is checked like every other spawn's, and that refusal is already a sentence.
  const startFailureMessage = startFailureMessageFor("the launch command");
  startAndWire(deps, ws, { id: sessionId, tag: "launch", early, startFailureMessage, size }, () => startLaunchEntry(deps, sessionId, ws, live, command, cwd));
}

// codex terminal (?cwd=<dir>, ?session=<id> to reattach/resume). ?gui=0 (grid dev terminal) runs
// codex without the GUI MCP and keeps it out of the sidebar; absent (single view) attaches the GUI
// MCP so codex drives the GUI panel like claude.
async function handleCodexConnection(deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  const { url, requested, cwd, unusable, size } = wsConnectionContext(req);
  if (refuseUnusableWorkspace(ws, "codex", unusable, requested)) return;
  const attachGuiMcp = url.searchParams.get("gui") !== "0";

  // Before resolving, not after: the mapping this reads lives on disk, and a reconnect that
  // arrives while the log is still being read would see an empty map and decline to resume a
  // rollout that is right there — which is the restart case this exists for.
  await codexRolloutsHydrated;
  const { sessionId, live, resumeRolloutId } = resolveCodexSession(requested);
  await reserveWorktreeEnvForSpawn(cwd, { id: sessionId, live });
  const early = await admitAgentSession(ws, "codex", { requested, sessionId, live, cwd, devTerminal: !attachGuiMcp });
  if (!early) return;

  // A grid cell's GUI tools are whatever its DIRECTORY registered — the same switches claude's
  // cells read, in the same file. claude picks them up itself; codex is handed resolved URLs at
  // spawn, so the answer has to be read here, before the pty exists. Only for a spawn: a reattach
  // keeps the tools its running process was started with.
  const mcpGroups = !attachGuiMcp && !live ? await registeredGuiMcpGroups(cwd, TOOL_GROUPS).catch(() => []) : [];
  if (!clientStillConnected(ws, "codex", sessionId, early)) return;

  const startFailureMessage = startFailureMessageFor("codex");
  startAndWire(deps, ws, { id: sessionId, tag: "codex", early, startFailureMessage, size }, () =>
    startCodexEntry(deps, ws, { sessionId, live, resumeRolloutId, cwd, attachGuiMcp, mcpGroups }),
  );
}

function resolveAntigravitySession(requested: string | null): ResumableSession {
  return resolveResumableSession(requested, ({ hasLivePty, tmuxAlive }) =>
    // The same rule codex resumes by, including the part that is easy to drop: the key is only
    // treated as a conversation id when a conversation by that name EXISTS. Without the check every
    // key resumes, which means a stale one is handed to `agy --conversation` — agy answers a
    // conversation it cannot find by starting a fresh one, silently, under the old session's id.
    agentResumeId(requested, {
      mappedId: requested ? antigravityConversations.get(requested)?.conversationId : null,
      conversationExists: () => !!requested && antigravityConversationExists(antigravityBrainRoot(), requested),
      hasLivePty,
      tmuxAlive,
    }),
  );
}

// Which conversation a grok connection resumes, and under which id it runs.
//
// Shorter than codex's and antigravity's, and the difference is structural rather than an omission:
// grok takes `--session-id <UUID>` for a NEW conversation, so the id the browser holds IS grok's
// own id. There is no mapping to consult and nothing to hydrate — only the on-disk probe.
//
// It resumes even when tmux is alive, which is where this parts company with `agentResumeId`, and
// for the reason resolveSession spells out for claude: if the tmux session dies between the check
// and the spawn, `tmux new-session -A` re-runs the command — and there `--resume <id>` reattaches
// the conversation where `--session-id <id>` ABORTS ("Session ID … is already in use", measured).
// Withholding the resume in that window makes the window fatal.
function resolveGrokSession(requested: string | null, cwd: string): ResumableSession {
  return resolveResumableSession(requested, ({ hasLivePty }) =>
    // Only when a conversation by that name EXISTS in this directory. Without the check every key
    // resumes, which means a stale one is handed to `grok --resume` — and an agent asked for a
    // conversation it cannot find starts a fresh one, silently, under the old session's id.
    !hasLivePty && requested && grokConversationExists(grokSessionsRoot(), cwd, requested) ? requested : null,
  );
}

// The two agents that read their MCP servers from a file in the DIRECTORY rather than from a
// per-session flag: agy from `.agents/mcp_config.json`, grok from `.grok/config.toml`. That one
// fact decides their whole connection shape and is what claude and codex do NOT share — for them
// `?gui=0` picks which tools the session gets, while here every session in a directory reaches
// whatever that directory registered and the flag only keeps a grid cell out of the sidebar.
//
// So this describes what differs between the two, and handleDirectoryMcpAgentConnection below
// owns everything that does not. grok arrived as a copy of antigravity's handler (#1441) and the
// two had already drifted in wording by the time jscpd named them.
export interface DirectoryMcpWsAgent {
  kind: TerminalWsKind;
  /** How a failed start names this agent to the user. */
  label: string;
  /** Awaited BEFORE the session is resolved, for an agent that keeps a session -> conversation map
   *  on disk: a reconnect arriving mid-read would see an empty map and decline to resume a
   *  conversation that is right there, which is the server-restart case the map exists for.
   *
   *  Required rather than optional, and `null` where there is nothing to wait for (grok mints no
   *  id of its own, so it keeps no map) — an agent added later has to answer this question rather
   *  than inherit "no" by leaving a key out. */
  hydrated: Promise<unknown> | null;
  resolveSession: (requested: string | null, cwd: string) => ResumableSession;
  spawn: (deps: WsRouteDeps) => SpawnDirectoryMcpPty;
}

export const ANTIGRAVITY_WS_AGENT: DirectoryMcpWsAgent = {
  kind: "antigravity",
  label: "Antigravity",
  hydrated: antigravityConversationsHydrated,
  resolveSession: (requested) => resolveAntigravitySession(requested),
  spawn: (deps) => deps.spawnAntigravityPty,
};

export const GROK_WS_AGENT: DirectoryMcpWsAgent = {
  kind: "grok",
  label: "Grok",
  hydrated: null,
  resolveSession: resolveGrokSession,
  spawn: (deps) => deps.spawnGrokPty,
};

// antigravity (?cwd=<dir>, ?session=<id> to reattach/resume) and grok, which connect identically —
// see DirectoryMcpWsAgent for why those two and not claude or codex.
export async function handleDirectoryMcpAgentConnection(agent: DirectoryMcpWsAgent, deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  const { url, requested, cwd, unusable, size } = wsConnectionContext(req);
  if (refuseUnusableWorkspace(ws, agent.kind, unusable, requested)) return;
  const attachGuiMcp = url.searchParams.get("gui") !== "0";
  if (agent.hydrated) await agent.hydrated;
  const { sessionId, live, resumeConversationId } = agent.resolveSession(requested, cwd);
  // The directory's per-tree PORT / DB_NAME (#1367), like every other spawn path — a cell in a
  // worktree gets that tree's own values, not the ones another tree is already serving on.
  await reserveWorktreeEnvForSpawn(cwd, { id: sessionId, live });
  const early = await admitAgentSession(ws, agent.kind, { requested, sessionId, live, cwd, devTerminal: !attachGuiMcp });
  if (!early) return;

  // The directory's registered groups, read here because the lookup reads Claude Code's config
  // files and the spawner is sync. Only for a SPAWN: a reattach keeps the tools its running process
  // was started with, and rewriting the shared file on a reattach would speak for every other
  // session in the directory.
  const mcpGroups = live ? [] : await registeredGuiMcpGroups(cwd, TOOL_GROUPS).catch(() => []);
  if (!clientStillConnected(ws, agent.kind, sessionId, early)) return;
  const startFailureMessage = startFailureMessageFor(agent.label);
  // The reattach goes THROUGH startAndWire like the spawn, not around it: reattachPty only swaps
  // the socket and replays the buffer, so returning early here left a reloaded terminal printing
  // output while ignoring every keystroke, and never detaching or reaping on close.
  startAndWire(deps, ws, { id: sessionId, tag: agent.kind, early, startFailureMessage, size }, () => {
    const entry = live ? deps.reattachPty(live, ws, sessionId) : agent.spawn(deps)(sessionId, ws, resumeConversationId, cwd, { mcpGroups });
    // Single view (gui) = the attached session IS the actively-viewed pane. A grid dev-terminal
    // cell (gui=0) is only "viewed" once focused, and says so with a `view` frame.
    entry.active = attachGuiMcp;
    return entry;
  });
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
  // First-class Antigravity sessions — persistent + reattachable like /ws/launch, but running agy.
  const runAntigravityWss = new WebSocketServer({ noServer: true });
  // First-class grok sessions — same again, running grok under an id this server minted.
  const runGrokWss = new WebSocketServer({ noServer: true });
  const serverFor: Record<TerminalWsKind, WebSocketServer> = {
    claude: wss,
    run: runWss,
    launch: runLaunchWss,
    codex: runCodexWss,
    antigravity: runAntigravityWss,
    grok: runGrokWss,
  };
  deps.server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const kind = terminalWsKind(pathname);
    // Not ours (e.g. /ws/pubsub) — leave it for socket.io's own upgrade handler. This
    // returns BEFORE the origin check on purpose: rejecting here would destroy a socket
    // socket.io is entitled to.
    if (!kind) return;
    const target = serverFor[kind];
    if (!deps.isAllowedOrigin(req.headers.origin, req.socket?.remoteAddress)) {
      console.warn(`[ws] rejected cross-origin upgrade from ${req.headers.origin}`);
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => {
      attachSocketErrorLogger(ws, kind);
      target.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => void handleClaudeConnection(deps, ws, req));
  runWss.on("connection", (ws, req) => handleRunConnection(deps, ws, req));
  runLaunchWss.on("connection", (ws, req) => void handleLaunchConnection(deps, ws, req));
  runCodexWss.on("connection", (ws, req) => void handleCodexConnection(deps, ws, req));
  runAntigravityWss.on("connection", (ws, req) => void handleDirectoryMcpAgentConnection(ANTIGRAVITY_WS_AGENT, deps, ws, req));
  runGrokWss.on("connection", (ws, req) => void handleDirectoryMcpAgentConnection(GROK_WS_AGENT, deps, ws, req));
}
