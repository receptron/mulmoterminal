// POST /api/files/reveal { path } — show a file or folder in the OS file manager (#2039).
//
// Not for LOOKING at the file: it is how something the agent produced gets handed to another
// app — dragged into a mail composer or an upload form — and how a file too big to paste gets
// dropped into a folder the agent reads. A file lands selected; a folder simply opens.
//
// The route path, the `{ ok: true }` body and the 400/500 split are MulmoClaude's, whose
// `/api/files/reveal` does the same job (src/config/apiRoutes.ts is its naming authority, and
// server/api/routes/files.ts its implementation). Two divergences, both deliberate:
//
//   - WSL. MulmoClaude branches on `platform` alone; this host already knows that a WSL distro
//     has no desktop of its own, so the opener list comes from `openDirCommands()` — the same
//     `explorer.exe` → `xdg-open` fallback that stopped a silent no-op there (#1447).
//   - Folders. MulmoClaude reveals files; a row here can be either, and a folder is OPENED
//     rather than selected in its parent.
import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { openDirCommands } from "./open-dir.js";
import { resolvePathRequest } from "./dirRequest.js";
import { revealArgv } from "./reveal-argv.js";
import { isWsl, toWindowsPath } from "./wsl.js";

/** Injected so a spec can assert the argv without a file manager appearing on the machine. */
export type Spawner = typeof spawn;

// Resolves null once the child is RUNNING, or the reason it could not start. The exit code is
// deliberately not awaited — `explorer.exe` returns 1 on a perfectly successful open, and the
// user is done with us the moment the window appears. Same reasoning as open-dir.ts.
function spawnReveal(cmd: string, args: string[], spawner: Spawner): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawner(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", (e) => resolve(e.message));
    child.on("spawn", () => {
      child.unref();
      resolve(null);
    });
  });
}

interface RevealOptions {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  spawner?: Spawner;
}

export function mountRevealRoute(app: Express, { isAllowedOrigin, spawner = spawn }: RevealOptions): void {
  app.post("/api/files/reveal", async (req: Request, res) => {
    const target = resolvePathRequest(req, res, isAllowedOrigin);
    if (!target) return;
    // The browser joins a row onto the tree's root with `/` whatever the root looks like, so a
    // Windows path arrives as `C:\\proj/reports/a.pdf`. `explorer /select,` is particular about
    // separators, and this is the side that knows which ones the host uses.
    const native = path.resolve(target.path);
    const attempts: string[] = [];
    for (const candidate of openDirCommands(process.platform, isWsl(process.platform, process.env))) {
      // Translated BEFORE the argv is built: `/select,<path>` is one token, so a Windows opener
      // has to be handed the Windows spelling inside it rather than beside it.
      const asked = candidate.windowsPath ? await toWindowsPath(native) : native;
      if (asked === null) {
        attempts.push(`${candidate.cmd}: wslpath could not translate ${native}`);
        continue;
      }
      const failure = await spawnReveal(candidate.cmd, revealArgv(candidate.cmd, asked, target.isDir), spawner);
      if (failure === null) return res.json({ ok: true });
      attempts.push(`${candidate.cmd}: ${failure}`);
    }
    // Answered only once an opener has actually STARTED. Saying ok first and logging the failure
    // to a console nobody reads is what made a host without `xdg-open` report a reveal that never
    // happened (#1447).
    res.status(500).json({ error: `could not show ${target.path} [${attempts.join("; ")}]` });
  });
}
