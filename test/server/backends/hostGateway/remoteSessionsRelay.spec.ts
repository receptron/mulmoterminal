// @vitest-environment node
// The relay against a real remote: this repo's own pub/sub on loopback, with the same origin rule a
// real server runs, so "a loopback client with no Origin is admitted" is exercised, not assumed.
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { Socket } from "node:net";
import { createPubSub } from "../../../../server/infra/async/pubsub.js";
import { browserOriginHostnames, createIsAllowedOrigin } from "../../../../server/infra/http/allowed-origin.js";
import { relayMessage, startRemoteSessionsRelay } from "../../../../server/backends/hostGateway/remoteSessionsRelay.js";
import type { RemoteSessionsMessage } from "../../../../common/remoteHosts.js";
import type { RemoteHost } from "../../../../server/backends/hostGateway/remoteHostsConfig.js";

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const ROW = {
  id: SESSION,
  cwd: "/srv/p",
  working: true,
  waiting: false,
  event: "UserPromptSubmit",
  lastPrompt: "hi",
  aiTitle: null,
  lastResponse: null,
  memo: null,
};

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

async function remote(): Promise<{ host: RemoteHost; pubsub: ReturnType<typeof createPubSub>; close: () => Promise<void> }> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  const pubsub = createPubSub([server], createIsAllowedOrigin(browserOriginHostnames("127.0.0.1", undefined)));
  // An upgraded socket is no longer the http server's, so neither close() nor closeAllConnections() ends it.
  const connections = new Set<Socket>();
  server.on("connection", (connection) => connections.add(connection));
  const close = () =>
    new Promise<void>((resolve) => {
      connections.forEach((connection) => connection.destroy());
      server.close(() => resolve());
    });
  cleanups.push(() => void close());
  return { host: { id: "lx", label: "Linux", origin: `http://127.0.0.1:${address.port}` }, pubsub, close };
}

function relayTo(hosts: () => RemoteHost[], usable: () => Promise<boolean> = async () => true) {
  const published: RemoteSessionsMessage[] = [];
  const relay = startRemoteSessionsRelay({ hosts, usable, publish: (_channel, data) => published.push(data), reconcile_ms: 60_000 });
  cleanups.push(relay.stop);
  return { relay, published };
}

async function until(predicate: () => boolean, label: string, budgetMs = 4000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const isResync = (message: RemoteSessionsMessage) => "resync" in message;

// The relay asks to subscribe as it publishes the resync, so a row sent before the remote has
// joined it to the room is sent to no one.
const subscribed = (pubsub: ReturnType<typeof createPubSub>, count = 1) =>
  until(() => pubsub.subscriberCount("sessions") === count, `${count} subscriber(s) on the remote`);

describe("relayMessage", () => {
  it("copies a row's known fields and tags it with the host", () => {
    expect(relayMessage("lx", { ...ROW, secret: "x", working: "yes" })).toEqual({ host: "lx", row: { ...ROW, working: false } });
  });
  it("carries the closed and created messages", () => {
    expect(relayMessage("lx", { id: SESSION, working: false, event: "closed", failed: true })).toEqual({
      host: "lx",
      row: { id: SESSION, working: false, waiting: false, event: "closed", failed: true },
    });
    expect(relayMessage("lx", { id: SESSION, working: false, event: "created" })?.row.event).toBe("created");
  });
  it("drops what is not a row of a real session", () => {
    [undefined, null, "x", {}, { id: 3 }, { id: "not-a-uuid" }, { id: `${SESSION}/../x` }].forEach((data) => expect(relayMessage("lx", data)).toBeNull());
  });
});

describe("the session relay", () => {
  it("republishes the remote's session rows with the host, after a resync", async () => {
    const { host, pubsub } = await remote();
    const { published } = relayTo(() => [host]);
    await until(() => published.some(isResync), "resync on connect");
    await subscribed(pubsub);
    pubsub.publish("sessions", ROW);
    await until(() => published.some((message) => "row" in message), "a relayed row");
    expect(published).toEqual([
      { host: "lx", resync: true },
      { host: "lx", row: ROW },
    ]);
  });

  it("relays the sessions channel and nothing else", async () => {
    const { host, pubsub } = await remote();
    const { published } = relayTo(() => [host]);
    await until(() => published.some(isResync), "resync on connect");
    await subscribed(pubsub);
    pubsub.publish("file-write", { path: "/etc/passwd" });
    pubsub.publish("ask-question", { id: SESSION });
    pubsub.publish("sessions", ROW);
    await until(() => published.length === 2, "the sessions row");
    expect(published.filter((message) => !isResync(message))).toEqual([{ host: "lx", row: ROW }]);
  });

  it("says to resync when the remote drops", async () => {
    const { host, close } = await remote();
    const { published } = relayTo(() => [host]);
    await until(() => published.some(isResync), "resync on connect");
    await close();
    await until(() => published.filter(isResync).length === 2, "resync on drop");
    expect(published).toEqual([
      { host: "lx", resync: true },
      { host: "lx", resync: true },
    ]);
  });

  it("lets go of a host removed from the config", async () => {
    const { host, pubsub } = await remote();
    let hosts = [host];
    const { relay, published } = relayTo(() => hosts);
    await until(() => published.some(isResync), "resync on connect");
    await subscribed(pubsub);
    hosts = [];
    await relay.reconcile();
    await subscribed(pubsub, 0);
    const before = published.length;
    pubsub.publish("sessions", ROW);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(published.slice(before).filter((message) => "row" in message)).toEqual([]);
  });

  it("does not connect to a host it may not use, and survives a check that throws", async () => {
    const { host, pubsub } = await remote();
    const refused = relayTo(
      () => [host],
      async () => false,
    );
    const broken = relayTo(
      () => [host],
      async () => {
        throw new Error("probe failed");
      },
    );
    await refused.relay.reconcile();
    await broken.relay.reconcile();
    pubsub.publish("sessions", ROW);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect([...refused.published, ...broken.published]).toEqual([]);
  });
});
