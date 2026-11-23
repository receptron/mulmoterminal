// What sendToSession / waitForSessionReply accept, who they may address, and how one wait runs
// (#3404). Pure: the route hands in who started which session, the turn reader and the clock.
import { SESSION_ID_RE } from "../config/env.js";
import { isRecord } from "../../common/isRecord.js";
import { answersOurSend, type TurnSnapshot } from "../../common/turnCorrelation.js";
import { sanitizeTerminalInput } from "../backends/remoteHost/terminalInput.js";
import { REPLY_MAX_CHARS } from "./terminalReply.js";

// codex gives up on an MCP call after its default tool timeout (60s), so a default wait answers
// before that and a codex caller is told "still working" instead of a timeout error.
export const DEFAULT_WAIT_SECONDS = 45;
// The broker's fetch stops waiting for response headers at undici's default (300s); a wait that
// outlived it would be answered to nobody.
export const MAX_WAIT_SECONDS = 240;
export const REPLY_POLL_MS = 2000;
// Room kept for the tag every message carries (askTag), so the tagged text still fits the sender's cap.
const TAG_RESERVE_CHARS = 40;
export const SEND_MAX_CHARS = REPLY_MAX_CHARS - TAG_RESERVE_CHARS;
// A reply goes back as a tool result, read by a model; past this it is cut and says so.
export const REPLY_RESULT_MAX_CHARS = 20_000;
const MS_PER_SECOND = 1000;

export type Parsed<T> = ({ ok: true } & T) | { ok: false; error: string };

const refuse = (error: string): { ok: false; error: string } => ({ ok: false, error });

function sessionOf(record: Record<string, unknown>): string | null {
  return typeof record.session === "string" && SESSION_ID_RE.test(record.session) ? record.session : null;
}

const SESSION_REQUIRED = "`session` must be the chatId spawnBackgroundChat returned.";

export function parseSendRequest(body: unknown): Parsed<{ session: string; message: string }> {
  const record = isRecord(body) ? body : {};
  const session = sessionOf(record);
  if (session === null) return refuse(SESSION_REQUIRED);
  const message = typeof record.message === "string" ? record.message : "";
  if (sanitizeTerminalInput(message) === "") return refuse("`message` is required: the text to type into the session.");
  if (message.length > SEND_MAX_CHARS) return refuse(`\`message\` is longer than ${SEND_MAX_CHARS} characters.`);
  // Sanitised HERE, so the text remembered for the wait is the text the session records as its
  // prompt: a control byte left in would never match it.
  return { ok: true, session, message: sanitizeTerminalInput(message) };
}

/** Appended to each message. The wait recognises the reply by the end of the prompt it answers, so
 *  without a per-send tag a message sent twice ("re-review, please") matches the EARLIER turn and
 *  hands back its old reply at once. */
export const askTag = (nonce: string): string => ` [sendToSession ${nonce}]`;

/** The wait asked for, in ms: absent is the default, and anything out of range is pulled into it
 *  rather than refused — a model asking for an hour wants "as long as you can". */
function waitMsOf(value: unknown): number {
  const seconds = typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, MAX_WAIT_SECONDS) : DEFAULT_WAIT_SECONDS;
  return Math.max(1, seconds) * MS_PER_SECOND;
}

export function parseWaitRequest(body: unknown): Parsed<{ session: string; waitMs: number }> {
  const record = isRecord(body) ? body : {};
  const session = sessionOf(record);
  if (session === null) return refuse(SESSION_REQUIRED);
  return { ok: true, session, waitMs: waitMsOf(record.waitSeconds) };
}

/** Why `caller` may not address `target`, or null when it may: only the session that started it. */
export function addressRefusal(caller: string, target: string, parentOf: (session: string) => string | undefined): string | null {
  if (target === caller) return "That is your own session; send to a session you started.";
  const parent = parentOf(target);
  if (parent === caller) return null;
  if (parent !== undefined) return `Session ${target} was started by another session, and only that one can send to it.`;
  return `Session ${target} was not started by you through spawnBackgroundChat (or MulmoTerminal restarted since), so you cannot send to it.`;
}

export interface ReplyWaitDeps {
  readTurn: () => Promise<TurnSnapshot>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** The caller hung up; nobody is left to answer. */
  isAborted: () => boolean;
}

export type ReplyWait = { status: "answered"; reply: string } | { status: "waiting" } | { status: "aborted" };

/** Poll until the session's last completed turn is the one OUR text started. Read before the first
 *  sleep, so a reply that already arrived is answered at once. */
export async function awaitReply(sent: string, waitMs: number, deps: ReplyWaitDeps): Promise<ReplyWait> {
  const startedAt = deps.now();
  for (;;) {
    const turn = await deps.readTurn();
    if (answersOurSend(turn.prompt, sent)) return { status: "answered", reply: turn.reply ?? "" };
    if (deps.now() - startedAt >= waitMs) return { status: "waiting" };
    await deps.sleep(REPLY_POLL_MS);
    if (deps.isAborted()) return { status: "aborted" };
  }
}

function clipped(reply: string): string {
  if (reply.length <= REPLY_RESULT_MAX_CHARS) return reply;
  return `${reply.slice(0, REPLY_RESULT_MAX_CHARS)}\n\n[cut at ${REPLY_RESULT_MAX_CHARS} characters]`;
}

/** What the calling agent is told. */
export function replyMessage(session: string, wait: ReplyWait): string {
  if (wait.status === "waiting") return `Session ${session} has not answered yet. Call waitForSessionReply again to keep waiting.`;
  if (wait.status === "aborted") return `Stopped waiting for session ${session}.`;
  if (wait.reply.trim() === "") return `Session ${session} finished its turn without any text.`;
  return `Session ${session} replied:\n\n${clipped(wait.reply)}`;
}
