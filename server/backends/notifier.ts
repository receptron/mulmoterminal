// Notification engine wiring — thin host binding over @mulmoclaude/notifier
// (shared with MulmoClaude). The engine owns active+history persistence,
// validation, and fan-out; MulmoTerminal injects its pubsub (for the bell to
// live-update), an atomic JSON writer, and a logger.
//
// State lives in the SHARED workspace (<workspace>/data/notifier/{active,
// history}.json), the same paths MulmoClaude uses — notifications are about
// workspace state (e.g. collection completions), so both apps view the same
// set. The apps never run simultaneously, so there's no concurrent-write race.

import path from "node:path";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { configureNotifier, setNotifierFilePaths, listAll, listHistory, clear } from "@mulmoclaude/notifier";
import type { createPubSub } from "../pubsub.js";

type PubSub = ReturnType<typeof createPubSub>;

// Pubsub channel the bell subscribes to (mirrors MulmoClaude's
// PUBSUB_CHANNELS.notifier). Carries a NotifierEvent on every state change.
export const NOTIFIER_CHANNEL = "notifier";

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(tmp, filePath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export function initNotifier(deps: { workspace: string; pubsub: PubSub | null }): void {
  configureNotifier({
    writeJson: writeJsonAtomic,
    publishEvent: (event) => deps.pubsub?.publish(NOTIFIER_CHANNEL, event),
    log: {
      warn: (message, data) => console.warn(`[notifier] ${message}`, data ?? ""),
      error: (message, data) => console.error(`[notifier] ${message}`, data ?? ""),
    },
  });
  setNotifierFilePaths({
    active: path.join(deps.workspace, "data", "notifier", "active.json"),
    history: path.join(deps.workspace, "data", "notifier", "history.json"),
  });
}

/** REST surface the bell uses: list active, list history, clear one. */
export function mountNotificationRoutes(app: Express): void {
  app.get("/api/notifications", async (_req: Request, res: Response) => {
    try {
      res.json({ entries: await listAll() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/notifications/history", async (_req: Request, res: Response) => {
    try {
      res.json({ entries: await listHistory() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/notifications/:id/clear", async (req: Request<{ id: string }>, res: Response) => {
    try {
      await clear(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
