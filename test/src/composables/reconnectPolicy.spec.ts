import { describe, it, expect } from "vitest";

import { reconnectDelayMs, shouldReconnect, type ReconnectFacts } from "../../../src/composables/reconnectPolicy";

// A live Claude/codex session whose socket just dropped for no good reason — the one case
// that SHOULD come back.
const DROPPED: ReconnectFacts = { released: false, sawExit: false, reconnectPending: false, isCommand: false };

describe("shouldReconnect", () => {
  it("reconnects a session socket that simply dropped", () => {
    expect(shouldReconnect(DROPPED)).toBe(true);
  });

  // A Run cell's process is unique and unresumable: reconnecting re-runs the command the
  // user just watched finish, in their repository.
  it("never reconnects a command cell", () => {
    expect(shouldReconnect({ ...DROPPED, isCommand: true })).toBe(false);
  });

  // `sawExit` is also set when another tab supersedes this one. Reconnect here and the two
  // tabs take turns evicting each other for as long as both stay open.
  it("does not reconnect after an intentional end", () => {
    expect(shouldReconnect({ ...DROPPED, sawExit: true })).toBe(false);
  });

  it("does not reconnect a slot that was released", () => {
    expect(shouldReconnect({ ...DROPPED, released: true })).toBe(false);
  });

  // Without this the retry rate doubles on every drop that lands while one is already armed.
  it("does not arm a second retry while one is pending", () => {
    expect(shouldReconnect({ ...DROPPED, reconnectPending: true })).toBe(false);
  });

  it("stays down when several reasons apply at once", () => {
    expect(shouldReconnect({ released: true, sawExit: true, reconnectPending: true, isCommand: true })).toBe(false);
  });
});

describe("reconnectDelayMs", () => {
  it("starts at half a second and doubles", () => {
    expect([0, 1, 2, 3].map(reconnectDelayMs)).toEqual([500, 1000, 2000, 4000]);
  });

  // The cap is what separates "a server restarting" from "a server that is down": without it
  // the 20th attempt would be measured in days, and without doubling the client would hammer
  // a dead server twice a second forever.
  it("caps the wait at five seconds", () => {
    expect(reconnectDelayMs(4)).toBe(5000);
    expect(reconnectDelayMs(40)).toBe(5000);
  });

  it("never returns a negative or zero delay", () => {
    for (const attempts of [0, 1, 10]) expect(reconnectDelayMs(attempts)).toBeGreaterThan(0);
  });
});
