// The two header badges — `Opus · ctx 35%` and `⇡12.3k ⇣4.5k` — for a session that is NOT Claude
// (#1465).
//
// They were Claude-only for a reason that was never a decision: both come from `usage` and
// `context` on GET /api/session/:id, and the only reader behind that route folded Claude's
// per-project transcript. A codex cell has no file there, so the route answered
// `{ model: null }` + zeroes and the UI — which is agent-agnostic and always has been — rendered
// nothing. Nobody chose to hide them.
//
// What each agent can actually answer is not the same, and this is the whole of it:
//
//   codex        both badges, and a REAL context window (`model_context_window`) rather than the
//                UI's substring table. See codex-usage.ts.
//   grok         both badges, and a REAL context window (`contextWindowTokens`) as codex has.
//                `summary.json` names the model; the accounting is in `signals.json` and
//                `updates.jsonl`. See grok-usage.ts — and note that #1465 shipped saying grok
//                records no tokens, which was true of the two files it read and false of the
//                directory (#1470).
//   muse         both badges, from ONE store: the `model_completed` events in the session.jsonl
//                its sqlite index points at. No window — muse states none, so the client's table
//                answers from the model id. See muse-usage.ts.
//   antigravity  all three, from TWO stores. The model is prose in the `<USER_SETTINGS_CHANGE>`
//                block agy writes into step 0 of the transcript (antigravityModelFromTranscriptHead
//                has the counts behind trusting it). The tokens and the window are not in that file
//                at all — they are protobuf in a SQLite database beside it, read by
//                antigravity-usage.ts, which answers nothing at all unless every field is where it
//                was measured to be. A session with no transcript to read answers `null` — the
//                badge hides, as grok's does before its first turn — and NOT the cwd's last
//                conversation, which is a different session's model (#1468).
//
// A wrong number here is worse than no number: this badge is what a user reads before deciding to
// /compact, so every field is either what the agent stated or absent.
import { promises as fs } from "node:fs";
import type { TerminalAgent } from "../../common/sessionAgent.js";
import type { SessionContextInfo } from "../../common/sessionContext.js";
import { codexBadgesFromRolloutDocs, codexModelFromDocs, EMPTY_CODEX_BADGES, type CodexBadges } from "../agents/codex-usage.js";
import { parseJsonRecord, readTranscriptHead } from "../agents/transcript-head.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { codexRolloutPath } from "../agents/codex-sessions.js";
import { grokModelFromSummary, grokSignalsPath, grokSummaryPath, grokUpdatesPath } from "../agents/grok-sessions.js";
import { grokSessionsRoot } from "../agents/grok-session.js";
import { emptyGrokUsage, foldGrokUsage, grokContextFromSignals, isGrokUsage } from "../agents/grok-usage.js";
import { antigravityBrainRoot, antigravityConversationsRoot, antigravityHome } from "../agents/antigravity-session.js";
import { antigravityModelFromTranscriptHead, antigravityTranscriptPath } from "../agents/antigravity-sessions.js";
import { antigravityBadgesFromDb } from "../agents/antigravity-usage.js";
import { museSessionLogPath, museSessionModel } from "../agents/muse-session.js";
import { copyMuseBadgeFold, emptyMuseBadgeFold, foldMuseBadges, isMuseBadgeFold, type MuseBadgeFold } from "../agents/muse-usage.js";
import { cursorBadges } from "../agents/cursor-usage.js";
import { museConversations, museConversationsHydrated } from "./registry.js";
import { readTailRecords } from "../infra/jsonl-file.js";
import { createTranscriptFold } from "./transcript-fold.js";
import { antigravityConversations, antigravityConversationsHydrated, codexRollouts, codexRolloutsHydrated } from "./registry.js";
import type { SessionUsage } from "./transcript.js";

export interface SessionBadges {
  usage: SessionUsage;
  context: SessionContextInfo;
}

const EMPTY_USAGE: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

const modelOnly = (model: string | null): SessionBadges => ({ usage: EMPTY_USAGE, context: { model, contextTokens: 0 } });

/** Where each agent keeps its sessions. Defaulted from the agent's own module and overridden only
 *  by the specs, which write a rollout and a conversation into a temp directory — the alternative
 *  was a test that reassigns `CODEX_HOME` for the whole worker process. */
export interface BadgeRoots {
  codexSessions?: string;
  grokSessions?: string;
  /** agy's HOME, not one of its two stores: the transcript is under `brain/` and the accounting is
   *  under `conversations/`, and a spec that pointed at one of them would leave the other on the
   *  developer's real disk. */
  antigravityHome?: string;
}

async function codexBadges(sessionKey: string, root: string): Promise<CodexBadges> {
  // The same lookup codexLastTurn makes, and awaited for the same reason: the mapping is read off
  // disk, so a request served during startup would fall through to the key — a mulmoterminal id,
  // which names no rollout.
  await codexRolloutsHydrated;
  const rolloutId = codexRollouts.get(sessionKey)?.conversationId ?? sessionKey;
  const file = codexRolloutPath(root, rolloutId);
  if (!file) return EMPTY_CODEX_BADGES;
  try {
    // The tail: the token fields are running totals and most-recent values, so the end of the file
    // answers the same as the whole of it — at a bounded cost (#998).
    const badges = codexBadgesFromRolloutDocs(readTailRecords(file));
    // The model is the exception, and the reviewers of #1466 caught it: `turn_context` is written
    // ONCE, at the start of a turn, so a turn that writes more than the tail window leaves its own
    // model row outside it. Fresh numbers would then arrive with `model: null` and the badge would
    // hide — on exactly the long sessions the bounded read exists for. The session's first
    // `turn_context` is a few hundred bytes into the file, so the head answers instead.
    //
    // Asked ONLY when the tail named nobody, and only once there is something to label: a rollout
    // that has not counted a token yet is a session with no badge either way, and this route is
    // polled per cell.
    if (badges.context.model !== null || badges.context.contextTokens === 0) return badges;
    return { ...badges, context: { ...badges.context, model: await rolloutHeadModel(file) } };
  } catch {
    return EMPTY_CODEX_BADGES;
  }
}

// Enough for the session_meta record and the first turn_context behind it; the same size the
// rollout listing reads a title from.
const ROLLOUT_HEAD_BYTES = 64 * 1024;

/** The model the session STARTED on, from the head of its rollout. A fallback, so it is the right
 *  answer for every session that has not used `/model` and the closest available one when a
 *  single turn is bigger than the tail window. */
async function rolloutHeadModel(file: string): Promise<string | null> {
  const read = await readTranscriptHead(file, ROLLOUT_HEAD_BYTES);
  if (!read) return null;
  const docs = read.head
    .split("\n")
    .map(parseJsonRecord)
    .filter((d): d is Record<string, unknown> => d !== null);
  return codexModelFromDocs(docs);
}

async function grokBadges(cwd: string, id: string, root: string): Promise<SessionBadges> {
  const [model, context, usage] = await Promise.all([
    readOr(grokSummaryPath(root, cwd, id), null, grokModelFromSummary),
    readOr(grokSignalsPath(root, cwd, id), EMPTY_GROK_CONTEXT, grokContextFromSignals),
    grokUsage(grokUpdatesPath(root, cwd, id)),
  ]);
  // `current_model_id` first: it is what the conversation is running NOW, where signals' own
  // `primaryModelId` is what it has mostly run under — the two differ for the rest of a session
  // after `/model`. Each is asked only because the other can be missing on a conversation grok has
  // just created.
  return { usage, context: { ...context, model: model ?? context.model } };
}

const EMPTY_GROK_CONTEXT: SessionContextInfo = { model: null, contextTokens: 0, contextWindow: null };

/** A file grok may not have written yet is not an error — every reader here wants "nothing to say"
 *  rather than a rejected promise, and a conversation directory is created before it is filled. */
async function readOr<T>(file: string, fallback: T, parse: (text: string) => T): Promise<T> {
  try {
    return parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Summed across every turn, so unlike codex's totals there is no tail that answers the same as the
// file. The fold is what makes that affordable: this route is polled per cell, and after the first
// read a poll costs only the bytes the last turn appended (#1377).
const grokUsageFold = createTranscriptFold<SessionUsage>({
  kind: "grok-usage",
  version: 1,
  isValue: isGrokUsage,
  empty: emptyGrokUsage,
  fold: foldGrokUsage,
  copy: (usage) => ({ ...usage }),
});

async function grokUsage(file: string): Promise<SessionUsage> {
  try {
    const stat = await fs.stat(file);
    return await grokUsageFold.read(file, { mtimeMs: stat.mtimeMs, size: stat.size });
  } catch {
    return emptyGrokUsage();
  }
}

// Step 0 and nothing else is needed, so the head the listing reads a title from answers this too —
// the same 64 KB, never the file. There is deliberately no tail read behind it: the block sits at
// the front, and a second read that almost never finds anything is paid on every session a cell
// renders.
const ANTIGRAVITY_HEAD_BYTES = 64 * 1024;

// Summed across every completed call, as grok's is, and folded for the same reason — except that
// muse's log is the biggest of the four (33 MB measured after a day) and this route is polled per
// cell. See muse-usage.ts.
const museBadgeFold = createTranscriptFold<MuseBadgeFold>({
  kind: "muse-usage",
  version: 1,
  isValue: isMuseBadgeFold,
  empty: emptyMuseBadgeFold,
  fold: foldMuseBadges,
  copy: copyMuseBadgeFold,
});

async function museBadges(sessionKey: string): Promise<SessionBadges> {
  // The codex lookup, for the same reason (see codexBadges): the route is given OUR session id and
  // muse files its log under an id of its own. `?? sessionKey` covers a cell resumed straight onto
  // one of muse's ids, which is what the history list hands over.
  await museConversationsHydrated;
  const sessionId = museConversations.get(sessionKey)?.conversationId ?? sessionKey;
  const file = await museSessionLogPath(sessionId);
  if (!file) return { usage: EMPTY_USAGE, context: { model: null, contextTokens: 0, contextWindow: null } };
  const folded = await museFold(file);
  // Before the first completed call there is nothing in the log to name a model, and a session
  // that has just been started is exactly when a cell first asks. The index knows it anyway.
  const model = folded.model ?? (await museSessionModel(sessionId));
  // No contextWindow: muse states none anywhere a reader can trust, so the client's table answers
  // it from the model id (muse-spark is 1M — common/modelPresets.ts).
  return { usage: folded.usage, context: { model, contextTokens: folded.contextTokens, contextWindow: null } };
}

async function museFold(file: string): Promise<MuseBadgeFold> {
  try {
    const stat = await fs.stat(file);
    return await museBadgeFold.read(file, { mtimeMs: stat.mtimeMs, size: stat.size });
  } catch {
    return emptyMuseBadgeFold();
  }
}

async function antigravityBadges(sessionKey: string, home: string): Promise<SessionBadges> {
  // The codex lookup, for the same reason (see codexBadges): the route is given OUR session id and
  // agy files its transcript under an id of its own. `?? sessionKey` covers a cell resumed straight
  // onto a conversation id; anything naming no transcript reads as unknown, not as a neighbour's.
  //
  // Unknown is the NORMAL state for the first seconds of a fresh cell — agy creates the
  // conversation on the first prompt and the id is watched for, so a cell that has not been typed
  // into yet has nothing to read. It is the spawner's capture that says otherwise, by publishing
  // (spawn-antigravity.ts): without that the answer here never changes, because nothing sets
  // working for an agy session and the cell's only other badge refresh is on a finished turn.
  await antigravityConversationsHydrated;
  const conversationId = antigravityConversations.get(sessionKey)?.conversationId ?? sessionKey;
  const [read, meters] = await Promise.all([
    readTranscriptHead(antigravityTranscriptPath(antigravityBrainRoot(home), conversationId), ANTIGRAVITY_HEAD_BYTES),
    antigravityBadgesFromDb(antigravityConversationsRoot(home), conversationId),
  ]);
  const model = (read && antigravityModelFromTranscriptHead(read.head)) ?? null;
  // The two stores are independent, and so are the two badges: the accounting can be unreadable
  // while the transcript still names the model (and, before agy's first generation, always is).
  if (!meters) return modelOnly(model);
  return { usage: meters.usage, context: { model, ...meters.context } };
}

/**
 * The badges for a session, from whichever log its agent keeps.
 *
 * Claude is NOT here: its two fields fall out of the summary fold the route already runs, and
 * re-reading the transcript to answer them again would double the cost of the busiest route in the
 * app. The caller passes Claude's straight through.
 */
export async function agentBadges(cwd: string, id: string, agent: Exclude<TerminalAgent, "claude">, roots: BadgeRoots = {}): Promise<SessionBadges> {
  if (agent === "codex") return codexBadges(id, roots.codexSessions ?? codexSessionsRoot());
  if (agent === "grok") return grokBadges(cwd, id, roots.grokSessions ?? grokSessionsRoot());
  if (agent === "muse") return museBadges(id);
  // In memory rather than off a log, because cursor writes its counts to no file — see
  // cursor-usage.ts. Synchronous, and awaited only because this function's shape is a promise.
  if (agent === "cursor") return cursorBadges(id);
  // EXPLICIT, and it used to be the fall-through. Every agent added after this function was written
  // landed on agy's reader by default — a copilot id looked up under agy's HOME, which answers
  // nothing only because nothing is there to answer. Copilot's own counts are in
  // `~/.copilot/session-store.db` (`assistant_usage_events`) and reading them is row 15's remaining
  // follow-up; until then it has no badge, which is what it had.
  if (agent === "copilot") return { usage: EMPTY_USAGE, context: { model: null, contextTokens: 0 } };
  return antigravityBadges(id, roots.antigravityHome ?? antigravityHome());
}
