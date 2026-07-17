// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest.js";
import express from "express.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs.js";
import { tmpdir } from "node:os.js";
import path from "node:path.js";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler.js";
import type { Server } from "node:http.js";
import type { TaskDefinition } from "@mulmoclaude/core/scheduler.js";
import { buildUserTaskDefinitions, loadUserTasks, mountSchedulerRoutes, initUserTaskScheduler } from "../../../server/backends/scheduler.js";

// Mock the shared task-manager so initUserTaskScheduler's registration + start calls
// are observable without starting real interval timers.
const { registerTaskMock, startMock } = vi.hoisted(() => ({ registerTaskMock: vi.fn(), startMock: vi.fn() }));
vi.mock("@mulmoclaude/core/scheduler", () => ({
  createTaskManager: () => ({ registerTask: registerTaskMock, start: startMock }),
}));

const tempDirs: string[] = [];

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
  const spawnChat = (message: string) => spawned.push(message);

  beforeEach(() => {
    spawned = [];
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
  let server: Server;
  let base: string;

  afterEach(() => server?.close());

  it("GET /api/scheduler/tasks lists the persisted tasks", async () => {
    const tasks = [{ id: "a", schedule: { type: "daily", time: "11:00" }, enabled: true, prompt: "go" }];
    const workspace = makeWorkspace(tasks);
    const app = express();
    mountSchedulerRoutes(app, { workspace });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    const res = await fetch(`${base}/api/scheduler/tasks`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tasks });
  });
});

describe("initUserTaskScheduler", () => {
  const sysTask = (id: string): TaskDefinition => ({
    id,
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60 * 60 * 1000 },
    run: async () => {},
  });

  beforeEach(() => {
    registerTaskMock.mockClear();
    startMock.mockClear();
  });

  it("registers system tasks and starts the tick loop even with zero user tasks", () => {
    // makeWorkspace() with no tasks.json → zero user tasks (the standalone feed-refresh case).
    const count = initUserTaskScheduler({
      workspace: makeWorkspace(),
      spawnChat: () => {},
      systemTasks: [sysTask("system:feed-refresh")],
    });
    expect(count).toBe(0); // zero USER tasks
    expect(registerTaskMock).toHaveBeenCalledTimes(1);
    expect(registerTaskMock).toHaveBeenCalledWith(expect.objectContaining({ id: "system:feed-refresh" }));
    expect(startMock).toHaveBeenCalledTimes(1); // started despite zero user tasks
  });

  it("does not start the tick loop when there are no tasks at all", () => {
    initUserTaskScheduler({ workspace: makeWorkspace(), spawnChat: () => {} });
    expect(registerTaskMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("registers both system and user tasks on the one manager", () => {
    const count = initUserTaskScheduler({
      workspace: makeWorkspace([{ id: "a", schedule: { type: "daily", time: "11:00" }, enabled: true, prompt: "go" }]),
      spawnChat: () => {},
      systemTasks: [sysTask("system:feed-refresh")],
    });
    expect(count).toBe(1); // one user task
    const ids = registerTaskMock.mock.calls.map((call) => (call[0] as TaskDefinition).id);
    expect(ids).toEqual(expect.arrayContaining(["system:feed-refresh", "user.a"]));
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
