// Where inside an overlay the person last was, so opening it again without a target returns there:
// the screen is kept while closed, and opening it onto its empty start would throw that away.
import { router } from "../router";
import { overlayOriginState } from "./overlayOrigin";

export function lastPlaceIn(routeNames: ReadonlySet<string>): () => string | null {
  let last: string | null = null;
  router.afterEach((to) => {
    if (routeNames.has(String(to.name))) last = to.fullPath;
  });
  return () => last;
}

/** Goes back to a place recorded as a full path, remembering where the screen was opened from. */
export async function returnToPlace(fullPath: string): Promise<void> {
  // A `path` holding a query would be pushed without it, and the Library keeps its conversation there.
  const { path, query, hash } = router.resolve(fullPath);
  await router.push({ path, query, hash, state: overlayOriginState() });
}
