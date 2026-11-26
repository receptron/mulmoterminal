import { ref, shallowRef } from "vue";
import { isAccountId } from "../../common/agentAccounts";
import type { PartialWorkerStatus } from "../../common/workerStatus";
import type { PartialSessionOccupancy, SessionOccupancy } from "../../common/sessionOccupancy";
import type { PartialSessionRunning } from "../../common/sessionRunning";
import { isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent";
import { agentSessionListUrl } from "../../common/agentSessionList";
import { isRecord, optionalBoolean } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { dirAddressOf, dirApiUrl } from "./dirAddress";

// What the launch form can offer for the directory currently in its field: the sessions that can
// be resumed there, the script.json entries that can be run there, and the worktrees the
// repository already has. All three are re-read on every change to that field, which is what
// makes their two hazards one shared shape rather than three similar ones:
//
// - an answer for a directory the user has since typed their way off must not land under the new
//   directory's name, so each list carries a request token and drops a superseded response;
// - a read that fails clears the list, instead of leaving the previous directory's rows standing
//   under a name they don't belong to;
// - and the rows go the moment the directory changes rather than when the replacement lands
//   (`forget`), because until then they are the previous directory's — offered under the new
//   directory's name, and a click resumes exactly the session it says it will (#1372).

/** A row the launcher can resume into a cell. `hidden` / `failed` / `attached` come from shared
 *  wire types the server fills — see common/workerStatus.ts and common/sessionOccupancy.ts for
 *  why they are OPTIONAL on this side. */
export interface ResumableSession extends PartialWorkerStatus, PartialSessionOccupancy, PartialSessionRunning {
  id: string;
  title: string;
  mtime: number;
  /** The account the row was found under (#2215); absent for the default login. */
  account?: string;
}

export interface RunnableScript {
  index: number;
  label: string;
  command: string;
}

/** A skill the Skill menu offers: user + project `.claude/skills`. */
export interface DiscoveredSkill {
  slug: string;
  description: string;
}

export interface Worktree {
  path: string;
  branch: string | null;
  task: string;
  dirty: boolean;
  /** The one session this worktree has, and whether anything is holding it — a worktree is one
   *  branch, so the row starts / resumes / refuses on the strength of this (#1207). Absent when
   *  there is none, and `undefined` from a server that predates the field, which reads the same
   *  way: start a fresh one. */
  session?: (SessionOccupancy & { id: string; agent: TerminalAgent }) | null;
}

export interface ResumableList {
  sessions: ResumableSession[];
  // The resolved cwd the listed sessions belong to (the server may resolve/fallback the requested
  // dir). Resuming uses THIS — not the live input — so the session id and cwd always match the
  // row that was clicked.
  cwd: string | null;
}

export interface ScriptList {
  scripts: RunnableScript[];
  // The resolved cwd the listed scripts belong to, so the command runs in the dir the list was
  // fetched for.
  cwd: string | null;
}

export interface SkillList {
  skills: DiscoveredSkill[];
}

export interface WorktreeList {
  isGit: boolean;
  worktrees: Worktree[];
}

type ListBody = Record<string, unknown>;

// The server answers 200 with an empty list for a directory that simply has none, so a refused
// read parses as an empty body: the two show the same thing, and the fallbacks below then fill in
// per field exactly as each list's own error path used to.
// Takes the row guard rather than a type argument. It used to be `rowsOf<T>(value)`, which named
// a shape the server had not been asked about — the same thing #1231 removed from the assertions.
const rowsOf = <T>(value: unknown, isRow: (row: unknown) => row is T): T[] => (isUnknownArray(value) ? value.filter(isRow) : []);

// Each list's rows are checked on the fields it cannot render or act without.
const isResumableSession = (row: unknown): row is ResumableSession =>
  isRecord(row) &&
  typeof row.id === "string" &&
  typeof row.title === "string" &&
  typeof row.mtime === "number" &&
  // PartialWorkerStatus / PartialSessionOccupancy: absent is meaningful (an older server never
  // said), but a PRESENT one of the wrong type would be asserted as a boolean and read as truthy.
  optionalBoolean(row.hidden) &&
  optionalBoolean(row.failed) &&
  optionalBoolean(row.attached) &&
  // The key the stop button POSTs to. Checked as strictly as the booleans and for a sharper reason:
  // a number or an object asserted as a string here would be sent to `/api/session/:id/terminate`
  // as whatever it stringifies to.
  (row.runningKey === undefined || row.runningKey === null || typeof row.runningKey === "string") &&
  // Rendered as the row's account label, so a present one must be a real id.
  (row.account === undefined || isAccountId(row.account));

const isRunnableScript = (row: unknown): row is RunnableScript =>
  isRecord(row) && typeof row.index === "number" && typeof row.label === "string" && typeof row.command === "string";

// A skill with no slug cannot be launched, and one with no description renders a blank row.
export const isDiscoveredSkill = (row: unknown): row is DiscoveredSkill => isRecord(row) && typeof row.slug === "string" && typeof row.description === "string";

// The nested `session` too, when present: the row's resume decision reads `id` / `agent` /
// `attached` off it (worktreeAction in CellLaunchForm), so a half-formed one would be asserted
// into the Worktree type and then produce an invalid resume request.
const isWorktreeSession = (value: unknown): value is SessionOccupancy & { id: string; agent: TerminalAgent } =>
  isRecord(value) && typeof value.id === "string" && typeof value.agent === "string" && isTerminalAgent(value.agent) && typeof value.attached === "boolean";

const isWorktree = (row: unknown): row is Worktree =>
  isRecord(row) &&
  typeof row.path === "string" &&
  (row.branch === null || typeof row.branch === "string") &&
  typeof row.task === "string" &&
  typeof row.dirty === "boolean" &&
  (row.session === undefined || row.session === null || isWorktreeSession(row.session));
const dirOf = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

function useDirList<T>(url: (dir: string) => string, parse: (body: ListBody, dir: string) => T, empty: () => T) {
  // shallowRef, not ref: the list is always replaced wholesale, and a generic `ref<T>` would need
  // a cast back out of UnwrapRef.
  const value = shallowRef<T>(empty());
  // True from the moment the directory changes until that directory's list has landed — the
  // debounce the form waits out included, since that is most of the wait. Without it an empty
  // section and a section nobody has answered for yet look the same, and the form spends the
  // fetch saying "this directory has none".
  const loading = ref(false);
  let req = 0;

  // The field just moved off this directory: drop its rows now, and say a replacement is coming.
  function forget(): void {
    req++; // an answer already in flight is the leaving directory's — it must not land
    value.value = empty();
    loading.value = true;
  }

  async function load(dir: string | null): Promise<void> {
    const reqId = ++req;
    // Emptied here as well as in `forget`, so the guarantee doesn't depend on the caller having
    // gone through it: a preset chip loads immediately without the watch (fillDir), and the
    // worktree list is re-read after a removal.
    value.value = empty();
    loading.value = dir !== null;
    if (!dir) return;
    try {
      const res = await fetchWithTimeout(url(dir));
      if (reqId !== req) return; // a newer request superseded this one
      const body: ListBody = res.ok ? await jsonBody(res) : {};
      if (reqId !== req) return; // re-check after awaiting the body
      value.value = parse(body, dir);
    } catch {
      if (reqId === req) value.value = empty();
    } finally {
      // Only the newest request owns the flag: a superseded one leaves it set for the request
      // that replaced it, which is still in flight.
      if (reqId === req) loading.value = false;
    }
  }

  return { value, loading, forget, load };
}

/**
 * Existing sessions for a directory, so an empty cell can resume one instead of starting fresh.
 *
 * Per AGENT as well as per directory (#1417): every agent keeps its history in its own store, so
 * the picked agent decides which route answers (common/agentSessionList.ts). Before this it was
 * always Claude's, whatever the Agent Picker said — so picking Codex offered Claude conversations,
 * and clicking one connected the codex endpoint to a key that only ever named a Claude transcript.
 *
 * The agent is read when the URL is built, which happens synchronously inside `load` before its
 * first await — so a switch mid-flight cannot make one request fetch under another's agent, and
 * the superseded response is dropped by the request token the same way a stale directory's is.
 */
export const useResumableSessions = () => {
  let agent: TerminalAgent = "claude";
  const list = useDirList<ResumableList>(
    (dir) => agentSessionListUrl(agent, dir),
    (body, dir) => ({ sessions: rowsOf(body.sessions, isResumableSession), cwd: dirOf(body.cwd, dir) }),
    () => ({ sessions: [], cwd: null }),
  );
  return {
    ...list,
    load: (dir: string | null, forAgent: TerminalAgent): Promise<void> => {
      agent = forAgent;
      return list.load(dir);
    },
  };
};

// The runnable scripts (script.json) for a directory — the launch form's chips and the running
// terminal's Run menu offer the same list.
export const useDirScripts = () =>
  useDirList<ScriptList>(
    (dir) => dirApiUrl(dir, "/api/scripts"),
    // The plain path even for a remote directory's key: it is what a script runs in, on its host.
    (body, dir) => ({ scripts: rowsOf(body.scripts, isRunnableScript), cwd: dirOf(body.cwd, dirAddressOf(dir).cwd) }),
    () => ({ scripts: [], cwd: null }),
  );

// The skills a directory's session can run — the Skill menu's list, read for the command palette.
export const useDirSkills = () =>
  useDirList<SkillList>(
    (dir) => dirApiUrl(dir, "/api/skills"),
    (body) => ({ skills: rowsOf(body.skills, isDiscoveredSkill) }),
    () => ({ skills: [] }),
  );

// Per-agent isolation: when the dir is a git repo, the launcher can start an agent in its own
// throwaway worktree (separate working tree, shared .git) so several agents work the repo without
// clobbering each other. Managed by the server (/api/worktrees).
export const useDirWorktrees = () =>
  useDirList<WorktreeList>(
    (dir) => `/api/worktrees?cwd=${encodeURIComponent(dir)}`,
    (body) => ({ isGit: !!body.isGit, worktrees: rowsOf(body.worktrees, isWorktree) }),
    () => ({ isGit: false, worktrees: [] }),
  );

/** One directory's resumable list read once, or null when it could not be read — which the reactive
 *  lists above fold into "no sessions". A caller deciding whether a session is FREE needs the
 *  difference: an unread list proves nothing about who holds a session. */
export async function readResumableList(dir: string, agent: TerminalAgent): Promise<ResumableList | null> {
  try {
    const res = await fetchWithTimeout(agentSessionListUrl(agent, dir));
    if (!res.ok) return null;
    const body = await jsonBody(res);
    return isUnknownArray(body.sessions) ? { sessions: rowsOf(body.sessions, isResumableSession), cwd: dirOf(body.cwd, dir) } : null;
  } catch {
    return null;
  }
}
