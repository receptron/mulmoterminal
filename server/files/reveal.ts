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
import { resolvePathRequest } from "./dirRequest.js";
import { revealArgv } from "./reveal-argv.js";
import { spawnFirstOpener, type Spawner } from "./spawnOpener.js";

export type { Spawner };

interface RevealOptions {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  spawner?: Spawner;
}

export function mountRevealRoute(app: Express, { isAllowedOrigin, spawner = spawn }: RevealOptions): void {
  app.post("/api/files/reveal", async (req: Request, res) => {
    // `path.resolve` BEFORE the stat, not after. The browser joins a row onto the tree's root with
    // `/` whatever the root looks like, so a Windows path arrives as `C:\proj/reports/a.pdf` and
    // `explorer /select,` is particular about separators — but resolving AFTERWARDS would validate
    // one pathname and hand the OS another, because `path.resolve` folds `..` lexically while the
    // kernel folds it through symlinks (Codex P2: `<root>/link/../adir` stats as a directory while
    // its resolved spelling stats as a file). One string, validated and spawned.
    const target = resolvePathRequest(req, res, isAllowedOrigin, { normalise: path.resolve });
    if (!target) return;
    const failed = await spawnFirstOpener(target.path, (cmd, asked) => revealArgv(cmd, asked, target.isDir), spawner);
    if (failed === null) return res.json({ ok: true });
    res.status(500).json({ error: `could not show ${target.path} [${failed}]` });
  });
}
