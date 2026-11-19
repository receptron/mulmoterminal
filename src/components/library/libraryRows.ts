// How the Library lists conversations (#3329): the groups, the grey line under a title, and when.
// Pure — `now` and the locale are handed in, so every boundary can be asserted.
import type { LibraryConversation } from "../../../common/library";

export const LIBRARY_GROUPS = ["today", "week", "older"] as const;
export type LibraryGroup = (typeof LIBRARY_GROUPS)[number];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_DAYS = 7;

const startOfDay = (ms: number): number => {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/** Today is the local calendar day; the week is the six days before it. No time at all is "older". */
export function groupOf(endedAt: number | null, now: number): LibraryGroup {
  if (endedAt === null) return "older";
  const today = startOfDay(now);
  if (endedAt >= today) return "today";
  return endedAt >= today - (WEEK_DAYS - 1) * DAY_MS ? "week" : "older";
}

export interface LibraryGroupRows {
  group: LibraryGroup;
  conversations: LibraryConversation[];
}

/** The rows in their groups, in the order given (the server's, newest first); empty groups left out. */
export function groupConversations(conversations: readonly LibraryConversation[], now: number): LibraryGroupRows[] {
  return LIBRARY_GROUPS.map((group) => ({ group, conversations: conversations.filter((c) => groupOf(c.endedAt, now) === group) })).filter(
    (rows) => rows.conversations.length > 0,
  );
}

/** The last segment of a path, which is what a project is called; either separator. */
export function projectName(cwd: string | null): string | null {
  if (cwd === null) return null;
  const parts = cwd.split(/[\\/]/).filter((part) => part !== "");
  return parts.at(-1) ?? null;
}

/** How long ago, in the reader's language: minutes and hours today, days this week, a date after. */
export function whenLabel(endedAt: number | null, now: number, locale: string): string {
  if (endedAt === null) return "";
  const ago = Math.max(now - endedAt, 0);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (ago < MINUTE_MS) return relative.format(0, "second"); // "now", not "this minute"
  if (ago < HOUR_MS) return relative.format(-Math.floor(ago / MINUTE_MS), "minute");
  if (ago < DAY_MS) return relative.format(-Math.floor(ago / HOUR_MS), "hour");
  if (ago < WEEK_DAYS * DAY_MS) return relative.format(-Math.floor(ago / DAY_MS), "day");
  const sameYear = new Date(endedAt).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }).format(endedAt);
}

/** PRs named on one line before the rest are counted instead: a long conversation can link dozens. */
export const SHOWN_PRS = 3;

/** The newest PRs by number, then how many more — `#3338 #3337 #3336 +40`. */
export function prsLabel(prs: LibraryConversation["prs"]): string {
  const newest = prs
    .slice(-SHOWN_PRS)
    .reverse()
    .map((pr) => `#${String(pr.number)}`);
  const rest = prs.length - newest.length;
  return rest > 0 ? [...newest, `+${String(rest)}`].join(" ") : newest.join(" ");
}

/** The grey line under a row's title: project · branch · the PRs · when. Absent parts are left out. */
export function metaParts(conversation: LibraryConversation, now: number, locale: string): string[] {
  const prs = prsLabel(conversation.prs);
  return [projectName(conversation.cwd), conversation.gitBranch, prs, whenLabel(conversation.endedAt, now, locale)].filter(
    (part): part is string => part !== null && part !== "",
  );
}

/** Cost as the reader's currency format; null when the agent recorded none. */
export function costLabel(costUsd: number | null, locale: string): string | null {
  if (costUsd === null) return null;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(costUsd);
}
