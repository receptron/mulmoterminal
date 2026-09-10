// Where MulmoTerminal keeps the RUNTIME STATE it owns — scheduler execution state and logs,
// notifier active/history. Not the same question as "where is the workspace": a workspace
// holds what the user made (collections, feeds, `config/scheduler/tasks.json`), and that stays
// under the workspace wherever the workspace is.
//
// The launcher defaults the workspace to the directory it was run from (`chooseCwd` returns
// "." with no --cwd), so on a normal `npx mulmoterminal` the workspace IS someone's project
// folder — and app state written there is state they never asked for and cannot delete, since
// the next hourly run recreates it (#2024). `workspaceSetup.ts` already refuses to seed into
// such a directory for the same reason; this is the same gate for the same reason.
//
// The MANAGED workspace is the exception, and it is not a preference: MulmoClaude's own
// `workspacePath` is the same expression as `managedWorkspacePath()`, and both hosts read each
// other's files there — the scheduler state so a missed window is caught up once rather than
// twice (`scheduler-state-seed.ts`), the notifier files so one bell shows both apps' notices
// (`notifier.ts`). Moving state out of the managed workspace would split those pairs. Outside
// it there is no MulmoClaude to share with, so nothing is split by moving.
//
// The layout under the redirected root MIRRORS the workspace's, so every caller keeps joining
// the same relative path and neither `@mulmoclaude/core` nor the notifier engine changes.
import os from "node:os";
import path from "node:path";
import { isManagedWorkspace } from "../backends/workspaceSetup.js";
import { canonicalPath } from "./canonical-path.js";
import { workspaceKey } from "./workspace-key.js";

/** The root MulmoTerminal's own runtime state hangs off for this workspace: the workspace
 *  itself when it is the managed one, else this workspace's directory under the home.
 *
 *  Keyed on the CANONICAL path, not merely the resolved one, so a workspace reached through a
 *  symlink answers the same directory as the workspace reached directly. Two keys for one
 *  directory would give it two scheduler histories, and a task whose last-run marker sits in
 *  the half the server did not read runs again — the same aliasing `isManagedWorkspace` resolves
 *  one line above, which is why they must agree. `canonicalPath` resolves the deepest existing
 *  ancestor, so a workspace that does not exist yet still answers a stable key. */
export function hostStateRoot(workspace: string, home: string = path.join(os.homedir(), ".mulmoterminal")): string {
  if (isManagedWorkspace(workspace)) return workspace;
  return path.join(home, "workspaces", workspaceKey(canonicalPath(workspace)));
}
