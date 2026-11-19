// Which conversation made a pull request (#3330), from the PR links each conversation recorded. Pure.
import type { LibraryConversation, LibraryPrLink } from "../../../common/library";

const sameRepository = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** For each PR number in `repository`, the conversation that linked it first — given conversations
 *  the earliest begun first, as the server answers them. */
export function creatorsByPr(conversations: readonly LibraryConversation[], repository: string): Map<number, LibraryConversation> {
  const creators = new Map<number, LibraryConversation>();
  conversations.forEach((conversation) =>
    conversation.prs
      .filter((pr) => sameRepository(pr.repository, repository) && !creators.has(pr.number))
      .forEach((pr) => creators.set(pr.number, conversation)),
  );
  return creators;
}

/** A PR's own page, or null for a link that is not one: the URL was written into a transcript, and a
 *  page should only ever link out to GitHub from it. */
export const prPage = (pr: LibraryPrLink): string | null => (/^https:\/\/github\.com\/[^\s]+$/.test(pr.url) ? pr.url : null);
