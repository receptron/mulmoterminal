// Whether a surviving tmux session can be resumed as a real session.
//
// Shared by the tmux routes (which offer them) and the remote-host bridge (which lists them),
// so it lives here rather than in either. Reads live state — the pty table, the persisted
// dev-terminal set, and both agents' on-disk transcripts — and returns a predicate over ids.

import { claudeOnDiskSessionIds } from "./session-reads.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { codexRolloutExists } from "../agents/codex-sessions.js";
import { devTerminalSessions, devTerminalSessionsHydrated, ptys } from "./registry.js";
import { isResumableTmuxSession } from "../infra/tmux.js";
export const resumableSessionPredicate = async (): Promise<(id: string) => boolean> => {
  await devTerminalSessionsHydrated;
  const live = new Set(ptys.keys());
  const claudeOnDisk = claudeOnDiskSessionIds();
  const codexRoot = codexSessionsRoot();
  return (id) => isResumableTmuxSession(id, live, devTerminalSessions, claudeOnDisk, (i) => codexRolloutExists(codexRoot, i));
};
