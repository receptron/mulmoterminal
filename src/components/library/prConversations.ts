// Pull request links a conversation recorded (#3330). Pure.
import type { LibraryPrLink } from "../../../common/library";

/** A PR's own page, or null for a link that is not one: the URL was written into a transcript, and a
 *  page should only ever link out to GitHub from it. */
export const prPage = (pr: LibraryPrLink): string | null => (/^https:\/\/github\.com\/[^\s]+$/.test(pr.url) ? pr.url : null);
