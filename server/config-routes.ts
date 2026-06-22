// GET/POST /api/config — the default workspace dir, the user's directory presets,
// and an optional custom attention-sound file (persisted at ~/.mulmoterminal/
// config.json), shown/edited in the UI. GET /api/sound streams that sound file.
// Kept in its own module (mounted from index.ts) so grid/preset work doesn't churn
// index.ts and collide with unrelated server changes.
import os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import type { Express } from "express";
import { sanitizePresets } from "./cwd-presets.js";
import { loadAppConfig, saveAppConfig, sanitizeSoundFile, type AppConfig } from "./app-config.js";

const CONFIG_FILE = path.join(os.homedir(), ".mulmoterminal", "config.json");
let config: AppConfig = loadAppConfig(CONFIG_FILE);

export function mountConfigRoutes(app: Express, claudeCwd: string): void {
  app.get("/api/config", (_req, res) => {
    res.json({ cwd: claudeCwd, cwdPresets: config.cwdPresets, soundFile: config.soundFile, home: os.homedir() });
  });

  app.post("/api/config", (req, res) => {
    const body = req.body ?? {};
    // Partial update: keep the field the request omits so saving the sound doesn't
    // wipe the presets (and vice-versa). cwdPresets, when present, must be an array.
    if (body.cwdPresets !== undefined && !Array.isArray(body.cwdPresets)) {
      return res.status(400).json({ error: "cwdPresets must be an array" });
    }
    const next: AppConfig = {
      cwdPresets: body.cwdPresets !== undefined ? sanitizePresets(body.cwdPresets) : config.cwdPresets,
      soundFile: body.soundFile !== undefined ? sanitizeSoundFile(body.soundFile) : config.soundFile,
    };
    // Stage, persist, commit in-memory only on success — a failed write must not
    // leave GET exposing values that won't survive a restart.
    if (!saveAppConfig(CONFIG_FILE, next)) return res.status(500).json({ error: "failed to persist config" });
    config = next;
    res.json({ cwd: claudeCwd, cwdPresets: config.cwdPresets, soundFile: config.soundFile });
  });

  // Stream the user's custom attention sound (their own file, set in config). The
  // path comes from server-side config — never from the request — so there's no
  // traversal surface. 404 when unset or the file is gone (the client then falls
  // back to the built-in chime).
  app.get("/api/sound", (_req, res) => {
    const file = config.soundFile;
    if (!file || !existsSync(file) || !statSync(file).isFile()) return res.status(404).end();
    res.sendFile(path.resolve(file));
  });
}
