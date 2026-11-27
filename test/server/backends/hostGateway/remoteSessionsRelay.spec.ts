// @vitest-environment node
// The relay against a real remote: this repo's own pub/sub on loopback, with the same origin rule a
// real server runs, so "a loopback client with no Origin is admitted" is exercised, not assumed.
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { Socket } from "node:net";
import { createPubSub } from "../../../../server/infra/async/pubsub.js";
import { browserOriginHostnames, createIsAllowedOrigin } from "../../../../server/infra/http/allowed-origin.js";
import {
  relayMessage,
  relayPrompt,
  relayQuestion,
  relayToolGroups,
  startRemoteSessionsRelay,
} from "../../../../server/backends/hostGateway/remoteSessionsRelay.js";
import { followRemoteSessionChannels } from "../../../../server/backends/hostGateway/configuredRemoteSessionsRelay.js";
import {
  REMOTE_PROMPT_SUBMITTED_CHANNEL,
  REMOTE_SESSIONS_CHANNEL,
  REMOTE_TOOL_GROUPS_CHANNEL,
  parseRemoteSessionsMessage,
  type RemoteSessionsMessage,
} from "../../../../common/remoteHosts.js";
import { PROMPT_SUBMITTED_CHANNEL } from "../../../../common/promptChannel.js";
import { TOOL_GROUPS_CHANNEL } from "../../../../common/toolGroupsAnnouncement.js";

const isSessionsMessage = (data: unknown): data is RemoteSessionsMessage => parseRemoteSessionsMessage(data) !== null;
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
  const prompts: unknown[] = [];
  const others: [string, unknown][] = [];
  const questions: unknown[] = [];
  const toolGroups: unknown[] = [];
  const publish = (channel: string, data: unknown) => {
    if (channel === REMOTE_PROMPT_SUBMITTED_CHANNEL) prompts.push(data);
    else if (channel === REMOTE_TOOL_GROUPS_CHANNEL) toolGroups.push(data);
    else if (channel === "remote-ask-question") questions.push(data);
    else if (channel === REMOTE_SESSIONS_CHANNEL && isSessionsMessage(data)) published.push(data);
    else others.push([channel, data]);
  };
  const relay = startRemoteSessionsRelay({ hosts, usable, publish, reconcile_ms: 60_000 });
  cleanups.push(relay.stop);
  return { relay, published, prompts, others, questions, toolGroups };
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
  until(
    () =>
      pubsub.subscriberCount("sessions") === count &&
      pubsub.subscriberCount(PROMPT_SUBMITTED_CHANNEL) === count &&
      pubsub.subscriberCount("ask-question") === count &&
      pubsub.subscriberCount(TOOL_GROUPS_CHANNEL) === count,
    `${count} subscriber(s) on the remote`,
  );

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

describe("relayPrompt", () => {
  it("tags a submitted prompt's session with the host", () => {
    expect(relayPrompt("lx", { sessionId: SESSION, extra: 1 })).toEqual({ host: "lx", sessionId: SESSION });
  });
  it("drops what does not name a real session", () => {
    [undefined, null, "x", {}, { sessionId: 3 }, { sessionId: "" }, { sessionId: "not-a-uuid" }, { sessionId: `${SESSION}/../x` }].forEach((data) =>
      expect(relayPrompt("lx", data)).toBeNull(),
    );
  });
});

const DIALOG = { sessionId: SESSION, toolUseId: "tu-1", questions: [{ question: "Pick?", header: "Pick", options: [{ label: "A" }], multiSelect: false }] };

describe("relayQuestion", () => {
  it("tags a dialog opened or closed in a real session with the host", () => {
    expect(relayQuestion("lx", DIALOG)).toEqual({ host: "lx", question: DIALOG });
    const done = { sessionId: SESSION, toolUseId: "tu-1", done: true };
    expect(relayQuestion("lx", done)).toEqual({ host: "lx", question: done });
  });
  it("drops what is not a dialog of a real session", () => {
    [
      undefined,
      null,
      {},
      { ...DIALOG, sessionId: "nope" },
      { ...DIALOG, sessionId: `${SESSION}/../x` },
      { sessionId: SESSION, toolUseId: "tu-1" },
      { ...DIALOG, questions: "x" },
    ].forEach((data) => expect(relayQuestion("lx", data)).toBeNull());
  });
});

describe("relayToolGroups", () => {
  it("copies an announcement of a real session with the host, its groups only when they are a list", () => {
    expect(relayToolGroups("lx", { sessionId: SESSION, groups: ["render"], extra: 1 })).toEqual({
      host: "lx",
      announcement: { sessionId: SESSION, groups: ["render"] },
    });
    expect(relayToolGroups("lx", { sessionId: SESSION })).toEqual({ host: "lx", announcement: { sessionId: SESSION } });
    expect(relayToolGroups("lx", { sessionId: SESSION, groups: "render" })).toEqual({ host: "lx", announcement: { sessionId: SESSION } });
    expect(relayToolGroups("lx", { sessionId: SESSION, groups: [] })).toEqual({ host: "lx", announcement: { sessionId: SESSION, groups: [] } });
  });
  it("drops what does not name a real session", () => {
    [undefined, null, "x", {}, { sessionId: 3 }, { sessionId: "" }, { sessionId: "not-a-uuid" }, { sessionId: `${SESSION}/../x` }].forEach((data) =>
      expect(relayToolGroups("lx", data)).toBeNull(),
    );
  });
});

describe("the session relay", () => {
  // A remote cell re-asks what its session can draw off this, as a local one does off `tool-groups`.
  it("relays a tool-group announcement with the host, on a channel of its own", async () => {
    const { host, pubsub } = await remote();
    const { published, toolGroups, others } = relayTo(() => [host]);
    await until(() => published.some(isResync), "resync on connect");
    await subscribed(pubsub);
    pubsub.publish(TOOL_GROUPS_CHANNEL, { sessionId: "not-a-uuid", groups: ["render"] });
    pubsub.publish(TOOL_GROUPS_CHANNEL, { sessionId: SESSION, groups: ["render"] });
    await until(() => toolGroups.length > 0, "a relayed announcement");
    expect(toolGroups).toEqual([{ host: "lx", announcement: { sessionId: SESSION, groups: ["render"] } }]);
    expect(others).toEqual([]);
  });

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
    const { published, prompts, others } = relayTo(() => [host]);
    await until(() => published.some(isResync), "resync on connect");
    await subscribed(pubsub);
    pubsub.publish("file-write", { path: "/etc/passwd" });
    pubsub.publish("ask-question", { id: SESSION });
    pubsub.publish("sessions", ROW);
    await until(() => published.length === 2, "the sessions row");
    expect(published.filter((message) => !isResync(message))).toEqual([{ host: "lx", row: ROW }]);
    expect(prompts).toEqual([]);
    // Nor is a fixed channel republished raw under the host's name, as a followed one would be.
    expect(others).toEqual([]);
  });

  // A remote cell's dialog is opened and answered from this machine's grid, keyed by the host.
  it("relays a dialog with the host, on a channel of its own", async () => {
    const { host, pubsub } = await remote();
    const { published, questions, others } = relayTo(() => [host]);
    await until(() => published.some(isResync), "resync on connect");
    await subscribed(pubsub);
    pubsub.publish("ask-question", { ...DIALOG, sessionId: "nope" });
    pubsub.publish("ask-question", DIALOG);
    await until(() => questions.length > 0, "a relayed dialog");
    expect(questions).toEqual([{ host: "lx", question: DIALOG }]);
    expect(others).toEqual([]);
  });

  // A remote cell's Prompts pane keeps up off this, as a local one does off `prompt-submitted`.
  it("relays a submitted prompt with the host, on a channel of its own", async () => {
    const { host, pubsub } = await remote();
    const { published, prompts } = relayTo(() => [host]);
    await until(() => published.some(isResync), "resync on connect");
    await subscribed(pubsub);
    pubsub.publish(PROMPT_SUBMITTED_CHANNEL, { sessionId: "not-a-uuid" });
    pubsub.publish(PROMPT_SUBMITTED_CHANNEL, { sessionId: SESSION });
    await until(() => prompts.length > 0, "a relayed prompt");
    expect(prompts).toEqual([{ host: "lx", sessionId: SESSION }]);
    expect(published.filter((message) => !isResync(message))).toEqual([]);
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

// #3506. A remote session's own channel is followed only while a browser listens to its Mac-side name,
// and republished there unchanged; when the last listener leaves, the remote is told to stop sending.
describe("the session relay's followed channels", () => {
  const CHANNEL = `toolcalls:${SESSION}`;
  const CALL = { toolUseId: "t1", toolName: "Bash", state: "running" };

  it("relays a followed channel under the host's name, and stops when it is let go", async () => {
    const { host, pubsub } = await remote();
    const { relay, published, others } = relayTo(() => [host]);
    await until(() => published.some(isResync), "resync on connect");
    relay.follow("lx", CHANNEL);
    await until(() => pubsub.subscriberCount(CHANNEL) === 1, "the follow on the remote");
    pubsub.publish(CHANNEL, CALL);
    pubsub.publish(`toolcalls:${"1".repeat(8)}-2222-4333-8444-555555555555`, CALL);
    await until(() => others.length > 0, "a relayed call");
    expect(others).toEqual([[`remote:lx:${CHANNEL}`, CALL]]);
    relay.unfollow("lx", CHANNEL);
    await until(() => pubsub.subscriberCount(CHANNEL) === 0, "the unfollow on the remote");
  });

  it("follows a channel asked for before its host connects, once it does", async () => {
    const { host, pubsub } = await remote();
    // The host is checked before it is attached: the follow arrives while there is no socket yet.
    const later: { follow: () => void } = { follow: () => {} };
    const { relay, published, others } = relayTo(
      () => [host],
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        later.follow();
        return true;
      },
    );
    later.follow = () => relay.follow("lx", CHANNEL);
    await until(() => published.some(isResync), "resync on connect");
    await until(() => pubsub.subscriberCount(CHANNEL) === 1, "the follow on connect");
    pubsub.publish(CHANNEL, CALL);
    await until(() => others.length > 0, "a relayed call");
    expect(others).toEqual([[`remote:lx:${CHANNEL}`, CALL]]);
  });
});

describe("followRemoteSessionChannels", () => {
  it("follows on a remote session channel's first listener and lets go on its last, and ignores any other room", () => {
    let listener: (room: string, subscribed: boolean) => void = () => {};
    const calls: string[] = [];
    followRemoteSessionChannels(
      { onSubscriptionChange: (given) => ((listener = given), () => {}) },
      { follow: (host, channel) => calls.push(`follow ${host} ${channel}`), unfollow: (host, channel) => calls.push(`unfollow ${host} ${channel}`) },
    );
    listener(`remote:lx:toolcalls:${SESSION}`, true);
    listener(`remote:lx:toolcalls:${SESSION}`, false);
    [`toolcalls:${SESSION}`, `remote:lx:toolcalls:nope`, `remote:lx:plugin:${SESSION}`, "sessions"].forEach((room) => listener(room, true));
    expect(calls).toEqual([`follow lx toolcalls:${SESSION}`, `unfollow lx toolcalls:${SESSION}`]);
  });
});
