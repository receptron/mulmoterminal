// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appRequest } from "../../helpers/appRequest.js";
import { publish, resetNotifier } from "@mulmoclaude/core/notifier";
import { initNotifier, mountNotificationRoutes, NOTIFIER_CHANNEL } from "../../../server/backends/notifier.js";
import { hostStateRoot } from "../../../server/infra/host-state-root.js";

interface Published {
  channel: string;
  data: unknown;
}
let events: Published[] = [];
let workspace: string;
// A disposable home: these files hang off the HOST STATE ROOT, and the workspace here is a
// throwaway temp dir rather than the managed one — so letting it default would write into the
// home of whoever runs the suite.
let home: string;
let request: ReturnType<typeof appRequest>;
const tempDirs: string[] = [];

function activeFile(): string {
  return path.join(hostStateRoot(workspace, home), "data", "notifier", "active.json");
}

beforeEach(async () => {
  resetNotifier();
  workspace = mkdtempSync(path.join(tmpdir(), "mt-notif-"));
  home = mkdtempSync(path.join(tmpdir(), "mt-notif-home-"));
  tempDirs.push(workspace, home);
  events = [];
  await initNotifier({
    workspace,
    home,
    pubsub: { publish: (channel, data) => events.push({ channel, data }) },
  });

  const app = express();
  app.use(express.json());
  mountNotificationRoutes(app);
  request = appRequest(app);
});

afterEach(() => {
  resetNotifier();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("notifier backend", () => {
  // The property #2024 is about, asserted against the workspace directly rather than through
  // `hostStateRoot` — routing the expectation through the same function that decides the path
  // would pass however that function answered.
  it("writes nothing into a workspace that is not the managed one", async () => {
    await publish({ pluginPkg: "test", severity: "nudge", title: "Heads up", body: "something happened" });
    expect(existsSync(path.join(workspace, "data"))).toBe(false);
    expect(existsSync(path.join(workspace, "config"))).toBe(false);
    expect(readdirSync(workspace)).toEqual([]);
  });

  it("publishes → lists → fans out an event → persists active.json → clears", async () => {
    const { id } = await publish({ pluginPkg: "test", severity: "nudge", title: "Heads up", body: "something happened" });

    // Fan-out: a "published" event landed on the notifier channel.
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe(NOTIFIER_CHANNEL);
    expect(events[0].data).toMatchObject({ type: "published", entry: { id, title: "Heads up" } });

    // REST list returns the active entry.
    const listRes = await request("/api/notifications");
    expect(listRes.status).toBe(200);
    const { active } = (await listRes.json()) as { active: Array<{ id: string; title: string }> };
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id, title: "Heads up" });

    // Persisted under the host state root (#2024) — not into the launch directory.
    expect(existsSync(activeFile())).toBe(true);
    const onDisk = JSON.parse(readFileSync(activeFile(), "utf8")) as { entries: Record<string, unknown> };
    expect(Object.keys(onDisk.entries)).toContain(id);

    // Dismiss via REST → 204, removed from the active list, "cleared" event fired.
    const clearRes = await request(`/api/notifications/${encodeURIComponent(id)}/clear`, { method: "POST" });
    expect(clearRes.status).toBe(204);

    const afterRes = await request("/api/notifications");
    expect(((await afterRes.json()) as { active: unknown[] }).active).toHaveLength(0);
    expect(events.some((event) => (event.data as { type?: string }).type === "cleared")).toBe(true);
  });
});
