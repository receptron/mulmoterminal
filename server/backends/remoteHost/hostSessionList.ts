// The phone's list of terminal sessions (#435). Reads the same tables /api/sessions answers from,
// so the two clients never disagree about what exists or what it is called.
import { buildSessionList, listableSessionIds, type ListableInput, type SessionWorkSummary } from "./terminalScreen.js";
import { withDirIcons, readIconFile, type DirIconSources } from "./dirIcons.js";
import { workByCwd } from "./workByCwd.js";
import { diskTitle } from "./phoneRowText.js";
import { dirIconFor } from "../../config/dir/dir-config.js";
import { agentOfSession, cwdOfSession } from "../../session/list/session-lookup.js";
import { resumableSessionPredicate } from "../../session/list/resumable-sessions.js";
import { claudeTitleFields, type TitleFields } from "../../session/session-reads.js";
import { transcriptIdOf } from "../../session/transcript/cleared-transcripts.js";
import { agentSessionTitle } from "../../agents/agent-session-title.js";
import {
  aiTitles,
  isPhoneListableSession,
  knownSessions,
  lastPrompts,
  placedSessionsHydrated,
  ptys,
  sessionMemos,
  sessionMemosHydrated,
  unplacedSessionsHydrated,
} from "../../session/registry.js";
import { tmuxListSessionIds } from "../../infra/process/tmux.js";
import { sessionDisplayName } from "../../../common/sessionMemo.js";
import type { SessionAgent } from "../../../common/sessionAgent.js";

// Where the phone's copy of a directory's picture comes from (#1556). `dirIconFor` is the same
// resolution the browser's cells use — the configured `icon` and, failing that, the detected
// favicon — so the two clients never disagree about which image a project has.
const dirIconSources: DirIconSources = { iconOf: dirIconFor, readIcon: readIconFile };

// The in-memory name: the same precedence as the cell header and the sidebar, through the same
// helper. Empty rather than the id, so buildSessionList can drop the long tail of finished sessions.
const memoryTitle = (id: string): string => sessionDisplayName(sessionMemos.get(id), aiTitles.get(id), knownSessions.get(id)?.title);

// What the disk says about one row, read before the list is built because buildSessionList is
// synchronous. `untitledName` is only filled for a live row memory could not name.
interface RowReads {
  prompt: string;
  untitledName: string;
}

// A tmux-only session has no recorded agent, and on this host that is claude far more often than
// not — its transcript is simply absent otherwise, which reads as "nothing on disk".
// Read from the transcript the session is in now (transcriptIdOf); nothing when it moved with
// nowhere recorded.
function claudeFieldsOf(id: string, cwd: string, agent: SessionAgent | null): Promise<TitleFields | null> {
  const transcriptId = transcriptIdOf(id);
  return !cwd || transcriptId === null || (agent !== null && agent !== "claude") ? Promise.resolve(null) : claudeTitleFields(cwd, transcriptId);
}

const agentTitleOf = async (id: string, cwd: string, agent: SessionAgent | null): Promise<string | null> =>
  !cwd || agent === null || agent === "claude" || agent === "shell" ? null : ((await agentSessionTitle(cwd, id, agent)) ?? null);

// `lastPrompts` holds "" after a /clear, which must win over the transcript — hence `has`, not `??`.
const promptOf = (id: string, fields: TitleFields | null): string => (lastPrompts.has(id) ? (lastPrompts.get(id) ?? "") : (fields?.lastPrompt ?? ""));

async function readRow(id: string, untitledLive: boolean): Promise<RowReads> {
  const cwd = cwdOfSession(id);
  const agent = agentOfSession(id);
  const fields = await claudeFieldsOf(id, cwd, agent);
  const prompt = promptOf(id, fields);
  if (!untitledLive) return { prompt, untitledName: "" };
  const untitledName = diskTitle({
    cleared: transcriptIdOf(id) === null,
    livePrompt: lastPrompts.get(id),
    diskCustomTitle: fields?.customTitle ?? null,
    diskAiTitle: fields?.aiTitle ?? null,
    agentTitle: await agentTitleOf(id, cwd, agent),
    diskLastPrompt: fields?.lastPrompt ?? null,
    firstUserMsg: fields?.firstUserMsg ?? null,
  });
  return { prompt, untitledName };
}

async function readRows(input: ListableInput): Promise<Map<string, RowReads>> {
  const live = new Set(input.liveIds);
  const ids = listableSessionIds(input);
  const reads = await Promise.all(ids.map(async (id): Promise<[string, RowReads]> => [id, await readRow(id, live.has(id) && memoryTitle(id) === "")]));
  return new Map(reads);
}

// Spread the work item and the prompt in only when there IS one. `work: map.get(...)` leaves the key
// behind holding undefined, and Firestore then refuses the entire reply rather than that one field.
const detailOf = (id: string, work: ReadonlyMap<string, SessionWorkSummary>, rows: ReadonlyMap<string, RowReads>) => {
  const summary = work.get(cwdOfSession(id));
  const prompt = rows.get(id)?.prompt;
  return {
    // Riding in `title` is what puts a memo on a phone with no core release and no schema change.
    title: memoryTitle(id),
    cwd: cwdOfSession(id),
    agent: agentOfSession(id),
    ...(summary ? { work: summary } : {}),
    ...(prompt ? { prompt } : {}),
  };
};

export async function listTerminalSessions() {
  const work = await workByCwd([...new Set([...ptys.keys(), ...tmuxListSessionIds()])].map(cwdOfSession));
  await sessionMemosHydrated; // the memo IS the phone's row title when there is one
  // Both unplaced logs, because a session waiting for a cell is one the phone may list — and the
  // case that mark exists for is a server that restarted before any tab opened, where the answer
  // lives only on disk.
  await Promise.all([unplacedSessionsHydrated, placedSessionsHydrated]);
  const listable: ListableInput = {
    liveIds: [...ptys.keys()],
    tmuxIds: tmuxListSessionIds(),
    isResumable: await resumableSessionPredicate(),
    // The phone lists the multi-terminal grid's cells, and the sessions on their way to being one —
    // never a tmux shell that was never a cell. resumableSessionPredicate() already awaited
    // devTerminalSessionsHydrated, and the unplaced logs are awaited just above; a session that has
    // only just been spawned passes `isResumable` on its live pty.
    isGridSession: isPhoneListableSession,
  };
  const rows = await readRows(listable);
  const sessions = buildSessionList({
    ...listable,
    detailOf: (id) => detailOf(id, work, rows),
    untitledNameOf: (id) => rows.get(id)?.untitledName ?? "",
  });
  // After the sort, so the budget is spent on the rows the phone shows first.
  return withDirIcons(sessions, dirIconSources);
}
