// Notification engine wiring, shared with MulmoClaude via @mulmoclaude/core. The
// engine holds an active set + a capped history, persisted to
// `data/notifier/{active,history}.json` under the HOST STATE ROOT. On the managed workspace
// that root is the workspace, so these are the same files MulmoClaude uses — both apps never
// run simultaneously, so no locking. Anywhere else the root is this workspace's directory
// under ~/.mulmoterminal, because a launch directory is usually someone's project and there
// is no MulmoClaude there to share with (host-state-root.ts). Every state change fans out a
// NotifierEvent on the pubsub NOTIFIER_CHANNEL so the bell UI updates live.
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { configureNotifier, setNotifierFilePaths, listAll, listHistory, clear } from "@mulmoclaude/core/notifier";
import type { Publisher } from "../infra/pubsub.js";
import { hostStateRoot } from "../infra/host-state-root.js";

type PubSub = Publisher;

/** Pubsub channel the engine fans out on; the frontend bell subscribes to the same
 *  string (mirrored in src/composables/useNotifications.ts). */
export const NOTIFIER_CHANNEL = "notifications";

const log = {
  warn: (message: string, data?: Record<string, unknown>) => console.warn(`[notifier] ${message}`, data ?? ""),
  error: (message: string, data?: Record<string, unknown>) => console.error(`[notifier] ${message}`, data ?? ""),
};

// Atomic JSON writer (temp file + rename), matching the pattern in shortcuts.ts so a
// reader never sees a half-written file. The engine serialises its own mutations.
async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Configure the engine against MulmoTerminal's pubsub + its state files. Call once at
 *  startup, before any publish/clear (and before the collection watchers start). */
export async function initNotifier(deps: { workspace: string; pubsub: PubSub | null; home?: string }): Promise<void> {
  const { workspace, pubsub } = deps;
  // Under the host state root, not the workspace: on a launch directory that is someone's
  // project these two files are app state they never asked for (#2024). On the MANAGED
  // workspace the root IS the workspace, so the files MulmoClaude shares stay where they are
  // — see host-state-root.ts.
  const dir = path.join(hostStateRoot(workspace, deps.home), "data", "notifier");
  await fs.mkdir(dir, { recursive: true });
  configureNotifier({
    writeJson: writeJsonAtomic,
    publishEvent: (event) => pubsub?.publish(NOTIFIER_CHANNEL, event),
    log,
  });
  setNotifierFilePaths({ active: path.join(dir, "active.json"), history: path.join(dir, "history.json") });
}

/** REST surface for the bell: list active, list history, dismiss one. */
export function mountNotificationRoutes(app: Express): void {
  app.get("/api/notifications", async (_req: Request, res: Response) => {
    try {
      res.json({ active: await listAll() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/notifications/history", async (_req: Request, res: Response) => {
    try {
      res.json({ history: await listHistory() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/notifications/:id/clear", async (req: Request<{ id: string }>, res: Response) => {
    try {
      await clear(req.params.id);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
