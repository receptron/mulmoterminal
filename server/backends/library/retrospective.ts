// The retrospective's arithmetic (#3335): conversations in, totals by week, project and agent out. Pure:
// the clock and the week's first day are handed in. A conversation counts in the week it started.
import { RETROSPECTIVE_WEEKS, type LibraryRetrospective, type RetrospectiveTotals } from "../../../common/libraryRetrospective.js";

export interface RetrospectiveRow {
  cwd: string | null;
  agent: string;
  startedAt: number | null;
  costUsd: number | null;
  prs: number;
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

function add(into: RetrospectiveTotals, row: RetrospectiveRow): void {
  into.costUsd += row.costUsd ?? 0;
  into.conversations += 1;
  into.prs += row.prs;
}

/** The weeks shown, oldest first: the current one and the ones before it. A week is counted by the Monday
 *  it starts on, so a daylight-saving change inside it moves nothing. */
function weekStarts(now_ms: number): number[] {
  const current = weekStart(now_ms);
  return Array.from({ length: RETROSPECTIVE_WEEKS }, (_, back) => weekStart(current - (RETROSPECTIVE_WEEKS - 1 - back) * WEEK_MS + DAY_MS));
}

const byCost = <T extends RetrospectiveTotals>(a: T, b: T): number => b.costUsd - a.costUsd || b.conversations - a.conversations;

/** The totals of the conversations that started in the weeks shown. */
export function retrospective(rows: readonly RetrospectiveRow[], now_ms: number): LibraryRetrospective {
  const starts = weekStarts(now_ms);
  const weeks = new Map(starts.map((start) => [start, zero()]));
  const projects = new Map<string, RetrospectiveTotals>();
  const agents = new Map<string, RetrospectiveTotals>();
  const total = zero();
  rows.forEach((row) => {
    const week = row.startedAt === null ? undefined : weeks.get(weekStart(row.startedAt));
    if (week === undefined) return;
    add(week, row);
    add(total, row);
    const project = projects.get(row.cwd ?? "") ?? zero();
    add(project, row);
    projects.set(row.cwd ?? "", project);
    const agent = agents.get(row.agent) ?? zero();
    add(agent, row);
    agents.set(row.agent, agent);
  });
  return {
    weeks: starts.map((start_ms) => ({ start_ms, ...(weeks.get(start_ms) ?? zero()) })),
    projects: [...projects].map(([cwd, totals]) => ({ cwd, ...totals })).sort(byCost),
    agents: [...agents].map(([agent, totals]) => ({ agent, ...totals })).sort(byCost),
    total,
  };
}
