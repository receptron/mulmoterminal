import { shallowRef } from "vue";

// What the launch form can offer for the directory currently in its field: the sessions that can
// be resumed there, the script.json entries that can be run there, and the worktrees the
// repository already has. All three are re-read on every change to that field, which is what
// makes their two hazards one shared shape rather than three similar ones:
//
// - an answer for a directory the user has since typed their way off must not land under the new
//   directory's name, so each list carries a request token and drops a superseded response;
// - a read that fails clears the list, instead of leaving the previous directory's rows standing
//   under a name they don't belong to.

export interface ResumableSession {
  id: string;
  title: string;
  mtime: number;
  /** A background worker (spawnBackgroundChat hidden:true, a scheduled refresh) rather than a
   *  chat someone opened. Already carried on every row the server sends; surfaced here because
   *  the grid is where such a session is picked up, and an unlabelled one is indistinguishable
   *  from the user's own work. */
  hidden?: boolean;
  /** That worker ended without ever completing a turn. A worker is quiet by design, so this is
   *  the one outcome the quiet is wrong for. */
  failed?: boolean;
}

export interface RunnableScript {
  index: number;
  label: string;
  command: string;
}

export interface Worktree {
  path: string;
  branch: string | null;
  task: string;
  dirty: boolean;
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

export interface WorktreeList {
  isGit: boolean;
  worktrees: Worktree[];
}

type ListBody = Record<string, unknown>;

// The server answers 200 with an empty list for a directory that simply has none, so a refused
// read parses as an empty body: the two show the same thing, and the fallbacks below then fill in
// per field exactly as each list's own error path used to.
const rowsOf = <T>(value: unknown): T[] => (Array.isArray(value) ? value : []);
const dirOf = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

function useDirList<T>(url: (dir: string) => string, parse: (body: ListBody, dir: string) => T, empty: () => T) {
  // shallowRef, not ref: the list is always replaced wholesale, and a generic `ref<T>` would need
  // a cast back out of UnwrapRef.
  const value = shallowRef<T>(empty());
  let req = 0;

  async function load(dir: string | null): Promise<void> {
    const reqId = ++req;
    if (!dir) {
      value.value = empty();
      return;
    }
    try {
      const res = await fetch(url(dir));
      if (reqId !== req) return; // a newer request superseded this one
      const body: ListBody = res.ok ? await res.json() : {};
      if (reqId !== req) return; // re-check after awaiting the body
      value.value = parse(body, dir);
    } catch {
      if (reqId === req) value.value = empty();
    }
  }

  return { value, load };
}

// Existing sessions for a directory, so an empty cell can resume one instead of starting fresh.
export const useResumableSessions = () =>
  useDirList<ResumableList>(
    (dir) => `/api/sessions?cwd=${encodeURIComponent(dir)}`,
    (body, dir) => ({ sessions: rowsOf<ResumableSession>(body.sessions), cwd: dirOf(body.cwd, dir) }),
    () => ({ sessions: [], cwd: null }),
  );

// The runnable scripts (script.json) for a directory — the launch form's chips and the running
// terminal's Run menu offer the same list.
export const useDirScripts = () =>
  useDirList<ScriptList>(
    (dir) => `/api/scripts?cwd=${encodeURIComponent(dir)}`,
    (body, dir) => ({ scripts: rowsOf<RunnableScript>(body.scripts), cwd: dirOf(body.cwd, dir) }),
    () => ({ scripts: [], cwd: null }),
  );

// Per-agent isolation: when the dir is a git repo, the launcher can start an agent in its own
// throwaway worktree (separate working tree, shared .git) so several agents work the repo without
// clobbering each other. Managed by the server (/api/worktrees).
export const useDirWorktrees = () =>
  useDirList<WorktreeList>(
    (dir) => `/api/worktrees?cwd=${encodeURIComponent(dir)}`,
    (body) => ({ isGit: !!body.isGit, worktrees: rowsOf<Worktree>(body.worktrees) }),
    () => ({ isGit: false, worktrees: [] }),
  );
