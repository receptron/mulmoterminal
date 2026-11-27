// Where inside an overlay the person last was, so opening it again without a target returns there:
// the screen is kept while closed, and opening it onto its empty start would throw that away.
import { router } from "../router";

export function lastPlaceIn(routeNames: ReadonlySet<string>): () => string | null {
  let last: string | null = null;
  router.afterEach((to) => {
    if (routeNames.has(String(to.name))) last = to.fullPath;
  });
  return () => last;
}
