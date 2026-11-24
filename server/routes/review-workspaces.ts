// The reviewer MulmoTerminal starts for a PR (#3425): a worktree of the repository's clone on the
// PR's head, a session of the declared agent there with the round's request as its first message,
// and — for codex — a sandbox that may reach the network, since the reviewer reads and comments on
// its PR with gh. A cell the user opens by hand keeps the user's own sandbox.
import { messageOf } from "../errors.js";
import { checkoutReviewHead, removeReviewWorktree, reviewWorktreeDir, type ReviewWorktreeDeps } from "../git/review-worktree.js";
import type { SpawnIssueSession } from "../session/spawn/issue-session-spawn.js";
import type { TerminalAgent } from "../../common/sessionAgent.js";
import type { ReviewWorkspaces } from "./review-loop-routes.js";

export interface ReviewWorkspaceDeps {
  cloneOf: (repo: string) => Promise<string | null>;
  /** Where the worktrees go. */
  root: () => string;
  worktree: ReviewWorktreeDeps;
  spawn: SpawnIssueSession;
  recordSpawn: (child: string, parent: string) => void;
  markVisible: (session: string, agent: TerminalAgent) => void;
}

export function reviewWorkspaces(deps: ReviewWorkspaceDeps): ReviewWorkspaces {
  // The clone each worktree was made from: `git worktree` is asked from there, and the repository's
  // default clone may have changed since.
  const cloneOfWorkspace = new Map<string, string>();
  const dropWorkspace = async (workspace: string): Promise<void> => {
    const clone = cloneOfWorkspace.get(workspace);
    if (clone === undefined) return;
    try {
      const failed = await removeReviewWorktree(deps.worktree, clone, workspace);
      if (failed === null) cloneOfWorkspace.delete(workspace);
      else console.error(`[requestReview] ${failed}`);
    } catch (err) {
      console.error(`[requestReview] could not remove ${workspace}: ${messageOf(err)}`);
    }
  };
  return {
    start: async (spec) => {
      const clone = await deps.cloneOf(spec.repo);
      if (clone === null) return `no local clone of ${spec.repo} is known to MulmoTerminal`;
      const workspace = reviewWorktreeDir(deps.root(), spec.repo, spec.pr);
      const placed = await checkoutReviewHead(deps.worktree, clone, workspace, spec.pr, spec.head);
      if (placed !== null) return placed;
      cloneOfWorkspace.set(workspace, clone);
      try {
        const spawned = await deps.spawn(spec.agent, workspace, spec.seed, true, null, { networkAccess: true, neverAsk: true });
        deps.recordSpawn(spawned.sessionId, spec.author);
        deps.markVisible(spawned.sessionId, spec.agent);
        return { session: spawned.sessionId, workspace };
      } catch (err) {
        await dropWorkspace(workspace);
        return `could not start the reviewer: ${messageOf(err)}`;
      }
    },
    move: async (loop, head) => {
      const clone = loop.workspace === null ? undefined : cloneOfWorkspace.get(loop.workspace);
      if (clone === undefined || loop.workspace === null) return "its worktree is not one this server made";
      return checkoutReviewHead(deps.worktree, clone, loop.workspace, loop.pr, head);
    },
    drop: async (loop) => {
      if (loop.workspace !== null) await dropWorkspace(loop.workspace);
    },
  };
}
