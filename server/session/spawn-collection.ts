// The collection a spawned chat was started from, resolved from the slug the caller named.
//
// Its own module rather than a branch inside the spawn route, because the RESOLUTION is the
// interesting part and it is what keeps the route's `collection` field from being display text the
// client chose. The caller sends a slug and nothing else; what reaches the store is what this
// server found on disk under that slug, in the project the session runs in. A slug naming no
// collection — a non-collection slash command such as `/deep-research`, a typo, a collection in
// another project — resolves to null and is simply not recorded.
import { loadCollection, toSummary } from "@mulmoclaude/core/collection/server";
import { isSafeSlug } from "@mulmoclaude/core/collection";
import { projectScopeForCwd } from "../infra/project-root.js";
import type { SessionCollection } from "../../common/sessionCollection.js";
import { messageOf } from "../errors.js";

/** A summary field as TEXT, whatever the package actually handed over.
 *
 *  This looks redundant against `CollectionSummary`, which declares `icon: string` and
 *  `title: string` — and that declaration overstates the runtime. Measured against the installed
 *  @mulmoclaude/core: a schema naming no icon yields `icon: undefined` (the key is absent, so
 *  `JSON.stringify` drops it), and a schema naming no title yields `title: undefined` the same way.
 *
 *  Left alone, an `undefined` here is not a cosmetic wobble: the log line loses the key,
 *  `sessionCollectionRecord` and `asSessionCollection` both require a string, and the whole record
 *  is discarded — so a collection with no icon in its schema loses its TITLE and its mark as well,
 *  in this process and after a restart. Normalizing at this boundary is what makes
 *  `SessionCollection`'s own contract ("may be `""` when the schema names none") true.
 *
 *  Typed `unknown` on purpose: a parameter typed `string` would let the compiler fold the check
 *  away as unreachable, which is exactly the reasoning that let this through the first time. */
const asText = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * What to record for a chat started from `slug` in `cwd`, or null when there is nothing to record.
 *
 * Never throws: this decorates a cell, and a discovery that failed must not take a spawn with it.
 */
export async function resolveSpawnCollection(slug: string | null, cwd: string): Promise<SessionCollection | null> {
  if (!slug || !isSafeSlug(slug)) return null;
  try {
    const loaded = await loadCollection(slug, projectScopeForCwd(cwd));
    if (!loaded) return null;
    const summary = toSummary(loaded);
    // The SLUG when there is no title: it is the only thing that always names the collection, and
    // it is what the user typed to reach it. "Started from notes" beats no mark at all.
    return { slug, title: asText(summary.title) || slug, icon: asText(summary.icon) };
  } catch (err) {
    console.error(`[spawn-collection] could not resolve '${slug}': ${messageOf(err)}`);
    return null;
  }
}
