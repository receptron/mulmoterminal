// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { buildUserTaskDefinitions, loadUserTasks, mountSchedulerRoutes, type PersistedUserTask } from "./scheduler.js";

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
    ] as PersistedUserTask[];

    const definitions = buildUserTaskDefinitions(tasks, spawnChat);

    expect(definitions.map((definition) => definition.id)).toEqual(["user.a", "user.b"]);
    expect(definitions[0].schedule).toEqual({ type: "daily", time: "11:00" });
  });

  it("a task's run spawns a chat seeded with the trimmed prompt", async () => {
    const tasks = [{ id: "a", schedule: { type: "daily", time: "11:00" }, enabled: true, prompt: "  nudge me  " }] as PersistedUserTask[];

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
