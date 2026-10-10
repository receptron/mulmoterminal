// What the remote-host handlers need from the process around them.
//
// MulmoClaude's handler table is a static const, because its handlers reach their engines through
// module-level imports. Ours cannot be: the workspace, the chat spawner, the attachment ingester
// and every terminal accessor are wired in server/index.ts, where the PTY table lives. So this
// host keeps a FACTORY (see ./index.ts) and passes deps down — a deliberate divergence from the
// reference host, forced by where the state lives rather than by taste.
import type { SessionAgent, TerminalAgent } from "../../../../common/sessionAgent.js";
import type { SpawnedSession } from "../../../git/issue-work.js";
import type { TerminalSessionListing } from "../dirIcons.js";
import type { IngestResult } from "../ingestAttachments.js";
import type { MobileFileStager } from "../mobileFileStaging.js";
import type { SessionScreen } from "../terminalScreen.js";
import type { TranscriptPage, TranscriptView } from "../../../../common/transcriptView.js";
import type { PastSessionRow } from "../../../session/list/past-session-rows.js";
import type { AskQuestionEvent } from "../../../../common/askQuestion.js";
import type { AnswerResult } from "../../../../common/askQuestion.js";

export interface RemoteHostHandlerDeps {
  workspace: string;
  // Start a visible chat seeded with `message`; returns the new session id.
  spawnChat: (message: string) => { chatId: string };
  // Download the phone's staged uploads (by storage_id) into the workspace and return
  // path-only attachments plus a deferred staging cleanup (remoteHost/ingestAttachments.ts).
  ingest: (storageIds: string[]) => Promise<IngestResult>;
  // Stages a file too large for the command document in the owner's Storage for an hour (#2911).
  // Built beside `ingest` for the same reason: it needs the LIVE session's storage and uid.
  mobileFileStager: MobileFileStager;
  // The phone's remote terminal view (#435) — the picker's list and one session's
  // current screen. Wired in server/index.ts, where the PTY table lives. The list
  // arrives with its directory images already packed (#1556), since the same place
  // that knows each session's cwd is the one that can read them.
  listTerminalSessions: () => Promise<TerminalSessionListing>;
  captureTerminalScreen: (sessionId: string) => Promise<SessionScreen>;
  // The same session's CONVERSATION rather than its pane (#1751). Wired in server/index.ts for the
  // reason above and one more: the transcript lives under the SESSION's directory, so the same
  // lookup that gives the list its cwd is what points this at the right project.
  captureTerminalTranscript: (sessionId: string) => Promise<TranscriptView>;
  // The past sessions of an open session's DIRECTORY, and one of their conversations (#2999). The
  // phone names the open session, never the directory — the same boundary as launchTerminal.
  listPastSessions: (sessionId: string) => Promise<{ cwd: string; sessions: PastSessionRow[] }>;
  readPastTranscript: (sessionId: string, pastSessionId: string, before: string | null) => Promise<TranscriptPage>;
  // Type into one session's live PTY (#445). Returns false when no PTY is attached
  // in this process — a tmux session that outlived a restart stays viewable but not
  // writable from here.
  writeToSession: (sessionId: string, chunk: string) => boolean;
  /** The AskUserQuestion dialog this session is blocked on, or null (#1685). */
  openQuestion: (sessionId: string) => Promise<AskQuestionEvent | null>;
  /** Answer it by option index. The host owns every byte that reaches the PTY. */
  answerQuestion: (sessionId: string, toolUseId: string, picks: unknown, text?: unknown) => Promise<AnswerResult>;
  // Whether typing may empty the session's input box first, so only the phone's text
  // is submitted (#572). Answered in server/index.ts, where the agent kind and the
  // turn state live.
  canClearBox: (sessionId: string) => boolean;
  // The byte(s) that submit for a given session (#772), read live from config. The phone
  // sends only text; which byte commits it is the host's Claude binding — but only for a
  // Claude session, so this is resolved per session id (shell/codex stay on plain CR).
  submitSequence: (sessionId: string) => string;
  // Which agent runs in a given session, for the completion-menu guard on typed text (#1142).
  // Same lookup as canClearBox / submitSequence: only Claude Code has the menu that eats a
  // submit, and only there is the guard's trailing space not real input.
  sessionAgent: (sessionId: string) => SessionAgent | undefined;
  // Start a session in the worktree the host just cut for an issue, seeded with the issue (#1184),
  // as the agent asked for (#2228); answers which session, which agent, and whether the seed runs. Wired in server/index.ts, which owns both the
  // spawner and the unplaced mark — the mark is what gets a session nobody's browser asked for a
  // cell, and it is why this command needs no open tab the way launchTerminal does.
  //
  // `run` submits the seed instead of leaving it for review (#1253). Only the host can do this:
  // the seed is typed once the TUI's input box has painted, so an Enter sent from outside would
  // race that, and this side is the one that knows when it landed.
  spawnIssueSeed: (agent: TerminalAgent, cwd: string, seed: string, run: boolean) => Promise<SpawnedSession>;
  // Open a new grid terminal in the directory of the session the phone is looking at
  // (#831). Answered in server/index.ts, which owns the PTY table and the pub/sub the
  // grid listens on. Resolves to an error string when it could not be started.
  launchTerminal: (agent: unknown, sessionId: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
}
