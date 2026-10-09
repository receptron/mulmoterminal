// What the header actually shows, decided away from the component so the rules are testable
// without mounting anything (#387).
//
// The one rule that outranks the rest: a window we do not have is NOT zero. The percentage is a
// budget already spent, so rendering 0% for missing data tells the reader they have everything
// left at the exact moment we cannot see how much they have — and upstream has dropped the field
// before (anthropics/claude-code#40094). Missing renders nothing at all.

import type { RateLimits, RateLimitWindow } from "../../common/rateLimits";
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

/** A short line explaining an absent Claude gauge, or null when there is nothing worth saying —
 *  either it is showing, or it has simply not been measured yet.
 *
 *  Keyed on whether anything is actually DRAWN, not on whether a reading is held: a reading whose
 *  window has already reset is held but not drawn, and that is exactly when the reader most needs
 *  the reason. Checking `snapshot.claude` instead let a stale cached figure suppress the note —
 *  uninstall `claude` and the gauge would go on showing yesterday's percentage, silently. */
function claudeProbeNote(snapshot: RateLimitSnapshot | null, now_ms: number, translate: Translate): string | null {
  if (!snapshot) return null;
  const key = probeNoteKey(snapshot.claude, snapshot.claudeProbe, snapshot.claudeStall, now_ms, TRUST_PROMPT_NOTE);
  return key && translate(key, {});
}

// An account's probe runs in the same folder under the account's own login, whose trust answers
// start empty — so a new claude account meets this prompt first, and it is cleared from a cell ON it.
const ACCOUNT_TRUST_PROMPT_NOTE = "tips.rateLimit.accountTrustPrompt";

/** The message key for why a claude gauge is absent, or null when there is nothing to say. */
function probeNoteKey(
  limits: RateLimits | null,
  probe: ClaudeProbeState | undefined,
  stall: ClaudeProbeStall | undefined,
  now_ms: number,
  trustNote: string,
): string | null {
  if (gaugeWindows(limits, now_ms).length > 0) return null;
  if (probe === "no-report" && stall === "trust-prompt") return trustNote;
  if (probe === "no-report" && stall === "usage-limit") return USAGE_LIMIT_NOTE;
  return PROBE_NOTES[probe ?? "ok"];
}

/** A claude account's gauge that cannot be drawn, and why — named, since several can share the row. */
export interface AccountNote {
  key: string;
  label: string;
  note: string;
}

function accountNotes(readings: readonly AccountReading[], now_ms: number, translate: Translate): AccountNote[] {
  return readings.flatMap((reading) => {
    if (reading.agent !== "claude") return [];
    const key = probeNoteKey(reading.limits, reading.probe, reading.probeStall, now_ms, ACCOUNT_TRUST_PROMPT_NOTE);
    if (!key) return [];
    const note = translate("tips.rateLimit.accountNote", { account: reading.label, note: translate(key, {}) });
    return [{ key: `account:${reading.id}`, label: reading.label, note }];
  });
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
  /** The account's name, drawn before its figures; absent for the default login. */
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
  const note = claudeProbeNote(snapshot, now_ms, translate);
  const claude = gaugeWindows(snapshot?.claude ?? null, now_ms);
  const codex = gaugeWindows(snapshot?.codex ?? null, now_ms);
  const accounts = accountGauges(snapshot?.accounts ?? [], now_ms, translate);
  const notes = accountNotes(snapshot?.accounts ?? [], now_ms, translate);
  // An account's gauge or note on the row is one more thing the default's figures could be mistaken for.
  const marked = note !== null || (claude.length > 0 && codex.length > 0) || accounts.length > 0 || notes.length > 0;
  const titleOf = (agent: "claude" | "codex") => gaugeTitle(agent, snapshot?.[agent] ?? null, now_ms, translate);
  return {
    note,
    accountNotes: notes,
    gauges: [
      ...(claude.length ? [{ key: "claude", agent: "claude" as const, marked, title: titleOf("claude"), windows: claude }] : []),
      ...(codex.length ? [{ key: "codex", agent: "codex" as const, marked, title: titleOf("codex"), windows: codex }] : []),
      ...accounts,
    ],
  };
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
