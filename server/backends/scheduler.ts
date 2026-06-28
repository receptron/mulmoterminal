// User-task scheduler, shared with MulmoClaude via @mulmoclaude/core/scheduler. Users
// (or the agent) persist cron-style tasks in <ws>/config/scheduler/tasks.json; each
// enabled task fires on its schedule and SPAWNS A NEW CHAT seeded with the task's
// prompt. That is how the workout-log "週3回リマインダー" works — a daily task whose
// prompt tells the agent to read data/workout-log/items/ and nudge. The collection
// schema is uninvolved; the only link is the prompt text.
//
// The tick/scheduling ENGINE is the shared package; the run-binding is
// MulmoTerminal-specific: spawnChat = spawnClaudePty (a visible background session).
// Tasks are registered directly on the task-manager (matching MulmoClaude's user
// tasks) — they fire forward on schedule, with no system-task persistence/catch-up.
//
// System tasks may be passed in via `systemTasks` and are registered alongside the
// user tasks on the same task-manager (one tick loop). feed-refresh now IS wired this
// way — its def comes from the shared @mulmoclaude/core/feeds (`feedRefreshTaskDef`),
// supplied by server/index.ts. journal / chat-index stay MulmoClaude-only (their run
// logic isn't in the shared package).
import path from "node:path";
import { readFileSync } from "node:fs";
import type { Express, Request, Response } from "express";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";
import { createTaskManager } from "@mulmoclaude/core/scheduler";
import type { TaskDefinition, TaskSchedule } from "@mulmoclaude/core/scheduler";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

/** Read the user tasks file. Returns [] for a missing file or malformed JSON (a bad
 *  file must not abort scheduling — it just means no user tasks). */
export function loadUserTasks(workspace: string): PersistedUserTask[] {
  let raw: string;
  try {
    raw = readFileSync(tasksFilePath(workspace), "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersistedUserTask[]) : [];
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
export function buildUserTaskDefinitions(tasks: readonly unknown[], spawnChat: (message: string) => void): TaskDefinition[] {
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
    definitions.push({
      id: `user.${id}`,
      description: `User task: ${name}`,
      schedule: entry.schedule,
      run: async () => {
        log.info("running user task", { id, name });
        spawnChat(prompt);
      },
    });
  }
  return definitions;
}

/** Wire the scheduler: load user tasks, register the enabled+valid ones plus any
 *  host `systemTasks` (e.g. feed-refresh) on one task-manager, and start the tick loop.
 *  `spawnChat` is the user-task run-binding (spawns a visible chat seeded with the
 *  prompt). The tick loop starts whenever ANY task is registered — so a system task
 *  alone (no user tasks) still drives its schedule. Returns the user-task count. */
export function initUserTaskScheduler(deps: { workspace: string; spawnChat: (message: string) => void; systemTasks?: TaskDefinition[] }): number {
  const userDefs = buildUserTaskDefinitions(loadUserTasks(deps.workspace), deps.spawnChat);
  const systemTasks = deps.systemTasks ?? [];
  const taskManager = createTaskManager({ log });
  for (const definition of [...systemTasks, ...userDefs]) taskManager.registerTask(definition);
  if (systemTasks.length + userDefs.length > 0) taskManager.start();
  log.info("scheduler started", { userTasks: userDefs.length, systemTasks: systemTasks.length });
  return userDefs.length;
}

/** Read-only REST surface: list the user tasks (backs a future tasks UI). CRUD is a
 *  later PR; existing tasks run without it. */
export function mountSchedulerRoutes(app: Express, deps: { workspace: string }): void {
  app.get("/api/scheduler/tasks", (_req: Request, res: Response) => {
    res.json({ tasks: loadUserTasks(deps.workspace) });
  });
}
