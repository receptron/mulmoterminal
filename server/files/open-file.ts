// POST /api/files/open { path } — hand a file to the OS's default application (#2038).
//
// The other half of the pair with `reveal.ts` (#2039), and the two are deliberately different
// verbs: this one OPENS the file (Excel for an xlsx), that one shows where it lives. Same route
// naming and `{ ok: true }` contract as MulmoClaude's `/api/files/open`
// (src/config/apiRoutes.ts there is the authority), and the same WSL divergence: the opener list
// is `openDirCommands()`, so a distro with no desktop still reaches Explorer (#1447).
import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { openDirCommands } from "./open-dir.js";
import { resolvePathRequest } from "./dirRequest.js";
import { isWsl, toWindowsPath } from "./wsl.js";

/** Injected so a spec can assert the argv without an application appearing on the machine. */
export type Spawner = typeof spawn;

// Resolves null once the child is RUNNING, or the reason it could not start. The exit code is not
// awaited — a launcher returning non-zero on a successful open is normal, and the user is done
// with us the moment the application appears. Same reasoning as open-dir.ts and reveal.ts.
function spawnOpen(cmd: string, target: string, spawner: Spawner): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawner(cmd, [target], { detached: true, stdio: "ignore" });
    child.on("error", (e) => resolve(e.message));
    child.on("spawn", () => {
      child.unref();
      resolve(null);
    });
  });
}

interface OpenOptions {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  spawner?: Spawner;
}

export function mountOpenFileRoute(app: Express, { isAllowedOrigin, spawner = spawn }: OpenOptions): void {
  app.post("/api/files/open", async (req: Request, res) => {
    // Normalised BEFORE the stat, so the path that was validated is the path that is handed over:
    // `path.resolve` folds `..` lexically while the kernel folds it through symlinks, and doing it
    // afterwards validates one pathname and acts on another (the P2 this pair already paid for on
    // #2039).
    const target = resolvePathRequest(req, res, isAllowedOrigin, { normalise: path.resolve });
    if (!target) return;
    // A directory has its own route, and handing one to `open` would launch a file manager from
    // the endpoint whose whole job is to launch an APPLICATION.
    if (target.isDir) return res.status(400).json({ error: "not a file" });
    const attempts: string[] = [];
    for (const candidate of openDirCommands(process.platform, isWsl(process.platform, process.env))) {
      const asked = candidate.windowsPath ? await toWindowsPath(target.path) : target.path;
      if (asked === null) {
        attempts.push(`${candidate.cmd}: wslpath could not translate ${target.path}`);
        continue;
      }
      const failure = await spawnOpen(candidate.cmd, asked, spawner);
      if (failure === null) return res.json({ ok: true });
      attempts.push(`${candidate.cmd}: ${failure}`);
    }
    // Answered only once something has actually STARTED: saying ok first and logging the failure
    // is what made a host with no opener report a launch that never happened (#1447).
    res.status(500).json({ error: `could not open ${target.path} [${attempts.join("; ")}]` });
  });
}
