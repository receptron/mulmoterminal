import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRateLimits } from "../../../src/composables/useRateLimits";

// Every request here is one the server may answer by spending a Claude query on a probe, so a
// leaked polling chain does not just waste a fetch — it quietly doubles the cost of the budget the
// gauge exists to report. These pin the lifecycle rather than the numbers.
describe("useRateLimits polling lifecycle", () => {
  const fetchMock = vi.fn();

  const respond = (body: unknown = { claude: null, codex: null, probing: false }) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => respond());
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls once for one watcher", async () => {
    const { start, stop } = useRateLimits();
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  // Two headers mounted at once must share one chain, not run one each.
  it("does not start a second chain for a second watcher", async () => {
    const a = useRateLimits();
    const b = useRateLimits();
    a.start();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    a.stop();
    b.stop();
  });

  it("stops polling once the last watcher leaves", async () => {
    const { start, stop } = useRateLimits();
    start();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The case a watcher count alone cannot catch: the unmount lands while the first request is
  // still in flight, so there is no timer to clear, and the old request's completion schedules a
  // timer for a chain nobody retired. Both chains then poll forever.
  it("does not fork a second chain when the header remounts mid-request", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { start, stop } = useRateLimits();

    start(); // first request hangs
    stop(); // unmounted while it is in flight — nothing to clearTimeout
    start(); // remounted: this chain is the live one
    await vi.advanceTimersByTimeAsync(0);

    resolveFirst?.({ ok: true, json: () => Promise.resolve({ claude: null, codex: null, probing: false }) });
    await vi.advanceTimersByTimeAsync(0);

    fetchMock.mockClear();
    // One interval's worth: a single live chain polls once. Two would poll twice.
    await vi.advanceTimersByTimeAsync(130_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  // While a probe is on its way the answer is seconds out, so the gauge chases it rather than
  // sleeping through the full interval and painting half of itself for minutes.
  it("polls sooner while the server says a probe is in flight", async () => {
    fetchMock.mockImplementation(() => respond({ claude: null, codex: null, probing: true }));
    const { start, stop } = useRateLimits();
    start();
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(7000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  // Why the reason travels as the server's own word for it (#1293): the note the gauge shows for a
  // trust prompt is not the one it shows for any other silence.
  it("carries the server's stall reason through to the snapshot", async () => {
    fetchMock.mockImplementation(() => respond({ claude: null, codex: null, probing: false, claudeProbe: "no-report", claudeProbeStall: "trust-prompt" }));
    const { start, stop, snapshot } = useRateLimits();
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot.value?.claudeStall).toBe("trust-prompt");
    stop();
  });

  // A field the server never sent, or one it sent a new value for, must not reach the note as a
  // string nothing knows how to render.
  it("ignores a stall it does not recognise", async () => {
    fetchMock.mockImplementation(() => respond({ claude: null, codex: null, probing: false, claudeProbe: "no-report", claudeProbeStall: "something-new" }));
    const { start, stop, snapshot } = useRateLimits();
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot.value?.claudeStall).toBeUndefined();
    stop();
  });

  // Accounts (#2215): each row is parsed on its own, a malformed one dropped, and an account's
  // probe counts as a probe the client should wait for.
  it("parses each account's reading and drops a malformed row", async () => {
    const accounts = [
      { id: "work", label: "Work", agent: "claude", limits: { fiveHour: { usedPercentage: 12, resetsAt_sec: null }, sevenDay: null }, probing: false },
      { id: "Bad Id", label: "x", agent: "claude", limits: null, probing: false },
      { id: "g", label: "Grok", agent: "grok", limits: null, probing: false },
    ];
    fetchMock.mockImplementation(() => respond({ claude: null, codex: null, probing: false, accounts }));
    const { start, stop, snapshot } = useRateLimits();
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot.value?.accounts).toEqual([
      { id: "work", label: "Work", agent: "claude", limits: { fiveHour: { usedPercentage: 12, resetsAt_sec: null }, sevenDay: null } },
    ]);
    stop();
  });

  it("carries an account's probe state and drops one it does not recognise", async () => {
    const accounts = [
      { id: "work", label: "Work", agent: "claude", limits: null, probing: false, probe: "no-report", probeStall: "trust-prompt" },
      { id: "home", label: "Home", agent: "claude", limits: null, probing: false, probe: "bogus", probeStall: "bogus" },
    ];
    fetchMock.mockImplementation(() => respond({ claude: null, codex: null, probing: false, accounts }));
    const { start, stop, snapshot } = useRateLimits();
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot.value?.accounts?.map((a) => [a.probe, a.probeStall])).toEqual([
      ["no-report", "trust-prompt"],
      [undefined, undefined],
    ]);
    stop();
  });

  it("carries an account's last-read windows, and none when the row sends none or garbage", async () => {
    const last = { fiveHour: { usedPercentage: 100, resetsAt_sec: 1_800_000_000 }, sevenDay: null };
    const accounts = [
      { id: "held", label: "Held", agent: "claude", limits: null, probing: false, lastLimits: last },
      { id: "plain", label: "Plain", agent: "claude", limits: null, probing: false },
      { id: "junk", label: "Junk", agent: "claude", limits: null, probing: false, lastLimits: "soon" },
    ];
    fetchMock.mockImplementation(() => respond({ claude: null, codex: null, probing: false, accounts }));
    const { start, stop, snapshot } = useRateLimits();
    start();
    await vi.advanceTimersByTimeAsync(0);
    const rows = snapshot.value?.accounts ?? [];
    expect(rows[0]?.lastLimits).toEqual(last);
    expect(rows.slice(1).map((row) => "lastLimits" in row)).toEqual([false, false]);
    stop();
  });

  it("polls again soon while an ACCOUNT's probe is running", async () => {
    fetchMock.mockImplementation(() =>
      respond({ claude: null, codex: null, probing: false, accounts: [{ id: "work", label: "Work", agent: "claude", limits: null, probing: true }] }),
    );
    const { start, stop } = useRateLimits();
    start();
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalled();
    stop();
  });
});
