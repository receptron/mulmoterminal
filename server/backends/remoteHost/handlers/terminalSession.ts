// The phone's remote terminal view (#435): pick a session, read its screen, and — since #445 —
// type into it. A screen is a fixed-size WINDOW ending at the live prompt — a bounded number of
// rows and bytes, see SCREEN_HISTORY_ROWS — so unlike collections it needs no paging to stay
// under the 1 MiB command-doc ceiling.
//
// No MulmoClaude counterpart: that host has no PTY table to look at.
import { toJsonObject, type CommandHandlers, type JsonObject } from "@mulmoclaude/core/remote-host";
import { SESSION_ID_RE } from "../../../config/env.js";
import { createTerminalInputSender } from "../terminalInput.js";
import type { RemoteHostHandlerDeps } from "./deps.js";

// What the phone shows when an answer is refused. Wording rather than a code: the phone has no
// notion of question dialogs beyond the buttons it drew.
const ANSWER_REFUSED = {
  closed: "That question was already answered.",
  "bad-picks": "Those choices do not match the question.",
  unwritable: "This session cannot be typed into — it outlived a server restart.",
  partial: "Part of that answer went in before it was interrupted. Finish it in the terminal.",
} as const;

type TerminalSessionDeps = Pick<
  RemoteHostHandlerDeps,
  | "listTerminalSessions"
  | "captureTerminalScreen"
  | "captureTerminalTranscript"
  | "writeToSession"
  | "canClearBox"
  | "submitSequence"
  | "sessionAgent"
  | "launchTerminal"
  | "openQuestion"
  | "answerQuestion"
>;

export const createTerminalSessionHandlers = ({
  listTerminalSessions,
  captureTerminalScreen,
  captureTerminalTranscript,
  writeToSession,
  canClearBox,
  submitSequence,
  sessionAgent,
  launchTerminal,
  openQuestion,
  answerQuestion,
}: TerminalSessionDeps): CommandHandlers => {
  // One sender per host, so its per-session ordering actually spans every command.
  const sendInput = createTerminalInputSender({ writeToSession, canClearBox, submitSequence, sessionAgent });
  return {
    // `{ sessions, icons }` — the rows plus the directory images they point into by `iconId`,
    // deduplicated by content so a repository's worktrees send one copy between them (#1556).
    listTerminalSessions: async () => toJsonObject(await listTerminalSessions()),

    // `suggestion` is the agent's own dim ghost text — the phone offers it as a chip,
    // since it has no Tab key to accept it with (#563). The screen also carries the
    // session's cwd / branch / summary / prompt when the host knows them, so the phone can
    // head the terminal with what the grid cell shows (#786); the whole SessionScreen is
    // the wire shape, so a field added there reaches the phone without another edit here.
    getTerminalScreen: async (params: JsonObject) => {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      if (!sessionId) throw new Error("sessionId is required");
      return toJsonObject(await captureTerminalScreen(sessionId));
    },

    // The same session's CONVERSATION rather than its pane (#1751). A claude cell runs on the
    // alternate screen with no scrollback, so the screen above is the only thing the phone could
    // see; this is what claude wrote to disk, folded into turns. `status` says why there is nothing
    // to show when there is nothing — see TranscriptView.
    //
    // The first handler in this file to turn a sessionId into a FILE PATH, and so the first that has
    // to check its SHAPE. "Non-empty string" is enough for the others because they hand the id to
    // tmux; unchecked here, a `../`-bearing id reads a file outside the project's session directory.
    getTerminalTranscript: async (params: JsonObject) => {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      if (!sessionId) throw new Error("sessionId is required");
      if (!SESSION_ID_RE.test(sessionId)) throw new Error("sessionId is not a session id");
      return toJsonObject(await captureTerminalTranscript(sessionId));
    },

    // Type a line into the session and press Enter, as if the user were at the
    // keyboard. The phone sends only text; the framing, sanitizing and Enter timing
    // are terminalInput.ts's job.
    sendTerminalInput: async (params: JsonObject) => {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      if (!sessionId) throw new Error("sessionId is required");
      const text = typeof params.text === "string" ? params.text : "";
      return toJsonObject(await sendInput(sessionId, text));
    },

    // The AskUserQuestion dialog this session is blocked on, if any (#1685). Answered from the
    // phone by INDEX, never by keystroke: the phone says which options it chose and the host turns
    // that into the arrows and Enter that drive the real dialog. So nothing the phone sends can
    // reach the terminal as a control byte — the same boundary sendTerminalInput draws, drawn
    // tighter, since here there is no free text at all.
    getOpenQuestion: async (params: JsonObject) => {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      if (!sessionId) throw new Error("sessionId is required");
      return toJsonObject({ question: await openQuestion(sessionId) });
    },

    // Throwing on refusal rather than returning it: the reason is what the phone shows, and every
    // one of them is something the user can act on — the dialog was answered from somewhere else,
    // or this session outlived a server restart and has no PTY to type into.
    answerQuestion: async (params: JsonObject) => {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      const toolUseId = typeof params.toolUseId === "string" ? params.toolUseId : "";
      if (!sessionId || !toolUseId) throw new Error("sessionId and toolUseId are required");
      // `text` answers in the user's own words, through the dialog's own `Type something` field
      // (#1693). Sanitized host-side like any other text the phone sends.
      const result = await answerQuestion(sessionId, toolUseId, params.picks, params.text);
      if (!result.ok) throw new Error(ANSWER_REFUSED[result.reason]);
      return toJsonObject(result);
    },

    // Open a NEW grid terminal in the directory of the session the phone is viewing (#831).
    // The phone names the session, never a path: the host looks the directory up, so a
    // remote client cannot choose where a process starts.
    //
    // Throwing rather than returning the error is what puts the reason on the phone's
    // screen — the command layer turns a rejection into the message it shows, and the
    // most likely failure ("no browser is open") is one the user can act on.
    launchTerminal: async (params: JsonObject) => {
      const result = await launchTerminal(params.agent, params.sessionId);
      if (!result.ok) throw new Error(result.error);
      return toJsonObject({ ok: true });
    },
  };
};
