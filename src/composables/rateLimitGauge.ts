// What the header actually shows, decided away from the component so the rules are testable
// without mounting anything (#387).
//
// The one rule that outranks the rest: a window we do not have is NOT zero. The percentage is a
// budget already spent, so rendering 0% for missing data tells the reader they have everything
// left at the exact moment we cannot see how much they have — and upstream has dropped the field
// before (anthropics/claude-code#40094). Missing renders nothing at all.

import type { RateLimits, RateLimitWindow } from "../../common/rateLimits";
import { DEFAULT_LOGIN_SHORT_LABEL } from "../../common/tokenRotation";
import type { Translate } from "../i18n/translate";

export interface RateLimitSnapshot {
  claude: RateLimits | null;
  codex: RateLimits | null;
  /** Why the Claude half is missing, when it is (#1011). The server's own words, so the two
   *  cannot describe the same situation differently. */
  claudeProbe?: ClaudeProbeState | undefined;
  /** Which silence, when the state is `no-report` (#1293). */
  claudeStall?: ClaudeProbeStall | undefined;
  /** Each account's windows (#2215), in config order; absent or empty without accounts. */
  accounts?: AccountReading[] | undefined;
}

/** One account's windows as the gauge needs them. */
export interface AccountReading {
  id: string;
  label: string;
  agent: "claude" | "codex";
  limits: RateLimits | null;
  /** Why a claude account's figures are missing, as for the default login. */
  probe?: ClaudeProbeState | undefined;
  probeStall?: ClaudeProbeStall | undefined;
  /** The windows as last read when `limits` is gone stale; what says when a held-out login resets. */
  lastLimits?: RateLimits | null | undefined;
  /** Whose subscription a rotation token is (#2919), shown beside its label where there is room. */
  email?: string | undefined;
  /** A rotation token rather than an account (#2919). */
  rotation?: boolean | undefined;
}

export type ClaudeProbeState = "ok" | "no-claude" | "no-windows" | "no-report";

/** The one silence the probe's screen can name. Everything else is `unknown`, which reads as the
 *  general no-report line — a wrong reason costs more than a vague one. */
export type ClaudeProbeStall = "trust-prompt" | "usage-limit" | "unknown";

/** The one silence that is a reading in itself: the subscription is OUT, not unmeasured (#2995). */
export const atUsageLimit = (probe: ClaudeProbeState | undefined, stall: ClaudeProbeStall | undefined): boolean =>
  probe === "no-report" && stall === "usage-limit";

// What to put where the Claude figures would be. Silence is right for "we simply have not
// measured yet", and wrong for the two states that will not resolve on their own: #1011 was a
// probe loop nobody could see, burning the budget the gauge exists to report.
const PROBE_NOTES: Record<ClaudeProbeState, string | null> = {
  ok: null,
  "no-claude": "tips.rateLimit.noClaude",
  "no-windows": "tips.rateLimit.noWindows",
  "no-report": "tips.rateLimit.noReport",
};

// A trust prompt is the one stall a user can clear in ten seconds, and the only reason they would
// ever know to: the hidden session waits on a dialog they cannot see. It says "the folder" rather
// than naming one because the path is the server's (CLAUDE_CWD) and does not cross to the browser.
const TRUST_PROMPT_NOTE = "tips.rateLimit.trustPrompt";
const USAGE_LIMIT_NOTE = "tips.rateLimit.usageLimit";

// An account's probe runs in the same folder under the account's own login, whose trust answers
// start empty — so a new claude account meets this prompt first, and it is cleared from a cell ON it.
const ACCOUNT_TRUST_PROMPT_NOTE = "tips.rateLimit.accountTrustPrompt";

/** The message key for why a claude gauge is absent, or null when there is nothing to say.
 *
 *  Keyed on whether anything is actually DRAWN, not on whether a reading is held: a reading whose
 *  window has already reset is held but not drawn, and that is exactly when the reader most needs
 *  the reason. Checking the limits instead let a stale cached figure suppress the note —
 *  uninstall `claude` and the gauge would go on showing yesterday's percentage, silently. */
function probeNoteKey(
  limits: RateLimits | null,
  probe: ClaudeProbeState | undefined,
  stall: ClaudeProbeStall | undefined,
  now_ms: number,
  trustNote: string,
): string | null {
  if (gaugeWindows(limits, now_ms).length > 0) return null;
  if (probe === "no-report" && stall === "trust-prompt") return trustNote;
  if (atUsageLimit(probe, stall)) return USAGE_LIMIT_NOTE;
  return PROBE_NOTES[probe ?? "ok"];
}

/** A claude login's gauge that cannot be drawn, and why — named, since several can share the row. */
export interface AccountNote {
  key: string;
  label: string;
  /** Hover text: the login's name and why its figures are missing. */
  note: string;
  /** Drawn where the figures would be: `n/a`, or the word for a subscription that is out. */
  status: string;
  /** At its usage limit — the state that stops the work, drawn in the warning colour (#2995). */
  warn: boolean;
}

/** One named entry without figures. `n/a` stays notation, like the figures beside it; the word for
 *  a login that is out is a word, so it is translated. */
function loginNote(key: string, label: string, reason: string, warn: boolean, translate: Translate): AccountNote {
  const note = translate("tips.rateLimit.accountNote", { account: label, note: reason });
  return { key, label, note, status: warn ? translate("tips.rateLimit.atLimit", {}) : "n/a", warn };
}

/** Why a subscription is out and, where its last reading still says so, when its windows reset.
 *  `lastLimits` is sent exactly while a login is held out; a window whose reset has passed is left
 *  off, since it tells the reader nothing about now. */
function atLimitReason(lastLimits: RateLimits | null, now_ms: number, translate: Translate): string {
  const note = translate(USAGE_LIMIT_NOTE, {});
  const resets = liveWindows(lastLimits, now_ms).flatMap(({ label, window }) => {
    const resetsText = resetsIn(window.resetsAt_sec, now_ms, translate);
    return resetsText ? [translate("tips.rateLimit.windowResets", { window: label, resets: resetsText })] : [];
  });
  return resets.length ? translate("tips.rateLimit.noteResets", { note, resets: resets.join(" · ") }) : note;
}

function accountNotes(readings: readonly AccountReading[], now_ms: number, translate: Translate): AccountNote[] {
  return readings.flatMap((reading) => {
    if (reading.agent !== "claude") return [];
    const key = probeNoteKey(reading.limits, reading.probe, reading.probeStall, now_ms, ACCOUNT_TRUST_PROMPT_NOTE);
    if (!key) return [];
    const warn = atUsageLimit(reading.probe, reading.probeStall);
    const reason = warn ? atLimitReason(reading.lastLimits ?? null, now_ms, translate) : translate(key, {});
    return [loginNote(`account:${reading.id}`, reading.label, reason, warn, translate)];
  });
}

/** The default login's missing-claude line, in whichever of its two forms the row calls for.
 *
 *  Alone it is the unnamed `claude usage n/a` with the reason on hover. Once a NAMED claude login
 *  shares the row it becomes a named entry like theirs, `/login n/a` — beside `a at limit` an
 *  unnamed line reads as the row's general state rather than as one more login's (#2995). */
function defaultClaudeNote(
  snapshot: RateLimitSnapshot | null,
  now_ms: number,
  translate: Translate,
  named: boolean,
): { note: string | null; entry: AccountNote | null } {
  const key = snapshot && probeNoteKey(snapshot.claude, snapshot.claudeProbe, snapshot.claudeStall, now_ms, TRUST_PROMPT_NOTE);
  if (!key) return { note: null, entry: null };
  if (!named) return { note: translate(key, {}), entry: null };
  const warn = atUsageLimit(snapshot?.claudeProbe, snapshot?.claudeStall);
  return { note: null, entry: loginNote("claude", DEFAULT_LOGIN_SHORT_LABEL, translate(key, {}), warn, translate) };
}

export interface GaugeWindow {
  label: string;
  percent: number;
  /** Past this, the window is close enough to matter more than the other readings around it. */
  warn: boolean;
}

// Where "you should look at this" begins. Under it the number is information; over it, it is the
// thing that will stop the work.
export const WARN_PERCENT = 75;

const MS_PER_SEC = 1000;
const SEC_PER_MIN = 60;
const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 24 * MIN_PER_HOUR;

// A window whose reset time has PASSED says nothing about now: the budget it describes has already
// rolled over, so the percentage belongs to a window that no longer exists. Dropping it is the same
// rule as the one at the top of this file — a figure we cannot vouch for is worse than no figure,
// and "83% used" from before a reset reads exactly like 83% used today. `resetsAt` unknown means we
// cannot prove it is stale, so it stays.
const expired = (window: RateLimitWindow, now_ms: number): boolean => window.resetsAt_sec !== null && window.resetsAt_sec * MS_PER_SEC <= now_ms;

/** The windows worth saying anything about, in reading order.
 *
 *  ONE list, feeding both the figures and the hover / aria text. Deciding twice is how the two came
 *  apart: filtering only the rendered rows left the spoken label announcing a percentage the screen
 *  had deliberately dropped (Codex review on #1047). */
const liveWindows = (limits: RateLimits | null, now_ms: number): { label: string; window: RateLimitWindow }[] => {
  if (!limits) return [];
  const labelled = [
    { label: "5h", window: limits.fiveHour },
    { label: "7d", window: limits.sevenDay },
  ];
  return labelled.flatMap(({ label, window }) => (window !== null && !expired(window, now_ms) ? [{ label, window }] : []));
};

/** The windows to render for one agent, in the order they are shown. Empty when the agent has
 * reported nothing — which covers "not installed", "API-key billing", "no session yet" and a
 * reading that has outlived its window alike, because there is nothing worth saying differently
 * about any of them. */
export function gaugeWindows(limits: RateLimits | null, now_ms: number): GaugeWindow[] {
  return liveWindows(limits, now_ms).map(({ label, window }) => ({
    label,
    percent: Math.round(window.usedPercentage),
    warn: window.usedPercentage >= WARN_PERCENT,
  }));
}

export interface AgentGauge {
  /** Unique on the row: the agent for the default login, `account:<id>` for an account. */
  key: string;
  agent: "claude" | "codex";
  /** The login's name, drawn before its figures: an account's label, or `/login` for the default
   *  login once a named login of the same agent shares the row; absent for a default login alone. */
  label?: string;
  /** Hover text and aria-label, from the same windows the figures come from (see gaugeTitle). */
  title: string;
  /** Drawn whenever something ELSE shares the row — the other agent's figures, or the note that
   * stands in for them (see AgentMark.vue for why the mark is drawn rather than picked from the
   * icon set). */
  marked: boolean;
  windows: GaugeWindow[];
}

export interface RateLimitReadout {
  note: string | null;
  accountNotes: AccountNote[];
  gauges: AgentGauge[];
}

/** Which agents have a NAMED login on the row — an account's gauge, or a claude login's note. */
const namedAgents = (accounts: readonly AgentGauge[], notes: readonly AccountNote[]): Set<AgentGauge["agent"]> =>
  new Set([...accounts.map((gauge) => gauge.agent), ...(notes.length ? ["claude" as const] : [])]);

/**
 * The whole header readout, decided in ONE pass.
 *
 * The note and the marks are not separable, which is why one function returns both: the note stands
 * where Claude's figures would be, so a Codex row next to it is a second thing on the row and needs
 * saying whose it is. Deciding the mark from "do both agents report" alone made that impossible —
 * the note only appears when Claude reports nothing, so it was ALWAYS unmarked, and
 * `claude usage n/a | 7d 71%` read as Claude's 7d with the 5h missing. It was Codex's (#1161).
 *
 * An agent with nothing to show is dropped rather than rendered empty, and a solo user of either
 * tool still gets no mark — a symbol that distinguishes nothing is one more thing to read.
 */
export function rateLimitReadout(snapshot: RateLimitSnapshot | null, now_ms: number, translate: Translate): RateLimitReadout {
  const readings = snapshot?.accounts ?? [];
  const accounts = accountGauges(readings, now_ms, translate);
  const notes = accountNotes(readings, now_ms, translate);
  const named = namedAgents(accounts, notes);
  const defaultNote = defaultClaudeNote(snapshot, now_ms, translate, named.has("claude"));
  const allNotes = defaultNote.entry ? [defaultNote.entry, ...notes] : notes;
  const claude = defaultGauge("claude", snapshot?.claude ?? null, now_ms, named.has("claude"), translate);
  const codex = defaultGauge("codex", snapshot?.codex ?? null, now_ms, named.has("codex"), translate);
  // An account's gauge or note on the row is one more thing the default's figures could be mistaken for.
  const marked = defaultNote.note !== null || (claude.length > 0 && codex.length > 0) || accounts.length > 0 || allNotes.length > 0;
  const mark = (gauge: Omit<AgentGauge, "marked">): AgentGauge => ({ ...gauge, marked });
  return { note: defaultNote.note, accountNotes: allNotes, gauges: [...claude.map(mark), ...codex.map(mark), ...accounts] };
}

/** The default login's gauge for one agent, or nothing when it has nothing to show.
 *
 *  Unnamed on its own. Once a NAMED login of the same agent shares the row it is labelled `/login`:
 *  beside `b 5h 2% 7d 0%`, an unnamed `5h 2% 7d 0%` reads as a second copy of b rather than as the
 *  `/login` account's own figures (#2995). */
function defaultGauge(
  agent: AgentGauge["agent"],
  limits: RateLimits | null,
  now_ms: number,
  named: boolean,
  translate: Translate,
): Omit<AgentGauge, "marked">[] {
  const windows = gaugeWindows(limits, now_ms);
  if (!windows.length) return [];
  if (!named) return [{ key: agent, agent, title: gaugeTitle(agent, limits, now_ms, translate), windows }];
  const agentName = translate("tips.rateLimit.accountAgent", { account: DEFAULT_LOGIN_SHORT_LABEL, agent });
  return [{ key: agent, agent, label: DEFAULT_LOGIN_SHORT_LABEL, title: gaugeTitle(agentName, limits, now_ms, translate), windows }];
}

/** One gauge per account that has something to show (#2215) — always marked and named, since it
 *  sits beside the default login's own figures for the same agent. */
function accountGauges(readings: readonly AccountReading[], now_ms: number, translate: Translate): AgentGauge[] {
  return readings.flatMap((reading) => {
    const windows = gaugeWindows(reading.limits, now_ms);
    if (!windows.length) return [];
    const account = reading.email ? `${reading.label} · ${reading.email}` : reading.label;
    const agentName = translate("tips.rateLimit.accountAgent", { account, agent: reading.agent });
    const title = gaugeTitle(agentName, reading.limits, now_ms, translate);
    return [{ key: `account:${reading.id}`, agent: reading.agent, label: reading.label, marked: true, title, windows }];
  });
}

/** "resets in 2h 15m", or "" when the reset is unknown or already past. The hover text says when
 * the number stops mattering, which is the question that follows "how much is left". */
export function resetsIn(resetsAt_sec: number | null, now_ms: number, translate: Translate): string {
  if (resetsAt_sec === null) return "";
  const remaining_min = Math.round((resetsAt_sec * MS_PER_SEC - now_ms) / MS_PER_SEC / SEC_PER_MIN);
  if (remaining_min <= 0) return "";
  const days = Math.floor(remaining_min / MIN_PER_DAY);
  const hours = Math.floor((remaining_min % MIN_PER_DAY) / MIN_PER_HOUR);
  const minutes = remaining_min % MIN_PER_HOUR;
  if (days) return translate("tips.rateLimit.resetsInDays", { days, hours, minutes });
  return hours ? translate("tips.rateLimit.resetsInHours", { hours, minutes }) : translate("tips.rateLimit.resetsInMinutes", { minutes });
}

/** The hover text for one agent — the same numbers plus when each window resets. Also the
 *  `aria-label`, which is why it is built from the SAME list the figures come from: a screen reader
 *  announcing a percentage that is not on screen is worse than one announcing nothing. */
export function gaugeTitle(agent: string, limits: RateLimits | null, now_ms: number, translate: Translate): string {
  const parts = liveWindows(limits, now_ms).map(({ label, window }) => {
    const resets = resetsIn(window.resetsAt_sec, now_ms, translate);
    const named = { window: label, percent: Math.round(window.usedPercentage), resets };
    return translate(resets ? "tips.rateLimit.windowUsedResets" : "tips.rateLimit.windowUsed", named);
  });
  return parts.length ? translate("tips.rateLimit.title", { agent, windows: parts.join(" · ") }) : "";
}
