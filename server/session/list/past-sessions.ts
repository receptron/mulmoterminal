// One directory's past sessions, across every hosted agent, and the conversation of one of them —
// for the phone (#2999). The browser reads the same stores through one route per agent
// (session-routes.ts); the phone gets them merged, because it has no Agent Picker to choose with.
import type { TranscriptPage } from "../../../common/transcriptView.js";
import { TERMINAL_AGENTS, type TerminalAgent } from "../../../common/sessionAgent.js";
import { isProbeSessionId } from "../../agents/probe/probe-session.js";
import { listCodexSessions } from "../../agents/codex/codex-sessions.js";
import { listCopilotSessionsForCwd } from "../../agents/copilot/copilot-sessions.js";
import { listCursorSessionsForCwd } from "../../agents/cursor/cursor-sessions.js";
import { antigravityBrainRoot } from "../../agents/antigravity/antigravity-session.js";
import { listAntigravitySessions } from "../../agents/antigravity/antigravity-sessions.js";
import { grokSessionsRoot } from "../../agents/grok/grok-session.js";
import { listGrokSessions } from "../../agents/grok/grok-sessions.js";
import { listMuseSessionsForCwd } from "../../agents/muse/muse-session.js";
import {
  antigravityConversations,
  antigravityConversationsHydrated,
  backgroundSessionsHydrated,
  isBackgroundSession,
  refreshAgentConversations,
  sessionMemosHydrated,
  translationWorkerIds,
} from "../registry.js";
import { claudeDiskStats, readSessionMeta, transcriptFilesIn } from "../session-reads.js";
import { agentHomeChoices, codexSessionsUnder } from "../session-home.js";
import { hasReader, parseTranscriptCursor, sessionTranscriptPage } from "../transcript/transcript-view-read.js";
import { mergePastSessionRows, type AgentSessionRow, type PastSessionRow } from "./past-session-rows.js";
import { gatedPastTranscriptPage } from "./past-transcript-gate.js";

/** Rows per agent and in the merged list — the browser's per-agent picker shows the same number. */
export const PAST_SESSION_LIMIT = 50;

const byNewest = (a: { mtime: number }, b: { mtime: number }): number => b.mtime - a.mtime;

async function claudeRows(cwd: string): Promise<AgentSessionRow[]> {
  await backgroundSessionsHydrated;
  await sessionMemosHydrated; // a memo is the row's title when there is one
  const stats = (await claudeDiskStats(cwd, transcriptFilesIn))
    .filter((s) => !translationWorkerIds.has(s.id) && !isProbeSessionId(s.id) && !isBackgroundSession(s.id))
    .sort(byNewest)
    .slice(0, PAST_SESSION_LIMIT);
  const metas = await Promise.all(
    stats.map((s) =>
      readSessionMeta(s.dir, s.file).then(
        (meta) => ({ ...meta, account: s.account }),
        () => null,
      ),
    ),
  );
  return metas.filter((meta) => meta !== null).map(({ id, title, mtime, account }) => ({ id, title, mtime, account }));
}

async function codexRows(cwd: string): Promise<AgentSessionRow[]> {
  const perHome = await Promise.all(
    agentHomeChoices("codex").map(async ({ accountId, home }) => {
      const rows = await listCodexSessions(codexSessionsUnder(home), cwd, PAST_SESSION_LIMIT);
      return rows.map((row) => ({ ...row, account: accountId }));
    }),
  );
  return perHome.flat();
}

async function antigravityRows(cwd: string): Promise<AgentSessionRow[]> {
  await antigravityConversationsHydrated;
  // The rows are drawn from the conversation map, so a conversation another MulmoTerminal process
  // started since hydration has to be folded in first or it is missing from the list.
  await refreshAgentConversations();
  return listAntigravitySessions(antigravityBrainRoot(), antigravityConversations.values(), cwd, PAST_SESSION_LIMIT);
}

async function museRows(cwd: string): Promise<AgentSessionRow[]> {
  const metas = await listMuseSessionsForCwd(cwd);
  return metas.map((m) => ({ id: m.id, title: m.title, mtime: m.updatedAtUs ? m.updatedAtUs / 1000 : 0 }));
}

async function copilotRows(cwd: string): Promise<AgentSessionRow[]> {
  const metas = await listCopilotSessionsForCwd(cwd);
  return metas.map((m) => ({ id: m.id, title: m.title, mtime: m.mtimeMs }));
}

async function cursorRows(cwd: string): Promise<AgentSessionRow[]> {
  const metas = await listCursorSessionsForCwd(cwd, undefined, PAST_SESSION_LIMIT);
  return metas.map((m) => ({ id: m.id, title: m.title, mtime: m.mtimeMs }));
}

const AGENT_ROWS: Record<TerminalAgent, (cwd: string) => Promise<AgentSessionRow[]>> = {
  claude: claudeRows,
  codex: codexRows,
  antigravity: antigravityRows,
  grok: (cwd) => listGrokSessions(grokSessionsRoot(), cwd, PAST_SESSION_LIMIT),
  muse: museRows,
  copilot: copilotRows,
  cursor: cursorRows,
};

/** Every agent's past sessions in `cwd`, newest first. An agent whose store fails to read is
 *  logged and left out, so one broken store (a locked sqlite, a moved format) does not blank the
 *  list for the others. */
export async function listPastSessions(cwd: string): Promise<PastSessionRow[]> {
  const settled = await Promise.allSettled(TERMINAL_AGENTS.map(async (agent) => ({ agent, rows: await AGENT_ROWS[agent](cwd) })));
  const perAgent = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    console.warn(`[remote-host] past sessions: ${TERMINAL_AGENTS[index]} list failed in ${cwd}:`, result.reason);
    return [];
  });
  return mergePastSessionRows(perAgent, hasReader, PAST_SESSION_LIMIT);
}

/** One page of a past session's conversation, read only when `cwd`'s own list holds it. */
export const pastTranscriptPage = (cwd: string, pastSessionId: string, before: string | null): Promise<TranscriptPage> =>
  gatedPastTranscriptPage(
    {
      listPastSessions,
      readPage: (dir, id, cursor, agent) => sessionTranscriptPage(dir, id, cursor, { agentOf: () => agent }),
      isCursor: (cursor) => parseTranscriptCursor(cursor) !== null,
    },
    cwd,
    pastSessionId,
    before,
  );
