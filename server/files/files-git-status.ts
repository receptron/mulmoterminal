// GET /api/files/browse/git-status?cwd= — which paths under the Files pane's root git sees as
// changed (#2496). Names and states only: nothing the directory listing does not already reveal
// under the same base rule, so it takes the browse routes' base.
import path from "node:path";
import os from "node:os";
import type { Express } from "express";
import { MAX_GIT_STATUS_ENTRIES, type FileGitStatus } from "../../common/fileGitStatus.js";
import { git } from "../git/worktrees.js";
import { parseStatusEntries } from "../git/statusEntries.js";
import { coalesceByKey } from "../infra/async/coalesce-by-key.js";
import { resolveContained } from "./pathContainment.js";

const NOT_A_REPO: FileGitStatus = { repo: false, files: {} };

// Shorter than the runner's default: a read nobody is waiting for any more — the pane polls, and the
// browser gives up well before this — should not hold a process for minutes. Not cancelled when one
// request goes away, because a coalesced read is shared by every pane waiting on the same root.
const STATUS_TIMEOUT_MS = 15_000;

// The output an answer of MAX_GIT_STATUS_ENTRIES could reasonably take (a status and a path each,
// with room for long paths). Past it the child is stopped: the answer would be cut short anyway.
const MAX_STATUS_BYTES = MAX_GIT_STATUS_ENTRIES * 512;
const TRUNCATED: FileGitStatus = { repo: true, files: {}, truncated: true };

// git escapes a non-ASCII path as C-quoted octal unless told not to; the tree names files as they are.
const QUOTE_PATH_OFF = ["-c", "core.quotePath=false"];

async function readTreeGitStatus(root: string, maxEntries: number): Promise<FileGitStatus> {
  const prefix = await git(["rev-parse", "--show-prefix"], root, STATUS_TIMEOUT_MS);
  if (!prefix.ok) return NOT_A_REPO;
  // `-- .` limits the walk to the pane's root; the paths still come back relative to the repository.
  const status = await git([...QUOTE_PATH_OFF, "status", "--porcelain=v1", "-z", "--", "."], root, STATUS_TIMEOUT_MS, undefined, MAX_STATUS_BYTES);
  if (status.overflow) return TRUNCATED;
  if (!status.ok) return { repo: true, files: {} };
  // Only the line ending comes off: a folder name may begin with a space, and git keeps it.
  const entries = parseStatusEntries(status.stdout, prefix.stdout.replace(/\r?\n$/, ""), maxEntries);
  return entries.truncated ? TRUNCATED : { repo: true, files: entries.files };
}

// One read per root at a time: every pane on one checkout polls this, and a `git status` scans the
// whole work tree — overlapping ones only make each other slower (the header's reason, #2164).
const coalesce = coalesceByKey<string, FileGitStatus>();

/** The file as HEAD has it, or null when there is no such version — outside git, untracked, added
 *  since, or larger than the editor opens. Run from the file's own folder with a `./` path, which git
 *  reads relative to that folder, so the repository's root never has to be worked out here. */
async function readHeadText(abs: string, maxBytes: number): Promise<string | null> {
  const shown = await git(["show", `HEAD:./${path.basename(abs)}`], path.dirname(abs), STATUS_TIMEOUT_MS, undefined, maxBytes);
  return shown.ok ? shown.stdout : null;
}

const ESCAPES = { error: "path escapes the project root" };

export function mountFilesGitStatusRoute(app: Express, deps: { base: (cwd: unknown) => string; maxHeadBytes: number; maxStatusEntries?: number }): void {
  const maxEntries = deps.maxStatusEntries ?? MAX_GIT_STATUS_ENTRIES;
  // GET /api/files/browse/head?cwd=&path= — what the editor marks changes against (#2497). The
  // same containment as the text route: the path may not leave the base, lexically or by a link.
  //
  // git runs in the file's folder and opens it itself, so the check is asked again once git is done:
  // a HEAD read through a folder swapped for a link out — another repository's file — still in place
  // is refused rather than answered (#3306). A swap undone before then is not seen.
  app.get("/api/files/browse/head", async (req, res) => {
    const contained = () => resolveContained(deps.base(req.query.cwd), typeof req.query.path === "string" ? req.query.path : "", os.homedir());
    const abs = contained();
    if (!abs) return res.status(403).json(ESCAPES);
    const text = await readHeadText(abs, deps.maxHeadBytes);
    if (contained() === null) return res.status(403).json(ESCAPES);
    res.json({ text });
  });

  app.get("/api/files/browse/git-status", async (req, res) => {
    const root = deps.base(req.query.cwd);
    res.json(await coalesce(root, () => readTreeGitStatus(root, maxEntries)));
  });
}
