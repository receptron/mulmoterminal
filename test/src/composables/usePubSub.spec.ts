// The two connect callbacks, which are not the same question (#2001).
//
// `onReconnect` is for state DERIVED from the stream: before the first connect there is nothing to
// re-sync, so it deliberately skips it. `onConnect` is for state that exists before the socket does
// — the collection pane files a chat as soon as it is spawned, which can be before this socket has
// ever come up, and an ending in that window is pushed to nobody.
import { describe, it, expect, vi, beforeEach } from "vitest";

const sock = vi.hoisted((): { handlers: Map<string, (arg: unknown) => void>; emitted: string[]; connected: boolean } => ({
  handlers: new Map(),
  emitted: [],
  connected: false,
}));
vi.mock("socket.io-client", () => ({
  io: () => ({
    on: (event: string, handler: (arg: unknown) => void) => sock.handlers.set(event, handler),
    emit: (event: string, channel: string) => sock.emitted.push(`${event}:${channel}`),
    get connected() {
      return sock.connected;
    },
  }),
}));

import { usePubSub } from "../../../src/composables/usePubSub";

const connect = (): void => sock.handlers.get("connect")?.(undefined);

describe("usePubSub connect callbacks", () => {
  beforeEach(() => {
    sock.emitted = [];
  });

  it("tells onConnect about the first connect and onReconnect only about later ones", () => {
    const connects: string[] = [];
    const stopConnect = usePubSub().onConnect(() => connects.push("connect"));
    const stopReconnect = usePubSub().onReconnect(() => connects.push("reconnect"));
    connect();
    expect(connects).toEqual(["connect"]);
    connect();
    expect(connects).toEqual(["connect", "reconnect", "connect"]);
    stopConnect();
    stopReconnect();
    connect();
    expect(connects).toEqual(["connect", "reconnect", "connect"]); // both let go
  });

  // The rooms are re-joined on every connect, which is what makes a subscription survive one — and
  // why the events missed in between have to be reconciled by the subscriber.
  it("re-joins every live channel when the socket comes back", () => {
    const off = usePubSub().subscribe("sessions", () => {});
    connect();
    expect(sock.emitted).toContain("subscribe:sessions");
    off();
  });
});
