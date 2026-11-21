// The retrospective's arithmetic (#3335): conversations and what they spent in, totals by week, project,
// agent and model out. Pure: the clock and the week's first day are handed in. Money and tokens count in
// the week they were spent (#3395); a conversation and its PRs, in the week it started.
import { RETROSPECTIVE_WEEKS, type LibraryRetrospective, type RetrospectiveTokens, type RetrospectiveTotals } from "../../../common/libraryRetrospective.js";

export interface RetrospectiveRow {
  cwd: string | null;
  agent: string;
  startedAt: number | null;
  prs: number;
}

/** One slot of what a conversation spent on one model (spend-fold.ts), with where the conversation ran. */
export interface RetrospectiveSpend extends RetrospectiveTokens {
  cwd: string | null;
  agent: string;
  at_ms: number;
  model: string;
  costUsd: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Local midnight of the Monday on or before `at_ms`. */
export function weekStart(at_ms: number): number {
  const day = new Date(at_ms);
  day.setHours(0, 0, 0, 0);
  const sinceMonday = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - sinceMonday);
  return day.getTime();
}

const zero = (): RetrospectiveTotals => ({ costUsd: 0, conversations: 0, prs: 0 });
const noTokens = (): RetrospectiveTokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function addTokens(into: RetrospectiveTokens, spend: RetrospectiveTokens): void {
  into.input += spend.input;
  into.output += spend.output;
  into.cacheRead += spend.cacheRead;
  into.cacheWrite += spend.cacheWrite;
}

/** The weeks shown, oldest first: the current one and the ones before it. A week is counted by the Monday
 *  it starts on, so a daylight-saving change inside it moves nothing. */
function weekStarts(now_ms: number): number[] {
  const current = weekStart(now_ms);
  return Array.from({ length: RETROSPECTIVE_WEEKS }, (_, back) => weekStart(current - (RETROSPECTIVE_WEEKS - 1 - back) * WEEK_MS + DAY_MS));
}

const byCost = <T extends { costUsd: number; conversations?: number }>(a: T, b: T): number =>
  b.costUsd - a.costUsd || (b.conversations ?? 0) - (a.conversations ?? 0);

/** The totals kept under each key of one grouping, made on first use. */
function grouping<T>(make: () => T): { at: (key: string) => T; entries: () => [string, T][] } {
  const held = new Map<string, T>();
  return {
    at: (key) => {
      const known = held.get(key);
      if (known !== undefined) return known;
      const made = make();
      held.set(key, made);
      return made;
    },
    entries: () => [...held],
  };
}

/** The totals of the weeks shown: conversations that started in them, and what was spent in them. */
export function retrospective(rows: readonly RetrospectiveRow[], spends: readonly RetrospectiveSpend[], now_ms: number): LibraryRetrospective {
  const starts = weekStarts(now_ms);
  const weeks = new Map(starts.map((start) => [start, zero()]));
  const projects = grouping(zero);
  const agents = grouping(zero);
  const models = grouping(() => ({ costUsd: 0, tokens: noTokens() }));
  const total = { ...zero(), tokens: noTokens() };
  rows.forEach((row) => {
    const week = row.startedAt === null ? undefined : weeks.get(weekStart(row.startedAt));
    if (week === undefined) return;
    [week, total, projects.at(row.cwd ?? ""), agents.at(row.agent)].forEach((into) => {
      into.conversations += 1;
      into.prs += row.prs;
    });
  });
  spends.forEach((spend) => {
    const week = weeks.get(weekStart(spend.at_ms));
    if (week === undefined) return;
    [week, total, projects.at(spend.cwd ?? ""), agents.at(spend.agent)].forEach((into) => {
      into.costUsd += spend.costUsd;
    });
    const model = models.at(spend.model);
    model.costUsd += spend.costUsd;
    addTokens(model.tokens, spend);
    addTokens(total.tokens, spend);
  });
  return {
    weeks: starts.map((start_ms) => ({ start_ms, ...(weeks.get(start_ms) ?? zero()) })),
    projects: projects
      .entries()
      .map(([cwd, totals]) => ({ cwd, ...totals }))
      .sort(byCost),
    agents: agents
      .entries()
      .map(([agent, totals]) => ({ agent, ...totals }))
      .sort(byCost),
    models: models
      .entries()
      .map(([model, totals]) => ({ model, ...totals }))
      .sort(byCost),
    total,
  };
}
