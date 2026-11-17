// Downscaled `data:` URL thumbnails for mobile custom views. A phone can't reach
// the host, so an `image`-type field's workspace path is unrenderable there; a
// view that lists the field in `imageFields` gets it inlined as a small JPEG data
// URL the host produces here (used by server/backends/collections/remoteView.ts for both the
// remote-host channel and the desktop phone-frame preview).
//
// Ported from MulmoClaude's server/utils/files/thumbnail-store.ts. Adaptations:
// the workspace root comes from the configured collection host
// (getWorkspaceRoot) rather than a MulmoClaude paths module, and containment
// uses MulmoTerminal's containedPath. Results are cached by (path, mtime,
// maxEdge) so repeated pages / "load more" scrolls never re-decode the source.
import { stat } from "node:fs/promises";
import { realpathSync } from "node:fs";

import { getWorkspaceRoot } from "@mulmoclaude/core/collection/server";
import type { ProjectScope } from "../../infra/fs/project-root.js";

import { containedPath, realContainedWithin } from "../../files/pathContainment.js";
import { readVerifiedAsync } from "../../files/verifiedRead.js";

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

// The cache key carries the ROOT, not just the workspace-relative path. Two projects both
// holding `data/pic.png` are the normal case, and the cached value is the image BYTES — so a
// path-only key would serve one project's picture inside another's view.
const cacheKey = (root: string, relPath: string): string => `${root}\u0000${relPath}`;

function cacheGet(key: string, mtimeMs: number, maxEdge: number): string | null {
  const entry = cache.get(key);
  if (!entry || entry.mtimeMs !== mtimeMs || entry.maxEdge !== maxEdge) return null;
  cache.delete(key);
  cache.set(key, entry);
  return entry.dataUrl;
}

function cacheSet(key: string, entry: CacheEntry): void {
  cache.set(key, entry);
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
export function createThumbnailResolver(resize: ResizeToJpeg = sharpResize, rootOf: () => string = getWorkspaceRoot) {
  return async function resolveThumbnail(relPath: string, maxEdge: number): Promise<string | null> {
    if (typeof relPath !== "string" || relPath.length === 0) return null;
    let root: string;
    try {
      // .native, for the Windows 8.3 reason in files/pathContainment.ts. fs/promises has no
      // native variant, so this is the sync call.
      root = realpathSync.native(rootOf());
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
    const key = cacheKey(root, relPath);
    const cached = cacheGet(key, info.mtimeMs, maxEdge);
    if (cached) return cached;
    try {
      // Read only once the open file is still the one the check names: a folder swapped for a link
      // out after the check would otherwise put an outside image on the phone (#3306).
      const bytes = await readVerifiedAsync(real, () => realContainedWithin(root, abs));
      if (bytes === null) return null;
      const out = await resize(bytes, maxEdge);
      const dataUrl = `data:image/jpeg;base64,${out.toString("base64")}`;
      cacheSet(key, { mtimeMs: info.mtimeMs, maxEdge, dataUrl });
      return dataUrl;
    } catch (err) {
      console.warn("[thumbnail] resolve failed", relPath, String(err));
      return null;
    }
  };
}

/** A resolver bound to one project root. There is deliberately no ambient
 *  `resolveThumbnail`: the containment check below IS the security boundary, so the root it
 *  checks against must be the root the request resolved, never whatever the engine happens to
 *  have bound. Under explicit-root mode an ambient one would throw anyway. */
export const thumbnailResolverFor = (scope: ProjectScope) => createThumbnailResolver(sharpResize, () => scope.workspaceRoot);
