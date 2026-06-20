// GET/POST /api/config — the default workspace dir + the user's directory presets
// (persisted at ~/.mulmoterminal/config.json), shown/edited in the UI. Kept in its
// own module (mounted from index.ts) so grid/preset work doesn't churn index.ts
// and collide with unrelated server changes.
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import { loadPresets, savePresets, sanitizePresets, type CwdPreset } from "./cwd-presets.js";

const CONFIG_FILE = path.join(os.homedir(), ".mulmoterminal", "config.json");
let cwdPresets: CwdPreset[] = loadPresets(CONFIG_FILE);

export function mountConfigRoutes(app: Express, claudeCwd: string): void {
  app.get("/api/config", (_req, res) => {
    res.json({ cwd: claudeCwd, cwdPresets, home: os.homedir() });
  });

  app.post("/api/config", (req, res) => {
    const body = req.body ?? {};
    if (!Array.isArray(body.cwdPresets)) return res.status(400).json({ error: "cwdPresets must be an array" });
    // Stage, persist, commit in-memory only on success — a failed write must not
    // leave GET exposing presets that won't survive a restart.
    const next = sanitizePresets(body.cwdPresets);
    if (!savePresets(CONFIG_FILE, next)) return res.status(500).json({ error: "failed to persist presets" });
    cwdPresets = next;
    res.json({ cwd: claudeCwd, cwdPresets });
  });
}
