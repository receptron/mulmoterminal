// @vitest-environment node
// The wiring, against the REAL @mulmoclaude/core/scheduler and a real workspace on disk —
// no mocks, because the thing #1581 got wrong was precisely the handoff to that package.
// A stub task-manager stands in for the tick loop; catch-up does not go through it.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MISSED_RUN_POLICIES, SCHEDULE_TYPES } from "@receptron/task-scheduler";
import { resetSchedulerForTesting, type ITaskManager, type SystemTaskDef, type TaskDefinition } from "@mulmoclaude/core/scheduler";
import { configureSchedulerAdapter, startSystemTaskScheduler } from "../../../server/backends/scheduler-adapter.js";
import { schedulerStateFilePath, seedSchedulerState } from "../../../server/backends/scheduler-state-seed.js";

const HOUR_MS = 3_600_000;
const silent = { info: () => {}, warn: () => {}, error: () => {} };

const tempDirs: string[] = [];
function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-sched-adapter-"));
  tempDirs.push(dir);
  return dir;
}

/** Records what would have been registered for ongoing ticks. */
function stubTaskManager(): { manager: ITaskManager; registered: string[] } {
  const registered: string[] = [];
  const manager: ITaskManager = {
    registerTask: (def: TaskDefinition) => void registered.push(def.id),
    removeTask: () => {},
    updateSchedule: () => true,
    start: () => {},
    stop: () => {},
    tick: async () => {},
    listTasks: () => [],
  };
  return { manager, registered };
}

function worklogTask(runs: string[]): SystemTaskDef {
  return {
    id: "system.worklog",
    name: "Dev worklog",
    description: "test",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 6 * HOUR_MS },
    missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
    run: async () => void runs.push("ran"),
  };
}

afterEach(() => {
  resetSchedulerForTesting();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("startSystemTaskScheduler", () => {
  it("does not fire a task on the boot that first registers it", async () => {
    const workspace = makeWorkspace();
    const runs: string[] = [];
    const { manager, registered } = stubTaskManager();

    configureSchedulerAdapter(workspace, silent);
    await startSystemTaskScheduler({ taskManager: manager, stateRoot: workspace, tasks: [worklogTask(runs)], log: silent });

    expect(runs).toEqual([]); // enabling a task is not a reason to run it
    expect(registered).toEqual(["system.worklog"]); // but it ticks from here on
  });

  // The reported bug, end to end: the server was down through the task's UTC window. Before
  // this wiring nothing recorded that the window had passed, so the run was skipped forever.
  it("runs a window the server was down for, once, on the next boot", async () => {
    const workspace = makeWorkspace();
    const runs: string[] = [];
    const { manager } = stubTaskManager();
    // An earlier boot, a day ago — four 6-hour windows have passed since.
    await seedSchedulerState(workspace, [worklogTask(runs)], new Date(Date.now() - 24 * HOUR_MS));

    configureSchedulerAdapter(workspace, silent);
    await startSystemTaskScheduler({ taskManager: manager, stateRoot: workspace, tasks: [worklogTask(runs)], log: silent });

    expect(runs).toEqual(["ran"]); // run-once: one batch covers everything missed
    const state: Record<string, { lastRunAt: string; totalRuns: number }> = JSON.parse(await readFile(schedulerStateFilePath(workspace), "utf-8"));
    expect(state["system.worklog"].totalRuns).toBe(1);
    // And the clock has moved to the window that ran, so the next boot owes nothing.
    expect(new Date(state["system.worklog"].lastRunAt).getTime()).toBeGreaterThan(Date.now() - 7 * HOUR_MS);
  });

  it("writes an execution log entry the API can read back", async () => {
    const workspace = makeWorkspace();
    const runs: string[] = [];
    const { manager } = stubTaskManager();
    await seedSchedulerState(workspace, [worklogTask(runs)], new Date(Date.now() - 24 * HOUR_MS));

    configureSchedulerAdapter(workspace, silent);
    await startSystemTaskScheduler({ taskManager: manager, stateRoot: workspace, tasks: [worklogTask(runs)], log: silent });

    // Read whichever daily file it landed in rather than computing today's name — a run that
    // straddles UTC midnight would otherwise fail this test and nothing else.
    const logsDir = path.join(workspace, "data", "scheduler", "logs");
    const [logFile] = await readdir(logsDir);
    const logLine: { taskId: string; trigger: string; result: string } = JSON.parse((await readFile(path.join(logsDir, logFile), "utf-8")).trim());
    expect(logLine).toMatchObject({ taskId: "system.worklog", trigger: "catch-up", result: "success" });
  });
});
