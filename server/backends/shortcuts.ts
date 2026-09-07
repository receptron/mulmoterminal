// Shared launcher shortcuts (pinned collections / feeds) over
// `<workspace>/config/shortcuts.json`. The shape and its dedupe key live in
// common/shortcuts.ts, which also records the MulmoClaude cross-app contract; this
// module owns the reading, validating and atomic writing of the file.
//
//   GET /api/shortcuts  → { shortcuts }
//   PUT /api/shortcuts  → replace the whole array → { shortcuts }
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { sameShortcut, SHORTCUT_KINDS, type Shortcut, type ShortcutKind } from "../../common/shortcuts.js";
import { isRecord } from "../../common/isRecord.js";
import { hasErrnoCode } from "../errors.js";

/** On-disk shape — object wrapper (not a bare array) so the schema can grow
 *  without a migration. THIS is the cross-app contract. */
interface ShortcutsFile {
  shortcuts: Shortcut[];
}

const KINDS = new Set<string>(SHORTCUT_KINDS);
// The Set answers membership; the predicate is what carries that answer into the type, so the
// entry below can be built without asserting the kind it just checked.
const isShortcutKind = (value: string): value is ShortcutKind => KINDS.has(value);

/** What ONE stored record has to be to survive: a known kind and a non-empty slug, with the label
 *  and glyph defaulted. Split out of the loop below so each concern reads on its own — the same
 *  split, and the same name, MulmoClaude gives it in `shortcuts-io.ts`.
 *
 *  It REBUILDS the record, which is why every field the file may carry has to be listed here: one
 *  left out is not passed through, it is deleted — from the copy served to the browser AND from the
 *  file the next write puts back. `color` was missing for exactly that reason (#1993), so every
 *  pin/unpin in this app wiped the colours MulmoClaude had stored in the shared file. */
function toShortcut(raw: unknown): Shortcut | null {
  if (!isRecord(raw)) return null;
  const { kind, slug, title, icon, color } = raw;
  if (typeof kind !== "string" || !isShortcutKind(kind)) return null;
  if (typeof slug !== "string" || slug.length === 0) return null;
  return {
    kind,
    slug,
    title: typeof title === "string" ? title : slug,
    icon: typeof icon === "string" && icon.length > 0 ? icon : "bookmark",
    // Added conditionally, the way MulmoClaude adds it: an explicit `color: undefined` serialises
    // as `null`, which is a value the other app would then have to know to ignore.
    ...(typeof color === "string" && color.length > 0 ? { color } : {}),
  };
}

/** Coerce arbitrary JSON into a clean `Shortcut[]`: drop malformed entries and dedupe on
 *  (kind, slug), keeping the first. Pure — exported for tests. */
export function normalizeShortcuts(input: unknown): Shortcut[] {
  if (!Array.isArray(input)) return [];
  const out: Shortcut[] = [];
  input.forEach((raw) => {
    const entry = toShortcut(raw);
    if (!entry || out.some((existing) => sameShortcut(existing, entry))) return;
    out.push(entry);
  });
  return out;
}

function shortcutsFilePath(workspace: string): string {
  return path.join(workspace, "config", "shortcuts.json");
}

/** Read the pinned shortcuts. Missing / unreadable / malformed → `[]`.
 *  Exported so the remote-host handler can list shortcuts in-process. */
export async function readShortcuts(workspace: string): Promise<Shortcut[]> {
  let text: string;
  try {
    text = await fs.readFile(shortcutsFilePath(workspace), "utf8");
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return normalizeShortcuts(isRecord(parsed) ? parsed.shortcuts : undefined);
  } catch {
    return [];
  }
}

// POSIX rename atomically replaces the destination; Windows MoveFileEx does too, but
// while a concurrent writer's rename holds the target it briefly denies a second one
// with EPERM/EACCES/EBUSY. Retry those a few times so concurrent replace-all PUTs
// (two tabs) all succeed instead of one 500ing. Other errors propagate at once.
const RENAME_RETRIES = 10;
const RENAME_RETRY_DELAY_MS = 20;
const RENAME_LOCK_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
async function renameReplacing(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      const code = (hasErrnoCode(err) ? err.code : undefined) ?? "";
      if (attempt >= RENAME_RETRIES || !RENAME_LOCK_CODES.has(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
    }
  }
}

/** Replace the full list. Normalises (validate + dedupe) before an atomic write
 *  (temp file + rename) so the on-disk file is always clean and never half-written.
 *  Returns the canonical list. */
async function writeShortcuts(workspace: string, input: unknown): Promise<Shortcut[]> {
  const clean = normalizeShortcuts(input);
  const payload: ShortcutsFile = { shortcuts: clean };
  const file = shortcutsFilePath(workspace);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Unique temp name per write so concurrent PUTs (two tabs / clients) can't clobber
  // each other's temp file and ENOENT on rename. Each writes its own temp then
  // atomically renames onto `file` — last writer wins, which is fine for a
  // replace-all endpoint (the client also serializes its own PUTs).
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await renameReplacing(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }); // don't leave a stray temp on failure
    throw err;
  }
  return clean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function mountShortcutsRoutes(app: Express, deps: { workspace: string }): void {
  app.get("/api/shortcuts", async (_req: Request, res: Response) => {
    try {
      res.json({ shortcuts: await readShortcuts(deps.workspace) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // The client owns ordering / add / remove and sends the whole array; the server
  // normalises (validate kind, non-empty slug, dedupe) before persisting. A single
  // replace endpoint avoids add/remove route sprawl.
  app.put("/api/shortcuts", async (req: Request, res: Response) => {
    const incoming: Record<string, unknown> = isRecord(req.body) ? req.body : {};
    if (!Array.isArray(incoming.shortcuts)) {
      res.status(400).json({ error: "Request body must be { shortcuts: Shortcut[] }" });
      return;
    }
    try {
      res.json({ shortcuts: await writeShortcuts(deps.workspace, incoming.shortcuts) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
