import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import { resolveDirRequest } from "./dirRequest.js";

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
    const dir = resolveDirRequest(req, res, isAllowedOrigin);
    if (!dir) return;
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
