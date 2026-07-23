import { resolveLinkTarget, wikiSlugify, isSafeWikiSlug, type WikiGraph } from "@mulmoclaude/core/wiki";

type WikiClickTargetDeps = {
  graph: WikiGraph | null;
  fileSlugs: ReadonlySet<string>;
  slugByTitle: ReadonlyMap<string, string>;
};

// Resolve a clicked `[[wiki link]]`'s raw target to a navigable slug. The graph resolver
// wins first (it can map a title to a slug that differs from the plain slugify form); only
// when it finds nothing do we fall back to slugifying the target ourselves. The fallback is
// gated by the router's own safety check so a non-ASCII target that slugifies to "" — or any
// unsafe value — yields null instead of a bogus route, leaving the caller to skip navigation.
export const resolveWikiClickTarget = (rawTarget: string, deps: WikiClickTargetDeps): string | null => {
  const graphSlug = deps.graph ? resolveLinkTarget(rawTarget, deps.fileSlugs, deps.slugByTitle) : null;
  if (graphSlug) return graphSlug;
  const fallback = wikiSlugify(rawTarget);
  return isSafeWikiSlug(fallback) ? fallback : null;
};
