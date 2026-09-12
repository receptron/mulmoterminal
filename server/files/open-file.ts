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
import { resolvePathRequest } from "./dirRequest.js";
import { spawnFirstOpener, type Spawner } from "./spawnOpener.js";

export type { Spawner };

interface OpenOptions {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  spawner?: Spawner;
}

export function mountOpenFileRoute(app: Express, { isAllowedOrigin, spawner = spawn }: OpenOptions): void {
  app.post("/api/files/open", async (req: Request, res) => {
    // Normalised BEFORE the stat, so the path that was validated is the path that is handed over:
    // `path.resolve` folds `..` lexically while the kernel folds it through symlinks, and doing it
    // afterwards validates one pathname and acts on another (the P2 this pair paid for on #2039).
    const target = resolvePathRequest(req, res, isAllowedOrigin, { normalise: path.resolve });
    if (!target) return;
    // A directory has its own route, and handing one to `open` would launch a file manager from
    // the endpoint whose whole job is to launch an APPLICATION.
    if (target.isDir) return res.status(400).json({ error: "not a file" });
    // The bare path: this route OPENS the file. `reveal` is the one that selects it, and the two
    // must not drift into each other — which is why the argv is the only thing they differ by.
    const failed = await spawnFirstOpener(target.path, (_cmd, asked) => [asked], spawner);
    if (failed === null) return res.json({ ok: true });
    res.status(500).json({ error: `could not open ${target.path} [${failed}]` });
  });
}
