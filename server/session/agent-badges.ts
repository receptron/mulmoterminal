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
//   grok         the model only. `summary.json` names it; a conversation directory holds no token
//                accounting at all (the only `token` fields in one are `first_token` timings and a
//                WebFetch tool parameter), so the usage badge stays hidden — it hides itself when
//                the totals are zero.
//   antigravity  the model name from the user turn's setting block (`<USER_SETTINGS_CHANGE>`), falling
//                back to "antigravity" if unrecorded; agy records no token usage.
//
// A wrong number here is worse than no number: this badge is what a user reads before deciding to
// /compact, so every field is either what the agent stated or absent.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { TerminalAgent } from "../../common/sessionAgent.js";
import type { SessionContextInfo } from "../../common/sessionContext.js";
import { codexBadgesFromRolloutDocs, codexModelFromDocs, EMPTY_CODEX_BADGES, type CodexBadges } from "../agents/codex-usage.js";
import { parseJsonRecord, readTranscriptHead } from "../agents/transcript-head.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { codexRolloutPath } from "../agents/codex-sessions.js";
import { grokModelFromSummary, grokSummaryPath } from "../agents/grok-sessions.js";
import { grokSessionsRoot } from "../agents/grok-session.js";
import { antigravityBrainRoot, antigravityConversationExists, antigravityHome } from "../agents/antigravity-session.js";
import { antigravityTranscriptPath } from "../agents/antigravity-sessions.js";
import { readTailRecords } from "../infra/jsonl-file.js";
import { antigravityConversations, antigravityConversationsHydrated, codexRollouts, codexRolloutsHydrated } from "./registry.js";
import type { SessionUsage } from "./transcript.js";

export interface SessionBadges {
  usage: SessionUsage;
  context: SessionContextInfo;
}

const EMPTY_USAGE: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

/** What the badge calls an agy session as a fallback when unrecorded. */
export const ANTIGRAVITY_MODEL_LABEL = "antigravity";

const modelOnly = (model: string | null): SessionBadges => ({ usage: EMPTY_USAGE, context: { model, contextTokens: 0 } });

const ANTIGRAVITY_MODEL_RE = /Model Selection` from .+? to (.+?)\.(?:\s+(?:No need|If reporting)|$|\n)/;

/** The model name mentioned in an Antigravity transcript step, or null if unrecorded. */
export function antigravityModelFromDocs(docs: Iterable<Record<string, unknown>>): string | null {
  let model: string | null = null;
  for (const d of docs) {
    if (d.type === "USER_INPUT" && typeof d.content === "string") {
      const m = ANTIGRAVITY_MODEL_RE.exec(d.content);
      if (m?.[1]) model = m[1];
    }
  }
  return model;
}

async function lastConversationForCwd(cwd: string): Promise<string | null> {
  try {
    const file = path.join(antigravityHome(), "cache", "last_conversations.json");
    const content = await fs.readFile(file, "utf8");
    const json = JSON.parse(content) as Record<string, unknown>;
    return typeof json[cwd] === "string" ? json[cwd] : null;
  } catch {
    return null;
  }
}

/** Where each agent keeps its sessions. Defaulted from the agent's own module and overridden only
 *  by the specs, which write a rollout and a conversation into a temp directory — the alternative
 *  was a test that reassigns `CODEX_HOME` for the whole worker process. */
export interface BadgeRoots {
  codexSessions?: string;
  grokSessions?: string;
  antigravityBrain?: string;
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
  try {
    return modelOnly(grokModelFromSummary(await fs.readFile(grokSummaryPath(root, cwd, id), "utf8")));
  } catch {
    return modelOnly(null); // no conversation directory yet, or none in this cwd
  }
}

async function antigravityBadges(cwd: string, sessionKey: string, root: string): Promise<SessionBadges> {
  await antigravityConversationsHydrated;
  let conversationId = antigravityConversations.get(sessionKey)?.conversationId ?? sessionKey;
  if (!antigravityConversationExists(root, conversationId)) {
    const lastId = await lastConversationForCwd(cwd);
    if (lastId && antigravityConversationExists(root, lastId)) {
      conversationId = lastId;
    }
  }
  const file = antigravityTranscriptPath(root, conversationId);
  try {
    // Check tail first for recent model setting changes in long sessions, fallback to head
    let model = antigravityModelFromDocs(readTailRecords(file));
    if (!model) {
      const read = await readTranscriptHead(file, ROLLOUT_HEAD_BYTES);
      if (read) {
        const docs = read.head
          .split("\n")
          .map(parseJsonRecord)
          .filter((d): d is Record<string, unknown> => d !== null);
        model = antigravityModelFromDocs(docs);
      }
    }
    return modelOnly(model ?? ANTIGRAVITY_MODEL_LABEL);
  } catch {
    return modelOnly(ANTIGRAVITY_MODEL_LABEL);
  }
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
  return antigravityBadges(cwd, id, roots.antigravityBrain ?? antigravityBrainRoot());
}
