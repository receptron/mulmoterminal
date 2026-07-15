import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../session/transcript.js";

// The native file-manager opener for a platform. The command is a fixed
// allowlist (never built from input); the directory is passed as a separate argv
// entry, so there's no shell and no injection surface.
export function openCommand(platform: NodeJS.Platform): string {
  if (platform === "win32") return "explorer";
  if (platform === "darwin") return "open";
  return "xdg-open";
}

interface OpenDirOptions {
  isAllowedOrigin: (origin?: string) => boolean;
}

// POST /api/open-dir { path } — reveal an absolute, existing directory in the OS
// file manager. The server runs locally, so this is how a browser tab (which can't
// touch the filesystem) opens a folder. Guarded by the same-origin check used for
// the sockets so a random website can't drive it.
export function mountOpenDirRoute(app: Express, { isAllowedOrigin }: OpenDirOptions) {
  app.post("/api/open-dir", (req: Request, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });

    const dir = isRecord(req.body) && typeof req.body.path === "string" ? req.body.path : "";
    if (!dir || !path.isAbsolute(dir)) return res.status(400).json({ error: "absolute path required" });
    try {
      if (!statSync(dir).isDirectory()) return res.status(400).json({ error: "not a directory" });
    } catch {
      return res.status(404).json({ error: "directory not found" });
    }

    try {
      const child = spawn(openCommand(process.platform), [dir], { detached: true, stdio: "ignore" });
      child.on("error", (e) => console.error(`[open-dir] failed to open ${dir}: ${e.message}`));
      child.unref();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
