// Pull request links a conversation recorded (#3330). Pure.
import type { LibraryPrLink } from "../../../common/library";

/** A PR's own page, or null for a link that is not one: the URL was written into a transcript, and a
 *  page should only ever link out to GitHub from it. Parsed, not matched: `https://github.com@evil.example`
 *  reads as GitHub to a pattern and goes to evil.example. */
export function prPage(pr: LibraryPrLink): string | null {
  try {
    const url = new URL(pr.url);
    const isGithub = url.protocol === "https:" && url.hostname === "github.com" && url.port === "" && url.username === "" && url.password === "";
    return isGithub && url.href === pr.url ? pr.url : null;
  } catch {
    return null;
  }
}
