// The remote hosts' session rows, relayed onto this server's pub/sub (#3506 phase 2).
//
// One socket.io client per configured host, through the user's `ssh -L`, subscribed to `sessions`
// `prompt-submitted` and `ask-question`, and to a remote session's own channel only while a browser listens to its
// Mac-side name (`remote:<host>:<kind>:<id>`, parseRemoteSessionChannel), whose kinds and id this
// server checks. The browser never subscribes to a remote itself.
//
// Each message is copied field by field (remoteSessionRowOf) and republished with its host on
// REMOTE_SESSIONS_CHANNEL. A connect or a drop publishes a resync instead, since rows missed while
// down are not replayed and a dropped host's last row would otherwise read as its current state.
import { io } from "socket.io-client";
import {
  REMOTE_ASK_QUESTION_CHANNEL,
  REMOTE_PROMPT_SUBMITTED_CHANNEL,
  REMOTE_SESSIONS_CHANNEL,
  remoteSessionRowOf,
  type RemoteAskQuestion,
  type RemotePromptSubmitted,
  type RemoteSessionRowMessage,
} from "../../../common/remoteHosts.js";
import { PROMPT_SUBMITTED_CHANNEL, isPromptSubmittedEvent } from "../../../common/promptChannel.js";
import { ASK_QUESTION_CHANNEL, isAskQuestionDone, isAskQuestionEvent } from "../../../common/askQuestion.js";
import { SESSION_ID_RE } from "../../config/env.js";
import type { RemoteHost } from "./remoteHostsConfig.js";

const RELAYED_CHANNEL = "sessions";
const RELAYED_CHANNELS = [RELAYED_CHANNEL, PROMPT_SUBMITTED_CHANNEL, ASK_QUESTION_CHANNEL] as const;
// A host added to or removed from config.json is noticed on this tick; nothing watches the file.
export const RELAY_RECONCILE_MS = 15_000;

/** The part of a socket.io client the relay uses, so a spec can hand in its own. */
export interface RelaySocket {
  on(event: "connect" | "disconnect", listener: () => void): unknown;
  on(event: "data", listener: (message: unknown) => void): unknown;
  emit(event: "subscribe" | "unsubscribe", channel: string): unknown;
  close(): unknown;
}

export interface RemoteSessionsRelayDeps {
  hosts: () => readonly RemoteHost[];
  /** Whether `host` may be relayed now: it answers, with this server's major version. */
  usable: (host: RemoteHost) => Promise<boolean>;
  /** A session channel's messages are republished as they came, so their data is the remote's own. */
  publish: (channel: string, data: unknown) => void;
  connect?: (origin: string) => RelaySocket;
  reconcile_ms?: number;
}

const connectSocketIo = (origin: string): RelaySocket => io(origin, { path: "/ws/pubsub", transports: ["websocket"], reconnection: true, forceNew: true });

/** The relayed message for one `sessions` message from `host`, or null when it carries no valid row. */
export function relayMessage(host: string, data: unknown): RemoteSessionRowMessage | null {
  const row = remoteSessionRowOf(data, (id) => SESSION_ID_RE.test(id));
  return row ? { host, row } : null;
}

/** The relayed message for one `prompt-submitted` message from `host`, or null when it names no session. */
export function relayPrompt(host: string, data: unknown): RemotePromptSubmitted | null {
  return isPromptSubmittedEvent(data) && SESSION_ID_RE.test(data.sessionId) ? { host, sessionId: data.sessionId } : null;
}

/** The relayed message for one `ask-question` message from `host`: a dialog opened or closed in a real
 *  session, or null for anything else. */
export function relayQuestion(host: string, data: unknown): RemoteAskQuestion | null {
  const dialog = isAskQuestionEvent(data) || isAskQuestionDone(data);
  return dialog && SESSION_ID_RE.test(data.sessionId) ? { host, question: data } : null;
}

function dataOf(message: unknown, channel: string): unknown {
  if (typeof message !== "object" || message === null || !("channel" in message) || message.channel !== channel) return undefined;
  return "data" in message ? message.data : undefined;
}

interface Relayed {
  origin: string;
  socket: RelaySocket;
}

export interface RemoteSessionsRelay {
  reconcile: () => Promise<void>;
  stop: () => void;
  /** Follow a remote session's own channel (parseRemoteSessionChannel) while a browser listens to it. */
  follow: (host: string, channel: string) => void;
  unfollow: (host: string, channel: string) => void;
}

/** The message on `channel` of a remote's frame, whatever channel that is, or undefined. */
function channelOf(message: unknown): string | undefined {
  return typeof message === "object" && message !== null && "channel" in message && typeof message.channel === "string" ? message.channel : undefined;
}

/** The session channels followed per host. Kept apart from the sockets: a channel followed before its
 *  host attaches, or across a drop, is subscribed when the socket (re)connects. */
function followedChannels() {
  const byHost = new Map<string, Set<string>>();
  const of = (host: string): Set<string> => byHost.get(host) ?? new Set();
  return {
    of,
    add(host: string, channel: string) {
      byHost.set(host, new Set([...of(host), channel]));
    },
    remove(host: string, channel: string) {
      byHost.set(host, new Set([...of(host)].filter((name) => name !== channel)));
    },
  };
}

/** One frame from `host`'s socket, republished on this server's channel for it, if it has one. */
function relayFrame(host: string, message: unknown, following: ReadonlySet<string>, publish: RemoteSessionsRelayDeps["publish"]): void {
  const relayed = relayMessage(host, dataOf(message, RELAYED_CHANNEL));
  if (relayed) publish(REMOTE_SESSIONS_CHANNEL, relayed);
  const prompt = relayPrompt(host, dataOf(message, PROMPT_SUBMITTED_CHANNEL));
  if (prompt) publish(REMOTE_PROMPT_SUBMITTED_CHANNEL, prompt);
  const question = relayQuestion(host, dataOf(message, ASK_QUESTION_CHANNEL));
  if (question) publish(REMOTE_ASK_QUESTION_CHANNEL, question);
  const channel = channelOf(message);
  if (channel !== undefined && following.has(channel)) publish(`remote:${host}:${channel}`, dataOf(message, channel));
}

export function startRemoteSessionsRelay(deps: RemoteSessionsRelayDeps): RemoteSessionsRelay {
  const connect = deps.connect ?? connectSocketIo;
  const open = new Map<string, Relayed>();
  const pending = new Set<string>();
  const followed = followedChannels();

  const resync = (id: string) => deps.publish(REMOTE_SESSIONS_CHANNEL, { host: id, resync: true });

  function attach(host: RemoteHost) {
    const socket = connect(host.origin);
    socket.on("connect", () => {
      [...RELAYED_CHANNELS, ...followed.of(host.id)].forEach((channel) => socket.emit("subscribe", channel));
      resync(host.id);
    });
    socket.on("disconnect", () => resync(host.id));
    socket.on("data", (message) => relayFrame(host.id, message, followed.of(host.id), deps.publish));
    open.set(host.id, { origin: host.origin, socket });
  }

  function detach(id: string) {
    open.get(id)?.socket.close();
    open.delete(id);
    resync(id);
  }

  async function tryAttach(host: RemoteHost) {
    pending.add(host.id);
    try {
      if (await deps.usable(host)) attach(host);
    } catch (err) {
      // Left unattached; the next tick asks again. A rejection here would be unhandled under `void`.
      console.warn(`[remote-sessions] could not check ${host.id} (${host.origin}): ${String(err)}`);
    } finally {
      pending.delete(host.id);
    }
  }

  async function reconcile() {
    const hosts = deps.hosts();
    [...open.entries()].filter(([id, relayed]) => !hosts.some((host) => host.id === id && host.origin === relayed.origin)).forEach(([id]) => detach(id));
    await Promise.all(hosts.filter((host) => !open.has(host.id) && !pending.has(host.id)).map(tryAttach));
  }

  void reconcile();
  const timer = setInterval(() => void reconcile(), deps.reconcile_ms ?? RELAY_RECONCILE_MS);
  timer.unref();
  return {
    reconcile,
    follow(host, channel) {
      followed.add(host, channel);
      open.get(host)?.socket.emit("subscribe", channel);
    },
    unfollow(host, channel) {
      followed.remove(host, channel);
      open.get(host)?.socket.emit("unsubscribe", channel);
    },
    stop: () => {
      clearInterval(timer);
      [...open.keys()].forEach(detach);
    },
  };
}
