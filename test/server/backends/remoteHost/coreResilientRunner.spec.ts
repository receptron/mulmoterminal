// @vitest-environment node
// The outer ring now lives in @mulmoclaude/core (#1064), so these do not test our code — they
// pin the CONTRACT this host depends on, against the version actually installed.
//
// Worth pinning because it broke exactly this way once. The ring's give-up clock only works if it
// outlives core's own listen-retry window, and those two numbers used to sit in different repos:
// core 1.8.0 abandoned a listener after ~31s, our copy called a runner recovered after 60s, and
// upgrading to 1.9.0 (a 5-minute window) meant the 60s "recovery" reset the outage clock before it
// could ever reach 5 minutes. A host with a dead credential then relaunched forever and never
// asked the client to re-authenticate — silently, with the UI reporting "online".
//
// So the assertion is about escalation, not about internals: a channel the phone cannot see must
// eventually reach `onClosed`, and one it can see must not.
import { describe, it, expect, vi } from "vitest";
import { startResilientHostRunner, reconnectDelayMs, type HostRunnerOptions } from "@mulmoclaude/core/remote-host/server";

const GIVE_UP_MS = 5 * 60_000;

// core's windows are minutes long, so the tests drive time rather than wait for it.
function fakeClock() {
  let now = 1_000_000;
  const pending = new Map<number, { at: number; task: () => void }>();
  let nextId = 1;
  const dueBefore = (target: number) => [...pending.entries()].filter(([, timer]) => timer.at <= target).sort(([, left], [, right]) => left.at - right.at)[0];
  return {
    now: () => now,
    schedule: (task: () => void, delayMs: number) => {
      const id = nextId++;
      pending.set(id, { at: now + delayMs, task });
      return () => void pending.delete(id);
    },
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        const due = dueBefore(target);
        if (!due) break;
        const [id, timer] = due;
        pending.delete(id);
        now = timer.at;
        timer.task();
      }
      now = target;
    },
  };
}

// A stand-in for core's own runner: every launch is recorded, and nothing ever reports an error —
// which is the case that matters. A listener that never complains is precisely what a silently
// dead channel looks like from in here.
function fakeRunner() {
  const started: HostRunnerOptions[] = [];
  return {
    started,
    start: (options: HostRunnerOptions) => {
      started.push(options);
      return () => undefined;
    },
  };
}

// The probe answers on a promise, so time has to be driven in steps that let those settle.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function runFor(clock: ReturnType<typeof fakeClock>, totalMs: number, stepMs = 5_000): Promise<void> {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    clock.advance(stepMs);
    await flush();
  }
}

// `checkAlive` is passed whole rather than as a value to resolve: the probe answering by
// REJECTING is one of the cases under test, and it is the one a real network failure takes.
function setup(checkAlive?: () => Promise<boolean | null>) {
  const clock = fakeClock();
  const runner = fakeRunner();
  const onClosed = vi.fn();
  const stop = startResilientHostRunner({
    start: runner.start,
    options: { onClosed },
    ...(checkAlive ? { checkAlive } : {}),
    log: { info: vi.fn(), warn: vi.fn() },
    schedule: clock.schedule,
    now: clock.now,
  });
  return { clock, runner, onClosed, stop };
}

describe("core's resilient runner — the escalation contract this host relies on", () => {
  it("doubles the reconnect delay per attempt and caps it at a minute", () => {
    expect(reconnectDelayMs(0)).toBe(1_000);
    expect(reconnectDelayMs(3)).toBe(8_000);
    expect(reconnectDelayMs(20)).toBe(60_000); // no overflow into an absurd delay
  });

  // The regression. Surviving the settle window must not count as recovery on its own: with the
  // probe saying the phone cannot see us, the outage clock has to keep running until it escalates.
  it("escalates a channel the phone cannot see, however quiet the listener stays", async () => {
    const { clock, onClosed, stop } = setup(() => Promise.resolve(false));
    await runFor(clock, GIVE_UP_MS * 2);
    expect(onClosed).toHaveBeenCalled();
    stop();
  });

  // A probe that cannot reach the server has answered the question it was asking, and it answers
  // it by REJECTING — `createPresenceProbe` reads through `getDocFromServer`, so a network or auth
  // failure arrives as a thrown error rather than as `false`. Treating that as "no news" would put
  // the channel back to green on the strength of a read that never happened.
  //
  // core also wraps the read in a 30s timeout now, so a read that merely hangs lands here too —
  // which makes this the path a silently wedged connection takes (flagged by Codex).
  it("escalates when the probe itself cannot reach the server", async () => {
    const { clock, onClosed, stop } = setup(() => Promise.reject(new Error("unavailable")));
    await runFor(clock, GIVE_UP_MS * 2);
    expect(onClosed).toHaveBeenCalled();
    stop();
  });

  // The control. Without this, the test above would also pass for a runner that gives up on
  // everything — which would be its own outage.
  it("never escalates a channel the phone can still see", async () => {
    const { clock, onClosed, stop } = setup(() => Promise.resolve(true));
    await runFor(clock, GIVE_UP_MS * 2);
    expect(onClosed).not.toHaveBeenCalled();
    stop();
  });

  // What the probe buys, stated as a difference — and the reason `index.ts` must keep passing
  // `checkAlive`. With no probe there is nothing to contradict a quiet listener, so the settle
  // window accepts every relaunch and the outage clock never accumulates: the same silent
  // forever-loop as before, reachable again by dropping one argument at the call site.
  it("cannot escalate at all when no probe is wired", async () => {
    const { clock, onClosed, stop } = setup();
    await runFor(clock, GIVE_UP_MS * 2);
    expect(onClosed).not.toHaveBeenCalled();
    stop();
  });

  // "Cannot be judged" is not "dead": a host that has never announced has no presence document,
  // and reconnecting against that would loop forever with nothing actually wrong.
  it("does not escalate on an answer it cannot judge", async () => {
    const { clock, onClosed, runner, stop } = setup(() => Promise.resolve(null));
    await runFor(clock, GIVE_UP_MS * 2);
    expect(onClosed).not.toHaveBeenCalled();
    expect(runner.started).toHaveLength(1); // never even torn down
    stop();
  });
});
