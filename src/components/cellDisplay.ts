// Small display rules from the grid cell's header, gathered where they can be read and
// tested. None is complicated; each is the kind of thing that goes subtly wrong and is then
// believed, because the number on screen looks like a number.

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

// How long ago a session was last active, for the resume list. The user picks which session
// to resume by this, so an off-by-one in the units sends them into the wrong conversation.
// `now` is a parameter rather than a Date.now() call so the boundaries can be asserted.
export function relativeTime(ms: number, now: number): string {
  const minutes = Math.floor((now - ms) / MINUTE_MS);
  if (minutes < 1) return "just now";
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m ago`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours}h ago`;
  return `${Math.floor(hours / HOURS_PER_DAY)}d ago`;
}

// Same rule from an ISO timestamp (PR/issue `updatedAt`). An unparseable string yields ""
// rather than "NaNm ago", so a malformed date silently drops the meta rather than showing junk.
export function relativeTimeFromIso(iso: string, now: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return relativeTime(ms, now);
}

// The notification bell's compact variant of relativeTime: same floor and same "under a
// minute is just now" boundary, differing only in dropping the "ago" suffix ("5m" not
// "5m ago"). Sharing the boundary keeps the bell and the grid agreeing on when something
// stops being "just now".
export function compactRelativeTime(ms: number, now: number): string {
  const minutes = Math.floor((now - ms) / MINUTE_MS);
  if (minutes < 1) return "just now";
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours}h`;
  return `${Math.floor(hours / HOURS_PER_DAY)}d`;
}

export function compactRelativeTimeFromIso(iso: string, now: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return compactRelativeTime(ms, now);
}

const MILLION = 1_000_000;
const THOUSAND = 1_000;
// Below this a thousands value keeps a decimal: 1.5k reads usefully, 47.2k does not.
const DECIMAL_BELOW = 10_000;

export function formatTokens(count: number): string {
  if (count >= MILLION) return `${(count / MILLION).toFixed(1)}M`;
  if (count >= THOUSAND) return `${(count / THOUSAND).toFixed(count < DECIMAL_BELOW ? 1 : 0)}k`;
  return String(count);
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// What the ⇡ badge counts, and the part nothing asserted: cache reads and cache CREATION are
// input too. Drop either and a session that is mostly cache reports a fraction of what it
// actually sent — which is the number a user reaches for when deciding whether to /compact.
export function inputTokensShown(usage: SessionUsage | null | undefined): number {
  if (!usage) return 0;
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function outputTokensShown(usage: SessionUsage | null | undefined): number {
  return usage?.outputTokens ?? 0;
}

// Hidden until there is something to show — a badge reading "⇡0 ⇣0" is noise on every cell
// that has not had a turn yet.
export function usageBadge(usage: SessionUsage | null | undefined): { show: boolean; label: string } {
  const input = inputTokensShown(usage);
  const output = outputTokensShown(usage);
  return { show: input + output > 0, label: `⇡${formatTokens(input)} ⇣${formatTokens(output)}` };
}
