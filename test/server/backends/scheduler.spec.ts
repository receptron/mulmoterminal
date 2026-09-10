// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MISSED_RUN_POLICIES, SCHEDULE_TYPES } from "@receptron/task-scheduler";
import { appRequest } from "../../helpers/appRequest.js";
import type { SystemTaskDef, TaskDefinition } from "@mulmoclaude/core/scheduler";
import { buildUserTaskDefinitions, loadUserTasks, mountSchedulerRoutes, initUserTaskScheduler } from "../../../server/backends/scheduler.js";
import { hostStateRoot } from "../../../server/infra/host-state-root.js";

// Mock the shared scheduler package so registration, the tick loop and the persistence adapter
// are observable without real timers or a real catch-up run. The SEED is deliberately left
// real — it writes into the temp workspace, and it is the half of #1581 this host owns.
const {
  registerTaskMock,
  startMock,
  configureSchedulerMock,
  initSchedulerMock,
  recordExternalRunMock,
  getSchedulerTasksMock,
  getSchedulerTaskStateMock,
  getSchedulerLogsMock,
} = vi.hoisted(() => ({
  registerTaskMock: vi.fn(),
  startMock: vi.fn(),
  configureSchedulerMock: vi.fn(),
  initSchedulerMock: vi.fn(async () => {}),
  recordExternalRunMock: vi.fn(async () => {}),
  getSchedulerTasksMock: vi.fn(() => [] as unknown[]),
  getSchedulerTaskStateMock: vi.fn((taskId: string) => ({ taskId, totalRuns: 0 })),
  getSchedulerLogsMock: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@mulmoclaude/core/scheduler", () => ({
  createTaskManager: () => ({ registerTask: registerTaskMock, start: startMock }),
  configureScheduler: configureSchedulerMock,
  initScheduler: initSchedulerMock,
  recordExternalRun: recordExternalRunMock,
  getSchedulerTasks: getSchedulerTasksMock,
  getSchedulerTaskState: getSchedulerTaskStateMock,
  getSchedulerLogs: getSchedulerLogsMock,
}));

const tempDirs: string[] = [];
const SESSION_ID = "11111111-1111-1111-1111-111111111111";
const spawnOk = () => SESSION_ID;

function makeWorkspace(tasks?: unknown): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "mt-sched-"));
  tempDirs.push(workspace);
  if (tasks !== undefined) {
    const dir = path.join(workspace, "config", "scheduler");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "tasks.json"), typeof tasks === "string" ? tasks : JSON.stringify(tasks));
  }
  return workspace;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("buildUserTaskDefinitions", () => {
  let spawned: string[];
  const spawnChat = (message: string) => {
    spawned.push(message);
    return SESSION_ID;
  };

  beforeEach(() => {
    spawned = [];
    recordExternalRunMock.mockClear();
  });

  it("registers only enabled tasks with a valid id, prompt, and schedule", () => {
    const tasks = [
      { id: "a", name: "Daily", schedule: { type: "daily", time: "11:00" }, enabled: true, prompt: "  do A  " },
      { id: "b", schedule: { type: "interval", intervalMs: 60000 }, enabled: true, prompt: "do B" },
      { id: "c", schedule: { type: "daily", time: "09:00" }, enabled: false, prompt: "disabled" },
      { id: "d", schedule: { type: "daily", time: "25:00" }, enabled: true, prompt: "bad hour" },
      { id: "e", schedule: { type: "daily", time: "9:00" }, enabled: true, prompt: "unpadded" },
      { id: "f", schedule: { type: "interval", intervalMs: 0 }, enabled: true, prompt: "bad interval" },
      { id: "", schedule: { type: "daily", time: "10:00" }, enabled: true, prompt: "no id" },
      { id: "g", schedule: { type: "daily", time: "10:00" }, enabled: true, prompt: "   " },
    ];

    const definitions = buildUserTaskDefinitions(tasks, spawnChat);

    expect(definitions.map((definition) => definition.id)).toEqual(["user.a", "user.b"]);
    expect(definitions[0].schedule).toEqual({ type: "daily", time: "11:00" });
  });

  it("treats an omitted enabled field as enabled (only explicit false disables)", () => {
    const tasks = [
      { id: "noflag", schedule: { type: "daily", time: "07:00" }, prompt: "go" },
      { id: "off", schedule: { type: "daily", time: "07:00" }, enabled: false, prompt: "x" },
    ];

    const definitions = buildUserTaskDefinitions(tasks, spawnChat);

    expect(definitions.map((definition) => definition.id)).toEqual(["user.noflag"]);
  });

  it("skips non-object array elements without throwing (non-fatal)", () => {
    const tasks = [null, 42, "nope", { id: "ok", schedule: { type: "daily", time: "08:00" }, enabled: true, prompt: "go" }];

    const definitions = buildUserTaskDefinitions(tasks, spawnChat);

    expect(definitions.map((definition) => definition.id)).toEqual(["user.ok"]);
  });

  it("a task's run spawns a chat seeded with the trimmed prompt", async () => {
    const tasks = [{ id: "a", schedule: { type: "daily", time: "11:00" }, enabled: true, prompt: "  nudge me  " }];

    const definitions = buildUserTaskDefinitions(tasks, spawnChat);
    await definitions[0].run({ taskId: "user.a", now: new Date(0) });

    expect(spawned).toEqual(["nudge me"]);
  });

  // User tasks get no catch-up in either host — what they get is a record of every run, so a
  // task that fired (or failed to) can be told apart from one that never came due (#1581).
  it("records the turn's outcome under the task-manager id, not merely the dispatch", async () => {
    const tasks = [{ id: "a", name: "Nudge", schedule: { type: "daily", time: "11:00" }, prompt: "go" }];
    let reportOutcome: ((outcome: { didError: boolean }, sessionId: string) => void | Promise<void>) | undefined;
    const spawnWithHook = (_message: string, onComplete?: (outcome: { didError: boolean }, sessionId: string) => void | Promise<void>) => {
      reportOutcome = onComplete;
      return SESSION_ID;
    };

    await buildUserTaskDefinitions(tasks, spawnWithHook)[0].run({ taskId: "user.a", now: new Date(0) });
    expect(recordExternalRunMock).not.toHaveBeenCalled(); // the turn has not finished yet
    await reportOutcome?.({ didError: true }, SESSION_ID);

    expect(recordExternalRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user.a", name: "Nudge", chatSessionId: SESSION_ID, errorMessage: expect.stringContaining("did not complete") }),
    );
  });

  it("records a spawn that threw, and lets the failure reach the tick log", async () => {
    const tasks = [{ id: "a", schedule: { type: "daily", time: "11:00" }, prompt: "go" }];
    const throwing = () => {
      throw new Error("claude missing");
    };

    await expect(buildUserTaskDefinitions(tasks, throwing)[0].run({ taskId: "user.a", now: new Date(0) })).rejects.toThrow("claude missing");
    expect(recordExternalRunMock).toHaveBeenCalledWith(expect.objectContaining({ id: "user.a", errorMessage: "claude missing", chatSessionId: undefined }));
  });
});

describe("loadUserTasks", () => {
  it("returns [] when the file is missing", () => {
    expect(loadUserTasks(makeWorkspace())).toEqual([]);
  });

  it("returns [] for malformed JSON (never throws)", () => {
    expect(loadUserTasks(makeWorkspace("{ not json"))).toEqual([]);
  });

  it("returns [] when the JSON is not an array", () => {
    expect(loadUserTasks(makeWorkspace({ tasks: [] }))).toEqual([]);
  });

  it("parses a valid task array", () => {
    const tasks = [{ id: "a", schedule: { type: "daily", time: "11:00" }, enabled: true, prompt: "go" }];
    expect(loadUserTasks(makeWorkspace(tasks))).toEqual(tasks);
  });
});

describe("mountSchedulerRoutes", () => {
  beforeEach(() => {
    getSchedulerTasksMock.mockReturnValue([]);
    getSchedulerLogsMock.mockClear();
  });

  it("GET /api/scheduler/tasks lists the persisted tasks with their execution state", async () => {
    const tasks = [{ id: "a", schedule: { type: "daily", time: "11:00" }, enabled: true, prompt: "go" }];
    const app = express();
    mountSchedulerRoutes(app, { workspace: makeWorkspace(tasks) });

    const res = await appRequest(app)("/api/scheduler/tasks");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tasks: [{ ...tasks[0], origin: "user", state: { taskId: "user.a", totalRuns: 0 } }] });
  });

  // The reported symptom was as much "no way to tell whether it ever ran" as the missed run:
  // the old route answered from tasks.json only, so a system task appeared nowhere at all.
  it("GET /api/scheduler/tasks includes the system tasks the adapter runs", async () => {
    getSchedulerTasksMock.mockReturnValue([{ id: "system.worklog", name: "Dev worklog", state: { taskId: "system.worklog", totalRuns: 2 } }]);
    const app = express();
    mountSchedulerRoutes(app, { workspace: makeWorkspace() });

    // No tasks.json in this workspace, so the system task is the whole list.
    expect(await (await appRequest(app)("/api/scheduler/tasks")).json()).toEqual({
      tasks: [expect.objectContaining({ id: "system.worklog", origin: "system" })],
    });
  });

  it("GET /api/scheduler/logs passes the filters through, capping the limit", async () => {
    const app = express();
    mountSchedulerRoutes(app, { workspace: makeWorkspace() });

    const res = await appRequest(app)("/api/scheduler/logs?taskId=system.worklog&limit=9000&since=2026-01-01T00:00:00.000Z");
    expect(res.status).toBe(200);
    expect(getSchedulerLogsMock).toHaveBeenCalledWith({ taskId: "system.worklog", limit: 500, since: "2026-01-01T00:00:00.000Z" });
  });

  it("GET /api/scheduler/logs reads an absent filter as unset, not as a bad request", async () => {
    const app = express();
    mountSchedulerRoutes(app, { workspace: makeWorkspace() });

    await appRequest(app)("/api/scheduler/logs?limit=notanumber");
    expect(getSchedulerLogsMock).toHaveBeenCalledWith({ taskId: undefined, limit: undefined, since: undefined });
  });
});

describe("initUserTaskScheduler", () => {
  const sysTask = (id: string): SystemTaskDef => ({
    id,
    name: id,
    description: id,
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60 * 60 * 1000 },
    missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
    run: async () => {},
  });

  // Every call gets a disposable home: state and logs now hang off the HOST STATE ROOT, so a
  // spec that let it default would file them in the home of whoever runs the suite.
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "mt-home-"));
    tempDirs.push(home);
    registerTaskMock.mockClear();
    startMock.mockClear();
    initSchedulerMock.mockClear();
    configureSchedulerMock.mockClear();
  });

  it("hands the system tasks to the persistence adapter and starts the tick loop with zero user tasks", async () => {
    const count = initUserTaskScheduler({
      workspace: makeWorkspace(),
      spawnChat: spawnOk,
      systemTasks: [sysTask("system:feed-refresh")],
      home,
    });
    expect(count).toBe(0); // zero USER tasks
    // System tasks are NOT registered directly any more — registering them there is what left
    // them with no state and no catch-up (#1581).
    expect(registerTaskMock).not.toHaveBeenCalled();
    expect(startMock).toHaveBeenCalledTimes(1); // started despite zero user tasks
    await vi.waitFor(() => expect(initSchedulerMock).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ id: "system:feed-refresh" })]));
  });

  // The tick loop must not wait for the adapter's seed + catch-up, however long that takes: a
  // user task's window is one-shot (no catch-up in either host), so a tick it misses is a
  // reminder that never fires. A system task registered a moment late loses at most one run, and
  // its work is covered by the next one. Both sides of this were flagged in review, in turn.
  it("ticks without waiting for the adapter's catch-up to finish", async () => {
    initSchedulerMock.mockImplementationOnce(() => new Promise<void>(() => {})); // never settles

    initUserTaskScheduler({
      workspace: makeWorkspace([{ id: "a", schedule: { type: "daily", time: "11:00" }, prompt: "go" }]),
      spawnChat: spawnOk,
      systemTasks: [sysTask("system:feed-refresh")],
      home,
    });

    expect(startMock).toHaveBeenCalledTimes(1); // already ticking, with the adapter still going
    // Then let the adapter reach `initScheduler` before this test ends. Not decoration: the seed
    // ahead of it is real file I/O, and a call still in flight lands in a LATER test's counts —
    // which is how this file went green here and red on the slower CI runner.
    await vi.waitFor(() => expect(initSchedulerMock).toHaveBeenCalledTimes(1));
  });

  // And a broken adapter must not leave the user's own tasks dead in the water either.
  it("still ticks when the adapter fails to start", async () => {
    initSchedulerMock.mockRejectedValueOnce(new Error("disk full"));

    initUserTaskScheduler({
      workspace: makeWorkspace([{ id: "a", schedule: { type: "daily", time: "11:00" }, prompt: "go" }]),
      spawnChat: spawnOk,
      systemTasks: [sysTask("system:feed-refresh")],
      home,
    });

    expect(startMock).toHaveBeenCalledTimes(1);
    // Same reason as above: don't leave the rejected adapter start in flight into the next test.
    await vi.waitFor(() => expect(initSchedulerMock).toHaveBeenCalledTimes(1));
  });

  it("does not start the tick loop when there are no tasks at all", () => {
    initUserTaskScheduler({ workspace: makeWorkspace(), spawnChat: spawnOk, home });
    expect(registerTaskMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
    expect(initSchedulerMock).not.toHaveBeenCalled();
  });

  // Configured even then: the read-only routes and any later run recording reach the same
  // module-level config, and it touches no disk.
  it("configures the adapter even with no tasks at all", () => {
    initUserTaskScheduler({ workspace: makeWorkspace(), spawnChat: spawnOk, home });
    expect(configureSchedulerMock).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: expect.any(String) }));
  });

  // #2024: the launcher defaults the workspace to the directory it was run from, so state and
  // logs filed under it land in someone's project — where they cannot be deleted, because the
  // next hourly run writes them again.
  it("keeps the adapter's state root out of a workspace that is not the managed one", () => {
    const workspace = makeWorkspace();
    initUserTaskScheduler({ workspace, spawnChat: spawnOk, home });
    const [config] = configureSchedulerMock.mock.calls[0] as [{ workspaceRoot: string }];
    expect(config.workspaceRoot.startsWith(workspace)).toBe(false);
    expect(config.workspaceRoot.startsWith(home)).toBe(true);
  });

  // The other direction of the same gate: on the managed workspace both hosts read each
  // other's state file, so it must stay exactly where MulmoClaude looks for it.
  it("leaves the state root ON the workspace when it is the managed one", () => {
    const workspace = makeWorkspace();
    const saved = process.env.MULMOCLAUDE_WORKSPACE_PATH;
    process.env.MULMOCLAUDE_WORKSPACE_PATH = workspace;
    try {
      initUserTaskScheduler({ workspace, spawnChat: spawnOk, home });
      expect(configureSchedulerMock).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: workspace }));
    } finally {
      if (saved === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
      else process.env.MULMOCLAUDE_WORKSPACE_PATH = saved;
    }
  });

  it("registers the user tasks on the manager and the system tasks through the adapter", async () => {
    const count = initUserTaskScheduler({
      workspace: makeWorkspace([{ id: "a", schedule: { type: "daily", time: "11:00" }, enabled: true, prompt: "go" }]),
      spawnChat: spawnOk,
      systemTasks: [sysTask("system:feed-refresh")],
      home,
    });
    expect(count).toBe(1); // one user task
    expect(registerTaskMock.mock.calls.map((call) => (call[0] as TaskDefinition).id)).toEqual(["user.a"]);
    expect(startMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(initSchedulerMock).toHaveBeenCalledTimes(1));
  });

  // The seed is what makes catch-up reachable at all: a task with no state entry is read as
  // "just registered" every boot, so a 6-hour worklog on a laptop never runs once (#1581).
  it("seeds first-run state for the system tasks before the adapter loads it", async () => {
    const workspace = makeWorkspace();
    initUserTaskScheduler({ workspace, spawnChat: spawnOk, systemTasks: [sysTask("system.worklog")], home });

    await vi.waitFor(() => expect(initSchedulerMock).toHaveBeenCalled());
    const state: Record<string, { lastRunAt: string | null; totalRuns: number }> = JSON.parse(
      await readFile(path.join(hostStateRoot(workspace, home), "config", "scheduler", "state.json"), "utf-8"),
    );
    expect(state["system.worklog"].lastRunAt).not.toBeNull();
    expect(state["system.worklog"].totalRuns).toBe(0); // seeded, not claimed to have run
  });
});
