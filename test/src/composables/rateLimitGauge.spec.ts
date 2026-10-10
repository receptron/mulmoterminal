import { describe, it, expect } from "vitest";
import { rateLimitReadout, gaugeWindows, gaugeTitle, resetsIn, WARN_PERCENT } from "../../../src/composables/rateLimitGauge";
import type { RateLimitSnapshot } from "../../../src/composables/rateLimitGauge";
import { i18n } from "../../../src/i18n";

// The words, through the real messages under the pinned English locale.
const t = i18n.global.t;

// The note and the gauges come out of one call, so the tests below read them the same way rather
// than through two entry points that could be given different snapshots.
const gaugesOf = (snapshot: RateLimitSnapshot | null, now_ms: number) => rateLimitReadout(snapshot, now_ms, t).gauges;
const noteOf = (snapshot: RateLimitSnapshot | null, now_ms: number) => rateLimitReadout(snapshot, now_ms, t).note;

const window = (usedPercentage: number, resetsAt_sec: number | null = null) => ({ usedPercentage, resetsAt_sec });
const NOW = 1_700_000_000_000;

describe("gaugeWindows", () => {
  it("shows both windows in reading order, rounded", () => {
    expect(gaugeWindows({ fiveHour: window(26.6), sevenDay: window(83.2) }, NOW)).toEqual([
      { label: "5h", percent: 27, warn: false },
      { label: "7d", percent: 83, warn: true },
    ]);
  });

  // The rule the whole feature rests on. A window we cannot see is not an empty one — rendering
  // 0% would tell the reader they have everything left at the moment we can least prove it.
  it("omits a window rather than showing it as zero", () => {
    expect(gaugeWindows({ fiveHour: null, sevenDay: window(40) }, NOW)).toEqual([{ label: "7d", percent: 40, warn: false }]);
    expect(gaugeWindows(null, NOW)).toEqual([]);
  });

  it("marks a window at the warning threshold, not only past it", () => {
    expect(gaugeWindows({ fiveHour: window(WARN_PERCENT), sevenDay: null }, NOW)[0].warn).toBe(true);
    expect(gaugeWindows({ fiveHour: window(WARN_PERCENT - 1), sevenDay: null }, NOW)[0].warn).toBe(false);
  });

  // 0 is a real reading and must render; only ABSENCE is hidden. Losing this would blank the
  // gauge at the start of every window, which is when it is most reassuring.
  it("shows a genuine zero", () => {
    expect(gaugeWindows({ fiveHour: window(0), sevenDay: null }, NOW)).toEqual([{ label: "5h", percent: 0, warn: false }]);
  });

  // A reading whose window has already reset describes a budget that no longer exists. Kept on
  // screen it reads exactly like today's number — the same failure the "absent is not zero" rule
  // above exists to prevent, arriving from the other direction.
  it("drops a window whose reset has already passed", () => {
    const past = Math.floor(NOW / 1000) - 60;
    const future = Math.floor(NOW / 1000) + 3600;
    expect(gaugeWindows({ fiveHour: window(83, past), sevenDay: window(40, future) }, NOW)).toEqual([{ label: "7d", percent: 40, warn: false }]);
  });

  // Staleness has to be PROVEN, not assumed: without a reset time there is nothing to compare, and
  // dropping the figure would hide a perfectly good reading.
  it("keeps a window whose reset time is unknown", () => {
    expect(gaugeWindows({ fiveHour: window(83, null), sevenDay: null }, NOW)).toEqual([{ label: "5h", percent: 83, warn: true }]);
  });
});

describe("rateLimitReadout gauges", () => {
  const claudeOnly = { claude: { fiveHour: window(27), sevenDay: null }, codex: null };

  // A user of one tool should not have to read a label that distinguishes nothing.
  it("marks neither agent when only one reports", () => {
    expect(gaugesOf(claudeOnly, NOW)).toMatchObject([{ agent: "claude", marked: false, windows: [{ label: "5h", percent: 27, warn: false }] }]);
  });

  it("marks both once both report", () => {
    const both = { claude: claudeOnly.claude, codex: { fiveHour: window(6), sevenDay: null } };
    expect(gaugesOf(both, NOW).map((g) => g.marked)).toEqual([true, true]);
  });

  // #1161, straight from the reported screenshot: `claude usage n/a | 7d 71%`. The note stands
  // where Claude's figures would be, so the Codex row beside it is a second thing on the line and
  // has to say whose it is. Unmarked, it was read as Claude's 7d with the 5h missing — and the
  // reporter concluded that Codex was not being picked up at all.
  it("marks the surviving agent when a note stands in for the other", () => {
    const noted = { claude: null, codex: { fiveHour: null, sevenDay: window(71) }, claudeProbe: "no-report" as const };
    const readout = rateLimitReadout(noted, NOW, t);

    expect(readout.note).toBeTruthy();
    expect(readout.gauges).toMatchObject([{ agent: "codex", marked: true, windows: [{ label: "7d", percent: 71, warn: false }] }]);
  });

  // The same shape without a note is a solo Codex user, who has nothing to tell it apart from.
  it("leaves the solo agent unmarked when there is no note beside it", () => {
    const solo = { claude: null, codex: { fiveHour: null, sevenDay: window(71) }, claudeProbe: "ok" as const };
    const readout = rateLimitReadout(solo, NOW, t);

    expect(readout.note).toBeNull();
    expect(readout.gauges.map((g) => g.marked)).toEqual([false]);
  });

  // Which is also what "codex is not installed" looks like from here — there is nothing separate
  // to render for a tool the user does not use.
  it("drops an agent with nothing to report", () => {
    expect(gaugesOf({ claude: null, codex: null }, NOW)).toEqual([]);
    expect(gaugesOf(null, NOW)).toEqual([]);
  });
});

describe("resetsIn", () => {
  const inMinutes = (m: number) => Math.floor(NOW / 1000) + m * 60;

  it("reads as days, hours and minutes, dropping the larger units that are zero", () => {
    expect(resetsIn(inMinutes(3 * 1440 + 4 * 60 + 10), NOW, t)).toBe("resets in 3d 4h 10m");
    expect(resetsIn(inMinutes(135), NOW, t)).toBe("resets in 2h 15m");
    expect(resetsIn(inMinutes(20), NOW, t)).toBe("resets in 20m");
  });

  it("switches to days exactly at a day, and keeps the smaller units", () => {
    expect(resetsIn(inMinutes(1439), NOW, t)).toBe("resets in 23h 59m");
    expect(resetsIn(inMinutes(1440), NOW, t)).toBe("resets in 1d 0h 0m");
    expect(resetsIn(inMinutes(1441), NOW, t)).toBe("resets in 1d 0h 1m");
  });

  // A stale reading whose reset has passed should say nothing rather than count backwards.
  it("says nothing for an unknown or elapsed reset", () => {
    expect(resetsIn(null, NOW, t)).toBe("");
    expect(resetsIn(inMinutes(-5), NOW, t)).toBe("");
  });
});

describe("gaugeTitle", () => {
  it("carries the numbers and when each window resets", () => {
    const title = gaugeTitle("claude", { fiveHour: window(27, Math.floor(NOW / 1000) + 3600), sevenDay: window(83) }, NOW, t);
    expect(title).toContain("claude rate limit");
    expect(title).toContain("5h 27% used, resets in 1h 0m");
    expect(title).toContain("7d 83% used");
  });

  it("is empty when there is nothing to say", () => {
    expect(gaugeTitle("codex", null, NOW, t)).toBe("");
    expect(gaugeTitle("codex", { fiveHour: null, sevenDay: null }, NOW, t)).toBe("");
  });

  // This string is also the aria-label, so it has to agree with what is on screen. Filtering only
  // the rendered rows left the spoken text announcing a percentage the gauge had dropped.
  it("leaves out a window the gauge no longer shows", () => {
    const past = Math.floor(NOW / 1000) - 60;
    const limits = { fiveHour: window(83, past), sevenDay: window(40, Math.floor(NOW / 1000) + 3600) };

    expect(gaugeWindows(limits, NOW).map((w) => w.label)).toEqual(["7d"]);
    expect(gaugeTitle("claude", limits, NOW, t)).not.toContain("83");
    expect(gaugeTitle("claude", limits, NOW, t)).toContain("7d 40% used");
  });

  it("says nothing at all when every window it holds has expired", () => {
    const past = Math.floor(NOW / 1000) - 60;
    expect(gaugeTitle("claude", { fiveHour: window(83, past), sevenDay: null }, NOW, t)).toBe("");
  });
});

// #1011 / #1010: an absent Claude gauge used to be indistinguishable from a probe loop running
// every 90 seconds in the background. The note is how a user finds out that nothing is coming —
// and, for two of the three reasons, that nothing will come until they change something.
describe("rateLimitReadout note", () => {
  const snap = (over: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot => ({ claude: null, codex: null, ...over });

  it("says nothing while the figures are showing", () => {
    expect(noteOf(snap({ claude: { fiveHour: { usedPercentage: 5, resetsAt_sec: null }, sevenDay: null }, claudeProbe: "no-report" }), NOW)).toBeNull();
  });

  it("says nothing when it simply has not been measured yet", () => {
    expect(noteOf(snap(), NOW)).toBeNull();
    expect(noteOf(snap({ claudeProbe: "ok" }), NOW)).toBeNull();
    expect(noteOf(null, NOW)).toBeNull();
  });

  it("names the reason when there is one", () => {
    expect(noteOf(snap({ claudeProbe: "no-claude" }), NOW)).toContain("PATH");
    expect(noteOf(snap({ claudeProbe: "no-windows" }), NOW)).toContain("API-key");
    expect(noteOf(snap({ claudeProbe: "no-report" }), NOW)).toContain("Retrying");
  });

  // The case the note existed for and did not cover. A cached reading survives a restart, so
  // uninstalling `claude` left yesterday's percentage on screen with nothing said — the note was
  // suppressed by the very value that had gone stale.
  it("speaks up when the only reading it holds has already expired", () => {
    const expired = { fiveHour: { usedPercentage: 83, resetsAt_sec: Math.floor(NOW / 1000) - 60 }, sevenDay: null };
    expect(noteOf(snap({ claude: expired, claudeProbe: "no-claude" }), NOW)).toContain("PATH");
  });

  // #1293. The probe now waits on a trust dialog instead of confirming it by accident, so a user
  // whose workspace was never trusted gets a permanent `n/a` — and the one thing they need to know
  // is that ten seconds in a terminal fixes it. "Retrying, less often each time" does not say that.
  it("says how to clear a trust prompt when that is what the probe is stuck on", () => {
    const note = noteOf(snap({ claudeProbe: "no-report", claudeStall: "trust-prompt" }), NOW);
    expect(note).toContain("trust prompt");
    expect(note).toContain("claude");
  });

  it("falls back to the general silence when the screen proved nothing", () => {
    expect(noteOf(snap({ claudeProbe: "no-report", claudeStall: "unknown" }), NOW)).toContain("Retrying");
  });

  // A stall belongs to a silence and nothing else; a state that carries its own reason must not be
  // overwritten by one left over from an earlier probe.
  it("ignores a stall that does not belong to the current state", () => {
    expect(noteOf(snap({ claudeProbe: "no-claude", claudeStall: "trust-prompt" }), NOW)).toContain("PATH");
  });
});

// A second login's windows (#2215): named, always marked, and marking the default's figures too,
// since both now share the row.
describe("rateLimitReadout with accounts", () => {
  const claudeOnly = { claude: { fiveHour: window(27), sevenDay: null }, codex: null };
  const work = { id: "work", label: "Work", agent: "claude" as const, limits: { fiveHour: window(12), sevenDay: null } };

  it("adds a named, marked gauge per account, after the default login's", () => {
    const gauges = gaugesOf({ ...claudeOnly, accounts: [work] }, NOW);
    expect(gauges.map((g) => [g.key, g.label, g.marked])).toEqual([
      ["claude", "/login", true],
      ["account:work", "Work", true],
    ]);
    expect(gauges[0]?.title).toContain("/login (claude) rate limit");
    expect(gauges[1]?.title).toContain("Work (claude) rate limit");
  });

  it("leaves out an account with nothing to show, and changes nothing when there are none", () => {
    expect(gaugesOf({ ...claudeOnly, accounts: [{ ...work, limits: null }] }, NOW).map((g) => g.key)).toEqual(["claude"]);
    expect(gaugesOf({ ...claudeOnly, accounts: [] }, NOW).map((g) => g.marked)).toEqual([false]);
  });

  // A new account's trust answers start empty, so its probe meets the trust prompt first — and a
  // gauge that is simply absent would never say so.
  const notesOf = (snapshot: RateLimitSnapshot) => rateLimitReadout(snapshot, NOW, t).accountNotes;
  const stuck = { ...work, limits: null, probe: "no-report" as const, probeStall: "trust-prompt" as const };

  it("names a claude account whose check is stuck, with how to clear it from a cell on it", () => {
    const [entry, ...rest] = notesOf({ ...claudeOnly, accounts: [stuck] });
    expect(rest).toEqual([]);
    expect(entry?.key).toBe("account:work");
    expect(entry?.label).toBe("Work");
    expect(entry?.note).toMatch(/^Work: .*trust prompt.*cell on this account/);
    expect(gaugesOf({ ...claudeOnly, accounts: [stuck] }, NOW).map((g) => g.marked)).toEqual([true]);
  });

  it("gives an account the same reasons as the default login", () => {
    expect(notesOf({ ...claudeOnly, accounts: [{ ...stuck, probeStall: "unknown" }] })[0]?.note).toMatch(/^Work: .*no answer/);
    expect(notesOf({ ...claudeOnly, accounts: [{ ...stuck, probe: "no-windows" }] })[0]?.note).toMatch(/API-key billing/);
  });

  it("names a rotation token's address in its title, and keeps the short label (#2919)", () => {
    const token = { ...work, id: "ss", label: "SS", email: "me@example.com" };
    const gauge = gaugesOf({ ...claudeOnly, accounts: [token] }, NOW)[1];
    expect(gauge?.label).toBe("SS");
    expect(gauge?.title).toContain("SS · me@example.com (claude) rate limit");
  });

  it("says a subscription at its usage limit is that, not 'no answer' (#2919)", () => {
    expect(notesOf({ ...claudeOnly, accounts: [{ ...stuck, probeStall: "usage-limit" }] })[0]?.note).toMatch(/^Work: .*usage limit/);
    expect(noteOf({ claude: null, codex: null, claudeProbe: "no-report", claudeStall: "usage-limit" }, NOW)).toMatch(/usage limit/);
  });

  it("says nothing for an account that is showing, not yet measured, or codex", () => {
    expect(notesOf({ ...claudeOnly, accounts: [{ ...stuck, limits: work.limits }] })).toEqual([]);
    expect(notesOf({ ...claudeOnly, accounts: [{ ...work, limits: null }] })).toEqual([]);
    expect(notesOf({ ...claudeOnly, accounts: [{ ...stuck, agent: "codex" }] })).toEqual([]);
    expect(notesOf({ ...claudeOnly })).toEqual([]);
  });
});

// #2995: an at-limit subscription is a state, not an absence — and the default login is named once
// it has named company, because an unnamed `5h 2% 7d 0%` beside `b 5h 2% 7d 0%` reads as b twice.
describe("rateLimitReadout beside named logins (#2995)", () => {
  const readout = (snapshot: RateLimitSnapshot) => rateLimitReadout(snapshot, NOW, t);
  const inMinutes = (m: number) => Math.floor(NOW / 1000) + m * 60;
  const figures = { fiveHour: window(2), sevenDay: window(0) };
  const a = { id: "a", label: "a", agent: "claude" as const, limits: null, probe: "no-report" as const, probeStall: "usage-limit" as const, rotation: true };
  const b = { id: "b", label: "b", agent: "claude" as const, limits: figures, probe: "ok" as const, rotation: true };

  it("draws the reporter's row: a says it is out, and the /login figures are named", () => {
    const { note, accountNotes, gauges } = readout({ claude: figures, codex: null, accounts: [a, b] });
    expect(note).toBeNull();
    expect(accountNotes).toMatchObject([{ key: "account:a", label: "a", status: "at limit", warn: true }]);
    expect(gauges.map((g) => [g.key, g.label])).toEqual([
      ["claude", "/login"],
      ["account:b", "b"],
    ]);
    expect(gauges[0]?.title).toContain("/login (claude) rate limit");
  });

  it("says when an at-limit login's windows were last due to reset, leaving out one already past", () => {
    const lastLimits = { fiveHour: window(100, inMinutes(-5)), sevenDay: window(100, inMinutes(3 * 1440 + 60)) };
    const [entry] = readout({ claude: null, codex: null, accounts: [{ ...a, lastLimits }] }).accountNotes;
    expect(entry?.note).toMatch(/^a: .*usage limit.* 7d resets in 3d 1h 0m\.$/);
    expect(entry?.note).not.toContain("5h");
  });

  it("gives no reset when none was ever read", () => {
    const [entry] = readout({ claude: null, codex: null, accounts: [a] }).accountNotes;
    expect(entry?.note).toMatch(/usage limit/);
    expect(entry?.note).not.toContain("resets in");
  });

  it("keeps a login that is merely unmeasured in the muted n/a", () => {
    const stuck = { ...a, probeStall: "trust-prompt" as const };
    expect(readout({ claude: null, codex: null, accounts: [stuck] }).accountNotes).toMatchObject([{ status: "n/a", warn: false }]);
  });

  // The default login's own silence takes the same named form, so a /login account that is out
  // reads as one more login at its limit rather than as the row's general state.
  it("names the /login note once a named claude login shares the row", () => {
    const out = readout({ claude: null, codex: null, claudeProbe: "no-report", claudeStall: "usage-limit", accounts: [b] });
    expect(out.note).toBeNull();
    expect(out.accountNotes).toMatchObject([{ key: "claude", label: "/login", status: "at limit", warn: true }]);
    expect(out.accountNotes[0]?.note).toMatch(/^\/login: .*usage limit/);
    expect(out.gauges.map((g) => [g.key, g.marked])).toEqual([["account:b", true]]);
  });

  it("names the /login gauge when the named company is only a note", () => {
    const { gauges, accountNotes } = readout({ claude: figures, codex: null, accounts: [a] });
    expect(accountNotes.map((n) => n.key)).toEqual(["account:a"]);
    expect(gauges.map((g) => [g.key, g.label, g.marked])).toEqual([["claude", "/login", true]]);
  });

  it("names a default login only beside its own agent's accounts", () => {
    const work = { id: "work", label: "Work", agent: "codex" as const, limits: figures };
    const gauges = readout({ claude: figures, codex: figures, accounts: [work] }).gauges;
    expect(gauges.map((g) => [g.key, g.label])).toEqual([
      ["claude", undefined],
      ["codex", "/login"],
      ["account:work", "Work"],
    ]);
  });

  it("leaves a default login on its own exactly as before", () => {
    const alone = readout({ claude: figures, codex: null, claudeProbe: "ok" });
    expect(alone.gauges.map((g) => [g.key, g.label, g.marked])).toEqual([["claude", undefined, false]]);
    expect(alone.accountNotes).toEqual([]);
    expect(readout({ claude: null, codex: null, claudeProbe: "no-report", claudeStall: "usage-limit" }).note).toMatch(/usage limit/);
  });
});
