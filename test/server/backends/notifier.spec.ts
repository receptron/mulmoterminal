// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { publish, resetNotifier } from "@mulmoclaude/core/notifier";
import { initNotifier, mountNotificationRoutes, NOTIFIER_CHANNEL } from "../../../server/backends/notifier.js";

interface Published {
  channel: string;
  data: unknown;
}
let events: Published[] = [];
let workspace: string;
let server: Server;
let base: string;
const tempDirs: string[] = [];

function activeFile(): string {
  return path.join(workspace, "data", "notifier", "active.json");
}

beforeEach(async () => {
  resetNotifier();
  workspace = mkdtempSync(path.join(tmpdir(), "mt-notif-"));
  tempDirs.push(workspace);
  events = [];
  await initNotifier({
    workspace,
    pubsub: { publish: (channel, data) => events.push({ channel, data }) },
  });

  const app = express();
  app.use(express.json());
  mountNotificationRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterEach(() => {
  server?.close();
  resetNotifier();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("notifier backend", () => {
  it("publishes → lists → fans out an event → persists active.json → clears", async () => {
    const { id } = await publish({ pluginPkg: "test", severity: "nudge", title: "Heads up", body: "something happened" });

    // Fan-out: a "published" event landed on the notifier channel.
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe(NOTIFIER_CHANNEL);
    expect(events[0].data).toMatchObject({ type: "published", entry: { id, title: "Heads up" } });

    // REST list returns the active entry.
    const listRes = await fetch(`${base}/api/notifications`);
    expect(listRes.status).toBe(200);
    const { active } = (await listRes.json()) as { active: Array<{ id: string; title: string }> };
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id, title: "Heads up" });

    // Persisted to the shared workspace file.
    expect(existsSync(activeFile())).toBe(true);
    const onDisk = JSON.parse(readFileSync(activeFile(), "utf8")) as { entries: Record<string, unknown> };
    expect(Object.keys(onDisk.entries)).toContain(id);

    // Dismiss via REST → 204, removed from the active list, "cleared" event fired.
    const clearRes = await fetch(`${base}/api/notifications/${encodeURIComponent(id)}/clear`, { method: "POST" });
    expect(clearRes.status).toBe(204);

    const afterRes = await fetch(`${base}/api/notifications`);
    expect(((await afterRes.json()) as { active: unknown[] }).active).toHaveLength(0);
    expect(events.some((event) => (event.data as { type?: string }).type === "cleared")).toBe(true);
  });
});
