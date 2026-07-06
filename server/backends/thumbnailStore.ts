// Downscaled `data:` URL thumbnails for mobile custom views. A phone can't reach
// the host, so an `image`-type field's workspace path is unrenderable there; a
// view that lists the field in `imageFields` gets it inlined as a small JPEG data
// URL the host produces here (used by server/backends/remoteView.ts for both the
// remote-host channel and the desktop phone-frame preview).
//
// Ported from MulmoClaude's server/utils/files/thumbnail-store.ts. Adaptations:
// the workspace root comes from the configured collection host
// (getWorkspaceRoot) rather than a MulmoClaude paths module, and containment
// uses MulmoTerminal's containedPath. Results are cached by (path, mtime,
// maxEdge) so repeated pages / "load more" scrolls never re-decode the source.
import { readFile, realpath, stat } from "node:fs/promises";

import { getWorkspaceRoot } from "@mulmoclaude/core/collection/server";

import { containedPath, realContainedWithin } from "../files-browse.js";

/** Decode → downscale to fit `maxEdge` (never enlarge) → re-encode JPEG.
 *  Injected so tests exercise the resolver without the native `sharp` binary. */
export type ResizeToJpeg = (input: Buffer, maxEdge: number) => Promise<Buffer>;

// JPEG quality for inlined thumbnails — a size/fidelity knob; 72 keeps a 512px
// thumbnail in the low tens of KB, well within the page budget.
const THUMBNAIL_JPEG_QUALITY = 72;

const sharpResize: ResizeToJpeg = async (input, maxEdge) => {
  // Dynamic import: only the default resolver pulls the native binary, so tests
  // (which inject their own resize) and code paths that never make a thumbnail
  // don't load it.
  const sharp = (await import("sharp")).default;
  // `.rotate()` bakes in EXIF orientation so portrait phone photos aren't sideways.
  return sharp(input).rotate().resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: THUMBNAIL_JPEG_QUALITY }).toBuffer();
};

interface CacheEntry {
  mtimeMs: number;
  maxEdge: number;
  dataUrl: string;
}

// In-memory, per host process. Bounded LRU (Map keeps insertion order; a get
// re-inserts to mark recency, a set past the cap evicts the oldest).
const MAX_CACHE_ENTRIES = 256;
const cache = new Map<string, CacheEntry>();

function cacheGet(relPath: string, mtimeMs: number, maxEdge: number): string | null {
  const entry = cache.get(relPath);
  if (!entry || entry.mtimeMs !== mtimeMs || entry.maxEdge !== maxEdge) return null;
  cache.delete(relPath);
  cache.set(relPath, entry);
  return entry.dataUrl;
}

function cacheSet(relPath: string, entry: CacheEntry): void {
  cache.set(relPath, entry);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Test-only: drop the cache so a spy on the resize fn sees a fresh encode. */
export function clearThumbnailCache(): void {
  cache.clear();
}

/** Resolve a workspace-relative image path to a downscaled JPEG `data:` URL, or
 *  `null` when the path escapes the workspace, is missing, or can't be decoded —
 *  the caller then leaves the field as its original path (a placeholder in the
 *  view). `maxEdge` should already be clamped by the caller (`clampImageMaxEdge`). */
export function createThumbnailResolver(resize: ResizeToJpeg = sharpResize) {
  return async function resolveThumbnail(relPath: string, maxEdge: number): Promise<string | null> {
    if (typeof relPath !== "string" || relPath.length === 0) return null;
    let root: string;
    try {
      root = await realpath(getWorkspaceRoot());
    } catch {
      return null;
    }
    const abs = containedPath(root, relPath);
    if (!abs) return null;
    // Lexical containment can be defeated by a symlink UNDER the workspace that
    // points outside it (e.g. data/link.jpg -> /etc/passwd); resolve the real
    // target and re-check before we stat/read it, so a symlinked path can't
    // exfiltrate an out-of-workspace file to the phone.
    const real = realContainedWithin(root, abs);
    if (!real) return null;
    const info = await stat(real).catch(() => null);
    if (!info?.isFile()) return null;
    const cached = cacheGet(relPath, info.mtimeMs, maxEdge);
    if (cached) return cached;
    try {
      const out = await resize(await readFile(real), maxEdge);
      const dataUrl = `data:image/jpeg;base64,${out.toString("base64")}`;
      cacheSet(relPath, { mtimeMs: info.mtimeMs, maxEdge, dataUrl });
      return dataUrl;
    } catch (err) {
      console.warn("[thumbnail] resolve failed", relPath, String(err));
      return null;
    }
  };
}

export const resolveThumbnail = createThumbnailResolver();
