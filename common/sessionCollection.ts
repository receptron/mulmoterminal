// Which collection a session was started from (#2020), as BOTH sides agree it should look.
//
// The server records it at spawn and answers it on `/api/session/:id`; the grid draws it beside
// the cell's status dot. In common/ because that response shape is decided by both — the wire type
// mirrored into `server/` and `src/` is exactly the drift this directory exists to prevent.
//
// The DISPLAY fields travel with the slug rather than being looked up per render, and that is a
// snapshot on purpose: resolving `slug -> icon` needs a collection discovery pass, and
// `/api/session/:id` is polled once per cell. A collection that later changes its icon leaves the
// sessions started before it wearing the old glyph, which is the right answer for a historical
// record anyway.
import { isRecord } from "./isRecord";

export interface SessionCollection {
  slug: string;
  /** The schema's `icon`: a Material Symbols ligature name OR a single emoji. Never an image —
   *  that is the DIRECTORY's icon, a different question the cell answers separately. Draw it with
   *  `IconGlyph` from `@mulmoclaude/core/plugin-vue`, which is the one renderer that classifies
   *  the two and contains a value it cannot resolve. May be "" when the schema names none. */
  icon: string;
  /** What the collection calls itself, falling back to its slug. Never empty, and never absent:
   *  the producer normalizes it (`resolveSpawnCollection`) because the package's own summary type
   *  promises a string and hands back `undefined` for a schema that names no title. */
  title: string;
}

/** Read a session's collection off an untrusted body, or null when there is none / it is unusable.
 *
 *  A missing key and a malformed one answer the same way on purpose: the field is decoration, and
 *  the cell that renders nothing is correct in both cases. */
export function asSessionCollection(value: unknown): SessionCollection | null {
  if (!isRecord(value)) return null;
  const { slug, icon, title } = value;
  if (typeof slug !== "string" || slug.length === 0) return null;
  if (typeof icon !== "string" || typeof title !== "string") return null;
  return { slug, icon, title };
}
