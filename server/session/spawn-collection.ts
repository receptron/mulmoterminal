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
    const { title, icon } = toSummary(loaded);
    return { slug, title, icon };
  } catch (err) {
    console.error(`[spawn-collection] could not resolve '${slug}': ${messageOf(err)}`);
    return null;
  }
}
