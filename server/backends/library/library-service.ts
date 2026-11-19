// What the Library's routes ask of the index (#3328), as one async interface: the worker answers it
// in production, and the specs answer it in-thread over an in-memory database.
import type { LibraryConversation, LibraryConversationPage, LibraryIndexStatus, LibrarySearchHit } from "../../../common/library.js";
import { conversationOfRow, conversationsForRepository, findConversation, listConversations, type ConversationFilter } from "./index-queries.js";
import type { LibraryIndex } from "./library-index.js";
import { inReadSnapshot, readLease } from "./index-store.js";
import { searchLibrary } from "./library-search.js";

export interface LibraryService {
  status(): Promise<LibraryIndexStatus>;
  list(filter: ConversationFilter, offset: number, limit: number): Promise<LibraryConversationPage>;
  conversation(id: string, cwd?: string | null): Promise<LibraryConversation | null>;
  search(query: string, filter: ConversationFilter, limit: number): Promise<LibrarySearchHit[]>;
  /** The conversations that linked a PR in one repository, the earliest begun first. */
  forRepository(repository: string, limit: number): Promise<LibraryConversation[]>;
}

/** Every call also asks the index to catch up — in the background, so the answer is what the
 *  index holds now. */
export function createLocalLibraryService(index: LibraryIndex): LibraryService {
  const answer = <T>(read: () => T): Promise<T> => {
    index.refresh();
    return Promise.resolve(read());
  };
  return {
    status: () => answer(() => index.status()),
    list: (filter, offset, limit) =>
      answer(() =>
        // One read transaction, so the rows and the pass they are labelled with come from the same
        // snapshot: another server may commit a pass between two separate reads.
        inReadSnapshot(index.db, () => {
          const rows = listConversations(index.db, filter, offset, limit + 1);
          const indexFinishedAt = readLease(index.db).finishedMs;
          return { conversations: rows.slice(0, limit).map(conversationOfRow), hasMore: rows.length > limit, indexFinishedAt };
        }),
      ),
    conversation: (id, cwd = null) =>
      answer(() => {
        const row = findConversation(index.db, id, cwd);
        return row === null ? null : conversationOfRow(row);
      }),
    search: (query, filter, limit) => answer(() => searchLibrary(index.db, query, filter, limit)),
    forRepository: (repository, limit) => answer(() => conversationsForRepository(index.db, repository, limit).map(conversationOfRow)),
  };
}

/** A call on the service by name, answered as plain data — across the worker boundary in production,
 *  in-thread in the specs. */
export type LibraryCaller = (method: LibraryMethod, args: unknown[]) => Promise<unknown>;

/** One request to the worker, and its answer. */
export type LibraryMethod = keyof LibraryService;
export interface LibraryRequest {
  id: string;
  method: LibraryMethod;
  args: unknown[];
}
export interface LibraryReply {
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}
