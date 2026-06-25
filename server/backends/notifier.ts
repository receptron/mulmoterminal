// Notification engine wiring, shared with MulmoClaude via @mulmoclaude/core. The
// engine holds an active set + a capped history, persisted to the SHARED workspace
// (<ws>/data/notifier/{active,history}.json — the same files MulmoClaude uses; both
// apps never run simultaneously, so no locking). Every state change fans out a
// NotifierEvent on the pubsub NOTIFIER_CHANNEL so the bell UI updates live.
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { configureNotifier, setNotifierFilePaths, listAll, listHistory, clear } from "@mulmoclaude/core/notifier";
import type { createPubSub } from "../pubsub.js";

type PubSub = ReturnType<typeof createPubSub>;

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

/** Configure the engine against MulmoTerminal's pubsub + the shared workspace files.
 *  Call once at startup, before any publish/clear (and before the collection
 *  watchers start). */
export async function initNotifier(deps: { workspace: string; pubsub: PubSub | null }): Promise<void> {
  const { workspace, pubsub } = deps;
  const dir = path.join(workspace, "data", "notifier");
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
