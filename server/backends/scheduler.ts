// User-task scheduler, shared with MulmoClaude via @mulmoclaude/core/scheduler. Users
// (or the agent) persist cron-style tasks in <ws>/config/scheduler/tasks.json; each
// enabled task fires on its schedule and SPAWNS A NEW CHAT seeded with the task's
// prompt. That is how the workout-log "週3回リマインダー" works — a daily task whose
// prompt tells the agent to read data/workout-log/items/ and nudge. The collection
// schema is uninvolved; the only link is the prompt text.
//
// The tick/scheduling ENGINE is the shared package; the run-binding is
// MulmoTerminal-specific: spawnChat = spawnClaudePty (a background worker session).
//
// The two kinds of task are registered differently, exactly as in MulmoClaude:
//   - SYSTEM tasks (`systemTasks`, from system-tasks.ts) go through the persistence
//     adapter — state file, startup catch-up for windows missed while the server was
//     off, execution log. See scheduler-adapter.ts.
//   - USER tasks register straight on the task-manager and fire forward only, but every
//     run is recorded (scheduled-run.ts) so history and last/next-run exist for them too.
// Both share one task-manager, so one tick loop drives everything.
import path from "node:path";
import type { Express, Request, Response } from "express";
import { SCHEDULE_TYPES, TASK_ORIGINS, TASK_TRIGGERS, type TaskLogEntry } from "@receptron/task-scheduler";
import { createTaskManager, getSchedulerLogs, getSchedulerTasks, getSchedulerTaskState } from "@mulmoclaude/core/scheduler";
import type { ITaskManager, SystemTaskDef, TaskDefinition, TaskSchedule } from "@mulmoclaude/core/scheduler";
import { readTextFile } from "../infra/read-text-file.js";
import { isRecord } from "../../common/isRecord.js";
import { configureSchedulerAdapter, startSystemTaskScheduler } from "./scheduler-adapter.js";
import { hostStateRoot } from "../infra/host-state-root.js";
import { fireScheduledChat, type ScheduledChatSpawn } from "./scheduled-run.js";

const log = {
  info: (message: string, data?: Record<string, unknown>) => console.log(`[scheduler] ${message}`, data ?? ""),
  warn: (message: string, data?: Record<string, unknown>) => console.warn(`[scheduler] ${message}`, data ?? ""),
  error: (message: string, data?: Record<string, unknown>) => console.error(`[scheduler] ${message}`, data ?? ""),
};

/** On-disk shape of a user scheduled task (mirror of MulmoClaude's PersistedUserTask;
 *  only the fields this host reads). */
export interface PersistedUserTask {
  id: string;
  name?: string;
  description?: string;
  schedule: TaskSchedule;
  enabled?: boolean;
  roleId?: string;
  prompt: string;
}

function allDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const char of value) {
    if (char < "0" || char > "9") return false;
  }
  return true;
}

// Validate "HH:MM" with string ops (no regex — lint bans backtracking-prone patterns).
function isValidDailyTime(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 2) return false;
  const [hourStr, minStr] = parts;
  if (hourStr === undefined || minStr === undefined) return false; // unreachable: length checked above
  if (hourStr.length !== 2 || minStr.length !== 2 || !allDigits(hourStr) || !allDigits(minStr)) return false;
  return Number(hourStr) <= 23 && Number(minStr) <= 59;
}

function isValidSchedule(value: unknown): value is TaskSchedule {
  if (!isRecord(value)) return false;
  if (value.type === SCHEDULE_TYPES.interval) return typeof value.intervalMs === "number" && value.intervalMs > 0;
  if (value.type === SCHEDULE_TYPES.daily) return typeof value.time === "string" && isValidDailyTime(value.time);
  return false;
}

function tasksFilePath(workspace: string): string {
  return path.join(workspace, "config", "scheduler", "tasks.json");
}

/** The task-manager id a user task registers under — the key its state and log entries
 *  are filed under, so the API has to ask for it by the same name. */
export function userTaskManagerId(taskId: string): string {
  return `user.${taskId}`;
}

/** Read the user tasks file. Returns [] for a missing file or malformed JSON (a bad
 *  file must not abort scheduling — it just means no user tasks). */
export function loadUserTasks(workspace: string): unknown[] {
  let raw: string;
  try {
    raw = readTextFile(tasksFilePath(workspace));
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    // `unknown[]`, not `PersistedUserTask[]`: this only knows the file parsed to an ARRAY. Its one
    // consumer, buildUserTaskDefinitions, already takes `readonly unknown[]` and validates every
    // entry — the assertion this replaces claimed a shape nothing here had checked.
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    log.warn("tasks.json is malformed — ignoring", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** Map persisted user tasks to task-manager definitions. Pure + exported for tests:
 *  drops non-object / disabled entries and ones missing a valid id / prompt /
 *  schedule, and binds each surviving task's run to a fresh chat seeded with its
 *  prompt. Takes `unknown[]` because the array comes straight from JSON.parse — a
 *  bad element (`null`, a primitive) must be skipped, not throw (non-fatal). */
export function buildUserTaskDefinitions(tasks: readonly unknown[], spawnChat: ScheduledChatSpawn): TaskDefinition[] {
  const definitions: TaskDefinition[] = [];
  for (const entry of tasks) {
    if (!isRecord(entry)) {
      log.warn("skipping task: not an object");
      continue;
    }
    // `enabled` is optional — only an explicit `false` disables a task; an omitted
    // field means enabled (so a hand-authored task without the flag still runs).
    if (entry.enabled === false) continue;
    const id = entry.id;
    if (typeof id !== "string" || id.length === 0) {
      log.warn("skipping task: missing id");
      continue;
    }
    const rawPrompt = entry.prompt;
    if (typeof rawPrompt !== "string" || rawPrompt.trim().length === 0) {
      log.warn("skipping task: empty prompt", { id });
      continue;
    }
    if (!isValidSchedule(entry.schedule)) {
      log.warn("skipping task: invalid schedule", { id });
      continue;
    }
    const prompt = rawPrompt.trim();
    const name = typeof entry.name === "string" ? entry.name : id;
    const schedule = entry.schedule;
    definitions.push({
      id: userTaskManagerId(id),
      description: `User task: ${name}`,
      schedule,
      run: async () => {
        log.info("running user task", { id, name });
        await fireScheduledChat({ id: userTaskManagerId(id), name, schedule, message: prompt, trigger: TASK_TRIGGERS.scheduled, spawnChat });
      },
    });
  }
  return definitions;
}

/** Wire the scheduler: load user tasks, register the enabled+valid ones on the task-manager,
 *  hand any host `systemTasks` (e.g. feed-refresh) to the persistence adapter, and start the
 *  tick loop. `spawnChat` is the run-binding (spawns a background chat seeded with the prompt).
 *  The tick loop starts whenever ANY task exists — so a system task alone (no user tasks) still
 *  drives its schedule. Returns the user-task count.
 *
 *  Nothing waits on the adapter: its catch-up runs every window missed while the server was off,
 *  which for a caught-up feed refresh is real work — see startTicking for what that costs. */
export function initUserTaskScheduler(deps: {
  workspace: string;
  spawnChat: ScheduledChatSpawn;
  systemTasks?: SystemTaskDef[];
  /** MulmoTerminal's home (`~/.mulmoterminal`). Injectable so a test can file its state
   *  somewhere disposable instead of in the home of whoever runs the suite. */
  home?: string;
}): number {
  // Two different roots, deliberately. `tasks.json` is a file the user (or the agent) WRITES,
  // so it is workspace content and is read from the workspace. State and logs are ours, and on
  // a launch directory that is someone's project they do not belong there — host-state-root.ts.
  const stateRoot = hostStateRoot(deps.workspace, deps.home);
  const userDefs = buildUserTaskDefinitions(loadUserTasks(deps.workspace), deps.spawnChat);
  const systemTasks = deps.systemTasks ?? [];
  const taskManager = createTaskManager({ log });
  // Before anything can record a run — including a user task, which reaches the same state file.
  configureSchedulerAdapter(stateRoot, log);
  for (const definition of userDefs) taskManager.registerTask(definition);
  startTicking(taskManager, { stateRoot, systemTasks, userTaskCount: userDefs.length });
  log.info("scheduler started", { userTasks: userDefs.length, systemTasks: systemTasks.length });
  return userDefs.length;
}

/** Start the tick loop as soon as anything is registered, and let the adapter register its own
 *  tasks behind it.
 *
 *  Which window to risk, since both cannot be protected: the adapter registers only after seeding
 *  and running its catch-up plan, so ticking first means those ticks see no system task — while a
 *  loop that waits for it fires no USER task meanwhile. Codex flagged each side in turn, and what
 *  settles it is the asymmetry between the two kinds. A user task is one-shot — "remind me at
 *  09:00", with no catch-up in either host — so a window it misses is never run at all. A system
 *  task's WORK survives either way: the worklog's window is [lastRunAt, now] from its own state
 *  file, and the feed / calendar engines re-derive what is due from their own markers. So the
 *  loop starts now, and a window landing inside a slow catch-up costs a system task one run
 *  rather than costing someone a reminder. */
function startTicking(taskManager: ITaskManager, deps: { stateRoot: string; systemTasks: SystemTaskDef[]; userTaskCount: number }): void {
  if (deps.systemTasks.length + deps.userTaskCount === 0) return;
  taskManager.start();
  if (deps.systemTasks.length === 0) return;
  void startSystemTaskScheduler({ taskManager, stateRoot: deps.stateRoot, tasks: deps.systemTasks, log }).catch((err: unknown) =>
    log.error("system task scheduler failed to start", { error: String(err) }),
  );
}

/** One user task as the API returns it: the persisted entry, tagged with its origin and
 *  carrying the execution state the adapter files under its task-manager id. A malformed
 *  entry is passed through untouched — the list is a mirror of the file, not a validator. */
function userTaskWithState(entry: unknown): unknown {
  if (!isRecord(entry) || typeof entry.id !== "string") return entry;
  return { ...entry, origin: TASK_ORIGINS.user, state: getSchedulerTaskState(userTaskManagerId(entry.id)) };
}

/** Positive integer query param, capped. Anything else reads as "unset". */
function positiveIntQuery(value: unknown, max: number): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const MAX_LOG_LIMIT = 500;

/** Read-only REST surface, shaped like MulmoClaude's `server/api/routes/schedulerTasks.ts`:
 *  every registered task with its execution state, and the execution log. Task CRUD is a
 *  separate parity item; tasks written to `tasks.json` by hand or by the agent run without it. */
export function mountSchedulerRoutes(app: Express, deps: { workspace: string }): void {
  app.get("/api/scheduler/tasks", (_req: Request, res: Response) => {
    const systemTasks = getSchedulerTasks().map((task) => ({ ...task, origin: TASK_ORIGINS.system }));
    res.json({ tasks: [...systemTasks, ...loadUserTasks(deps.workspace).map(userTaskWithState)] });
  });

  app.get("/api/scheduler/logs", async (req: Request, res: Response) => {
    try {
      const logs: TaskLogEntry[] = await getSchedulerLogs({
        since: stringQuery(req.query.since),
        taskId: stringQuery(req.query.taskId),
        limit: positiveIntQuery(req.query.limit, MAX_LOG_LIMIT),
      });
      res.json({ logs });
    } catch (err) {
      log.warn("failed to read scheduler logs", { error: String(err) });
      res.status(500).json({ error: "failed to read scheduler logs" });
    }
  });
}
