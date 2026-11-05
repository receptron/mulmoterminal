// Finding the rollout a reattached codex is writing when the cell's mapping is gone (#3283): the
// session's tmux panes, every process under them, and the one rollout those processes hold open for
// writing — a reader such as `tail` is not the conversation's writer.
// The listings are injected so the walk is tested without tmux or lsof; the rule is pickOpenRollout.
import { canonicalPath } from "../../../infra/fs/canonical-path.js";
import { tmuxPanePidsBySessionAsync } from "../../../infra/process/tmux.js";
import { listProcessRows, type ProcessRow } from "../../../infra/process/process-list.js";
import { writableFilesOf } from "../../../infra/process/open-files.js";
import { childrenByParent, processTree } from "../../list/session-cpu.js";
import { pickOpenRollout } from "../../../agents/codex/codex-open-rollout.js";

export interface OpenRolloutProbe {
  listPanePids: () => Promise<Map<string, number[]> | null>;
  listProcesses: () => Promise<ProcessRow[] | null>;
  openFiles: (pids: readonly number[]) => Promise<string[] | null>;
  canonical: (dir: string) => string;
}

const LIVE_PROBE: OpenRolloutProbe = {
  listPanePids: tmuxPanePidsBySessionAsync,
  listProcesses: listProcessRows,
  openFiles: writableFilesOf,
  canonical: canonicalPath,
};

async function sessionProcessTree(sessionId: string, probe: OpenRolloutProbe): Promise<number[]> {
  const panes = (await probe.listPanePids())?.get(sessionId) ?? [];
  if (panes.length === 0) return [];
  const rows = await probe.listProcesses();
  if (rows === null) return [];
  const children = childrenByParent(rows);
  return [...new Set(panes.flatMap((pane) => processTree(pane, children)))];
}

/** The rollout file this session's processes hold open, spelled under `root`, or null when there
 *  is none, more than one, it is claimed, or a listing could not be taken. */
export async function findOpenCodexRollout(
  sessionId: string,
  root: string,
  claimed: ReadonlySet<string>,
  probe: OpenRolloutProbe = LIVE_PROBE,
): Promise<string | null> {
  const pids = await sessionProcessTree(sessionId, probe);
  if (pids.length === 0) return null;
  const open = await probe.openFiles(pids);
  return open === null ? null : pickOpenRollout(open, { listed: root, canonical: probe.canonical(root) }, claimed);
}
