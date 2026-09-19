// Remote host: let a phone drive MulmoTerminal over the Firestore command channel.
//
// This wires the singleton only — the toolbar Connect control (which signs in as the user) starts
// the actual Firestore runner + presence heartbeat. The listing and the screens live beside this
// in hostSessionList.ts / hostScreens.ts; what stays here is what needs the boot's own wiring.
import { randomUUID } from "node:crypto";
import { initRemoteHostBackend } from "./index.js";
import { listTerminalSessions } from "./hostSessionList.js";
import { captureTerminalScreen } from "./hostScreens.js";
import { decideLaunchTerminal, NO_BROWSER_ERROR } from "./launchTerminal.js";
import { canClearInputBox } from "./terminalInput.js";
import { activity, markUnplacedSession, ptys } from "../../session/registry.js";
import { tmuxHeldSessionIdsAsync } from "../../infra/tmux.js";
import { agentOfSession, cwdOfSession } from "../../session/session-lookup.js";
import { issueSpawnOptions } from "../../session/issue-spawn-options.js";
import { sessionTranscriptView } from "../../session/transcript-view-read.js";
import { writeToSession } from "../../session/write-to-session.js";
import { answerQuestionOnHost } from "../../session/answerQuestionOnHost.js";
import type { SpawnClaudePty } from "../../session/spawn-claude.js";
import type { createToolStores } from "../../session/tool-store.js";
import { openQuestionOf } from "../../../common/askQuestion.js";
import { submitSequenceForAgent } from "../../../common/terminalSubmit.js";
import { LAUNCH_TERMINAL_CHANNEL } from "../../../common/launchAgent.js";
import { getTerminalSubmit } from "../../config/config-routes.js";
import { CLAUDE_CWD, SESSION_ID_RE } from "../../config/env.js";

export interface RemoteHostDeps {
  spawnClaudePty: SpawnClaudePty;
  toolStores: ReturnType<typeof createToolStores>;
  outputBufferLimit: number;
  /** One tab, not every tab — see launchTerminal below. Answers whether anyone took it. */
  publishToOne: (channel: string, data: unknown) => boolean;
  subscriberCount: (channel: string) => number;
}

// startChat reuses the claude spawn for a VISIBLE session the user can watch. Started from the
// PHONE, so by definition no browser placed it: marked unplaced so the next grid to load adopts it
// instead of leaving a live agent with nowhere to appear.
const spawnChat = (spawnClaudePty: SpawnClaudePty, message: string) => {
  const sessionId = randomUUID();
  spawnClaudePty(sessionId, null, null, { initialPrompt: message });
  markUnplacedSession(sessionId);
  return { chatId: sessionId };
};

// Starting work on an issue from the phone (#1184). The same spawn the desktop's POST
// /api/issues/start makes, plus the unplaced mark for the same reason as above: the phone has no
// grid, so nothing else would give this session a cell. `run` submits the seed rather than leaving
// it in the box (#1253) — see issueSpawnOptions for why the choice is a function and not two keys.
const spawnIssueSeed = (spawnClaudePty: SpawnClaudePty, cwd: string, seed: string, run: boolean): string => {
  const sessionId = randomUUID();
  spawnClaudePty(sessionId, null, null, issueSpawnOptions(cwd, seed, run));
  markUnplacedSession(sessionId);
  return sessionId;
};

// Does this host hold that session RIGHT NOW? Exact by construction, which is the point: tmux
// resolves `-t NAME` by PREFIX, so `has-session -t mt-<uuid>` also answers yes for a session named
// `mt-<uuid>-suffix` — measured on tmux 3.6a, and true of capture-pane and display-message too
// (#2192). Listing the names and comparing them cannot match a prefix. The async form is also the
// one a REQUEST must use: the sync variant holds the event loop, and this runs on a phone command.
const sessionExistsHere = async (sessionId: unknown): Promise<boolean> => {
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) return false;
  if (ptys.has(sessionId)) return true; // a live pty is existence enough, and costs no subprocess
  return (await tmuxHeldSessionIdsAsync())?.includes(sessionId) ?? false;
};

// The phone asked for a new terminal in the directory of the session it was viewing (#831). The
// grid lives in the browser — markDevTerminalSession is only ever reached through the terminal
// WebSocket — so the host cannot open the cell, and publishes the request to whichever tab is
// connected instead. The phone sends a session id, never a path.
const launchTerminal = async (deps: RemoteHostDeps, agent: unknown, sessionId: unknown) => {
  const decision = decideLaunchTerminal({
    agent,
    sessionId,
    // The same lookup the row the phone tapped was built from. Asking `ptys` alone refused every
    // session that outlived a restart — which tmux does by design — while the list it was chosen
    // from showed a directory for it (#2181). `decideLaunchTerminal` tests the answer with `!cwd`,
    // so "" and null refuse alike and the wording of that refusal is unchanged.
    cwdOf: cwdOfSession,
    sessionExists: await sessionExistsHere(sessionId),
    listenerCount: deps.subscriberCount(LAUNCH_TERMINAL_CHANNEL),
  });
  if (!decision.ok) return decision;
  // ONE tab, not every tab: this asks for a terminal to be opened, so a broadcast would open one
  // per connected browser. Delivery is also the authority on whether anyone was there — the count
  // above was read a moment earlier and that tab may have closed since.
  return deps.publishToOne(LAUNCH_TERMINAL_CHANNEL, decision.request) ? { ok: true as const } : { ok: false as const, error: NO_BROWSER_ERROR };
};

export function initRemoteHost(deps: RemoteHostDeps): void {
  const { spawnClaudePty, toolStores } = deps;
  initRemoteHostBackend({
    workspace: CLAUDE_CWD,
    spawnChat: (message) => spawnChat(spawnClaudePty, message),
    spawnIssueSeed: (cwd, seed, run) => spawnIssueSeed(spawnClaudePty, cwd, seed, run),
    launchTerminal: (agent, sessionId) => launchTerminal(deps, agent, sessionId),
    listTerminalSessions,
    captureTerminalScreen: (sessionId) => captureTerminalScreen(sessionId, deps.outputBufferLimit),
    // The phone's transcript view (#1751), through the picker's own cwd lookup — the transcript is
    // per PROJECT, so the host's workspace would answer with another cell's session.
    // `agentOf` is consulted only when no agent's log holds this session — it chooses between
    // "nothing written" and "this agent's conversation is not readable here yet" (#1822), never
    // which reader answers.
    captureTerminalTranscript: (sessionId) => sessionTranscriptView(cwdOfSession(sessionId), sessionId, { agentOf: agentOfSession }),
    writeToSession,
    // The same two functions the browser's pane reaches through /api/question (#1685): one place
    // decides whether a dialog is still open, and one place decides which bytes reach the PTY.
    // DELIBERATELY not gated on `questionPaneEnabled`, unlike the browser's /api/question. That
    // setting is about the PANE — a panel that types into the terminal you are sitting at, next to
    // the dialog it is answering. The phone is the case where nobody is at that keyboard, which is
    // the whole reason it exists, so it stays available. Do not "fix" the asymmetry.
    openQuestion: async (id) => openQuestionOf(await toolStores.toolCallsStore.get(id), id),
    answerQuestion: (id, toolUseId, picks, text) => answerQuestionOnHost(id, toolUseId, picks, (sid) => toolStores.toolCallsStore.get(sid), text),
    // Whether the phone's typing may empty the input box before pasting, so only the phone's text
    // is submitted (#572). The rule itself lives with the sender.
    canClearBox: (sessionId) => canClearInputBox(ptys.get(sessionId)?.agent, activity.get(sessionId)?.working),
    // The byte(s) that submit for this session (#772), resolved live from config so the phone's
    // "send" commits the paste the same way the keyboard does. Scoped to the session's agent — the
    // mapping is Claude's binding, so a shell/codex session in the picker keeps plain CR (same
    // agent lookup as canClearBox above).
    submitSequence: (sessionId) => submitSequenceForAgent(ptys.get(sessionId)?.agent, getTerminalSubmit()),
    // Which agent the typed text is going to, for the completion-menu guard (#1142) — same lookup
    // again, because that guard is Claude Code's behaviour and nobody else's.
    sessionAgent: (sessionId) => ptys.get(sessionId)?.agent,
  });
}
