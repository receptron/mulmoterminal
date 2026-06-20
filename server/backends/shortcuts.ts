// Shared launcher shortcuts (pinned collections / feeds) over
// `<workspace>/config/shortcuts.json`. MulmoClaude and MulmoTerminal SHARE this
// file — favoriting a collection in one app must show up in the other — so the
// on-disk format is the contract: an OBJECT WRAPPER `{ shortcuts: Shortcut[] }`
// (not a bare array), matching mulmoclaude/src/types/shortcuts.ts +
// server/utils/files/shortcuts-io.ts. Reimplemented verbatim here (the format is
// tiny and stable; shortcuts.spec.ts pins it) rather than sharing a package, so
// MulmoTerminal stays MulmoClaude-change-free.
//
//   GET /api/shortcuts  → { shortcuts }
//   PUT /api/shortcuts  → replace the whole array → { shortcuts }
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";

/** Which route family a shortcut points at. */
export const SHORTCUT_KINDS = ["collection", "feed"] as const;
export type ShortcutKind = (typeof SHORTCUT_KINDS)[number];

export interface Shortcut {
  kind: ShortcutKind;
  /** Target collection / feed slug. */
  slug: string;
  /** Cached display label (refreshed on reconcile). */
  title: string;
  /** Cached material-symbols glyph (refreshed on reconcile). */
  icon: string;
}

/** On-disk shape — object wrapper (not a bare array) so the schema can grow
 *  without a migration. THIS is the cross-app contract. */
interface ShortcutsFile {
  shortcuts: Shortcut[];
}

const KINDS = new Set<string>(SHORTCUT_KINDS);

/** True when two shortcuts target the same thing (the dedupe key). */
function sameShortcut(left: Pick<Shortcut, "kind" | "slug">, right: Pick<Shortcut, "kind" | "slug">): boolean {
  return left.kind === right.kind && left.slug === right.slug;
}

/** Coerce arbitrary JSON into a clean `Shortcut[]`: drop malformed entries (bad
 *  kind / empty slug / non-string fields), default title→slug and icon→"bookmark",
 *  and dedupe on (kind, slug) keeping the first. Pure — exported for tests. */
export function normalizeShortcuts(input: unknown): Shortcut[] {
  if (!Array.isArray(input)) return [];
  const out: Shortcut[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const candidate = raw as Record<string, unknown>;
    const { kind, slug, title, icon } = candidate;
    if (typeof kind !== "string" || !KINDS.has(kind)) continue;
    if (typeof slug !== "string" || slug.length === 0) continue;
    const entry: Shortcut = {
      kind: kind as ShortcutKind,
      slug,
      title: typeof title === "string" ? title : slug,
      icon: typeof icon === "string" && icon.length > 0 ? icon : "bookmark",
    };
    if (out.some((existing) => sameShortcut(existing, entry))) continue;
    out.push(entry);
  }
  return out;
}

function shortcutsFilePath(workspace: string): string {
  return path.join(workspace, "config", "shortcuts.json");
}

/** Read the pinned shortcuts. Missing / unreadable / malformed → `[]`. */
async function readShortcuts(workspace: string): Promise<Shortcut[]> {
  let text: string;
  try {
    text = await fs.readFile(shortcutsFilePath(workspace), "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as Partial<ShortcutsFile>;
    return normalizeShortcuts(parsed?.shortcuts);
  } catch {
    return [];
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
    await fs.rename(tmp, file);
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
    const incoming = (req.body ?? {}) as { shortcuts?: unknown };
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
