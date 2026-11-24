// What the Library's routes ask of the index (#3328), as one async interface: the worker answers it
// in production, and the specs answer it in-thread over an in-memory database.
import { RETROSPECTIVE_WEEKS, type LibraryRetrospective } from "../../../common/libraryRetrospective.js";
import { retrospective, weekStart } from "./retrospective.js";
import { splitSpend } from "./spend-split.js";
import type { LibraryConversation, LibraryConversationPage, LibraryIndexStatus, LibraryPrCreator, LibrarySearchHit } from "../../../common/library.js";
import {
  conversationDirectories,
  conversationOfRow,
  findConversation,
  listConversations,
  memorySource,
  prCreators,
  retrospectiveRows,
  retrospectiveSpendInputs,
  skillUsage,
  type ConversationFilter,
} from "./index-queries.js";
import type { LibraryIndex } from "./library-index.js";
import { inReadSnapshot, readLease } from "./index-store.js";
import { searchLibrary } from "./library-search.js";
import type { RepeatDetail, RepeatList } from "../../../common/libraryRepeats.js";
import type { SkillUsage } from "../../../common/skillUsage.js";
import { candidateOf, occurrencesOf, repeatCandidates, repeatGroups, REPEAT_LISTED_MAX, type RepeatPrompt, type RepeatRules } from "./repeat-detect.js";
import { automatedSessions, promptLogReader } from "./repeat-source.js";
import { isTemporaryCwd } from "./temporary-path.js";

export interface LibraryTranscript {
  path: string;
  cwd: string | null;
}

export interface LibraryService {
  status(): Promise<LibraryIndexStatus>;
  list(filter: ConversationFilter, offset: number, limit: number): Promise<LibraryConversationPage>;
  conversation(id: string, cwd?: string | null): Promise<LibraryConversation | null>;
  search(query: string, filter: ConversationFilter, limit: number): Promise<LibrarySearchHit[]>;
  /** Where a conversation's transcript is, and its directory, for what the index does not hold (its
   *  file history). */
  transcript(id: string, cwd: string | null): Promise<LibraryTranscript | null>;
  /** Every directory a conversation ran in, to name the memory folders by. */
  directories(): Promise<string[]>;
  /** The conversation that made each of these PRs in one repository, for those the index knows. */
  prCreators(repository: string, numbers: number[]): Promise<LibraryPrCreator[]>;
  /** The conversation that last wrote a memory file, by its path, when the index knows one. */
  memorySource(file: string): Promise<LibraryConversation | null>;
  /** Instructions typed again and again, the most typed first, and how many there are (#3334). */
  repeats(): Promise<RepeatList>;
  /** One of them with each time it was typed, or null when no candidate has that id now. */
  repeat(id: string): Promise<RepeatDetail | null>;
  /** The retrospective's totals for the weeks up to now. */
  retrospective(now_ms: number): Promise<LibraryRetrospective>;
  /** How often each skill ran in the conversations the Library lists (#3437). */
  skillUsage(): Promise<SkillUsage[]>;
}

/** Where the repeated-instruction check reads from, and its clock. */
export interface LibraryServiceOptions {
  historyFile?: string;
  temporaryRoots?: readonly string[];
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Every call also asks the index to catch up — in the background, so the answer is what the
 *  index holds now. */
export function createLocalLibraryService(index: LibraryIndex, options: LibraryServiceOptions = {}): LibraryService {
  const answer = <T>(read: () => T): Promise<T> => {
    index.refresh();
    return Promise.resolve(read());
  };
  const repeats = repeatReader(index, options);
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
    transcript: (id, cwd) =>
      answer(() => {
        const row = findConversation(index.db, id, cwd);
        if (row === null || typeof row.path !== "string") return null;
        return { path: row.path, cwd: typeof row.cwd === "string" ? row.cwd : null };
      }),
    directories: () => answer(() => conversationDirectories(index.db)),
    prCreators: (repository, numbers) =>
      answer(() => prCreators(index.db, repository, numbers).map((row) => ({ number: Number(row.pr_number), conversation: conversationOfRow(row) }))),
    retrospective: (now_ms) =>
      answer(() => {
        const since_ms = weekStart(now_ms) - (RETROSPECTIVE_WEEKS - 1) * WEEK_MS - DAY_MS;
        // One snapshot, so a scan committed between the two reads cannot count a conversation's spend without it.
        const read = inReadSnapshot(index.db, () => ({ rows: retrospectiveRows(index.db, since_ms), spend: retrospectiveSpendInputs(index.db, since_ms) }));
        return retrospective(read.rows, splitSpend(read.spend), now_ms);
      }),
    skillUsage: () => answer(() => skillUsage(index.db)),
    memorySource: (file) =>
      answer(() => {
        const row = memorySource(index.db, file);
        return row === null ? null : conversationOfRow(row);
      }),
    repeats: async () => {
      const { prompts, rules } = await repeats();
      const candidates = repeatCandidates(prompts, rules);
      return { candidates: candidates.slice(0, REPEAT_LISTED_MAX), total: candidates.length };
    },
    repeat: async (id) => {
      const { prompts, rules } = await repeats();
      const members = repeatGroups(prompts, rules).find((group) => candidateOf(group).id === id);
      return members === undefined ? null : { ...candidateOf(members, true), occurrences: occurrencesOf(members) };
    },
  };
}

/** The prompts and the rules the repeated-instruction check runs on, read when asked. */
function repeatReader(index: LibraryIndex, options: LibraryServiceOptions): () => Promise<{ prompts: RepeatPrompt[]; rules: RepeatRules }> {
  const readLog = options.historyFile === undefined ? async () => [] : promptLogReader(options.historyFile);
  const roots = options.temporaryRoots ?? [];
  return async () => {
    const automated = automatedSessions(index.db);
    const rules: RepeatRules = {
      now: (options.now ?? Date.now)(),
      isAutomatedSession: (sessionId) => automated.has(sessionId),
      isTemporaryProject: (project) => isTemporaryCwd(project, roots),
    };
    return { prompts: await readLog(), rules };
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
