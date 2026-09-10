import path from "node:path";
import { feedRefreshTaskDef } from "@mulmoclaude/core/feeds/server";
import { googleCalendarSyncTaskDef } from "@mulmoclaude/core/google";
import type { SystemTaskDef } from "@mulmoclaude/core/scheduler";
import { worklogSystemTask } from "./worklog.js";
import type { ScheduledChatSpawn } from "./scheduled-run.js";

export interface SystemTaskDeps {
  workspaceRoot: string;
  /** Every root whose feeds should refresh on a schedule — the workspace plus each saved project
   *  directory. Omitted, only the workspace refreshes, which is what a single-root host wants and
   *  what this did before projects existed.
   *
   *  A root NOT in this list is never refreshed on a schedule; its feeds update only when someone
   *  asks. That is why the list is passed in rather than inferred here — core says so explicitly,
   *  and it is the host's decision. */
  feedRoots?: string[];
  worklog: { enabled: boolean; intervalHours: number };
  /** Which of the two always-on system tasks the user still wants. Both default ON — they are
   *  existing behaviour, and a default that silently stopped refreshing someone's feeds would
   *  be a worse bug than the one the switch exists for (#2015).
   *
   *  This mirrors what a USER task already gets: `buildUserTaskDefinitions` honours
   *  `enabled: false` on every entry in `tasks.json`, and the asymmetry — a task the user wrote
   *  can be switched off, one the app registered cannot — is the whole of that issue. */
  enabled: SystemTaskSwitches;
  spawnChat: ScheduledChatSpawn;
}

/** The per-task switches, as the config serves them. */
export interface SystemTaskSwitches {
  feedRefresh: boolean;
  calendarSync: boolean;
}

// The system tasks a standalone MulmoTerminal registers — the ones that must keep running with no
// MulmoClaude on the machine. Both shared ones come from a core factory so the id, schedule and run
// can't drift between the two hosts.
//
// Feed refresh and calendar sync are safe to run alongside MulmoClaude on the same workspace
// because each engine soft-dedups on a marker IN that workspace: feeds on `lastFetchedAt`, calendar
// on `lastSyncedAt` (core >= 1.12.0, receptron/mulmoclaude#2678). Whoever gets there first claims
// it and the other skips. That only holds while both hosts point at the SAME workspace root — the
// marker is workspace state, so two roots means no dedup.
//
// Calendar claims at START rather than on success: since `autoPush` the run writes to Google, and
// a first full walk takes minutes, which would otherwise sit open for the other host to enter.
//
// Extracted from index.ts so the list is a value a spec can read. It went months missing the
// calendar task with nothing to notice (#1191).
//
// `SystemTaskDef`, not `TaskDefinition`: the extra `name` + `missedRunPolicy` are what the
// persistence adapter needs to catch a task up after the server was off. Both core factories
// already returned them — this host used to throw them away, so nothing was ever caught up
// and a missed window was skipped forever (#1581).
export function buildSystemTasks(deps: SystemTaskDeps): SystemTaskDef[] {
  return [
    // ONE PER ROOT. A task id is the scheduler's primary key and `feedRefreshTaskDef` builds it
    // from the root, so N roots register N tasks instead of overwriting each other down to the
    // last one. Deduped by RESOLVED path: core canonicalises the root into the id, so two
    // spellings of one directory would collapse to a single id and silently drop a registration.
    ...(deps.enabled.feedRefresh ? feedRootsOf(deps).map((root) => feedRefreshTaskDef({ workspaceRoot: root })) : []),
    // The calendar stays WORKSPACE-ONLY, deliberately. A Google grant is user-scope and its sync
    // state (`lastSyncedAt`) is workspace state, so a per-project sync would need a per-project
    // answer to "which account" that nothing in this app has. A project's calendar collections
    // still sync on demand.
    deps.enabled.calendarSync ? googleCalendarSyncTaskDef({ workspaceRoot: deps.workspaceRoot }) : null,
    worklogSystemTask({ ...deps.worklog, spawnChat: deps.spawnChat }),
  ].filter((task): task is SystemTaskDef => task !== null);
}

/** The roots to register a feed refresh for, workspace first and each one once.
 *
 *  Resolved before deduping because the workspace and a saved directory can spell the same folder
 *  differently (a trailing slash, a `.` segment) — and `feedRefreshTaskDef` canonicalises the root
 *  into the id, so two spellings would produce ONE id and silently drop a registration rather than
 *  two tasks. */
function feedRootsOf(deps: SystemTaskDeps): string[] {
  return [...new Set([deps.workspaceRoot, ...(deps.feedRoots ?? [])].map((root) => path.resolve(root)))];
}
