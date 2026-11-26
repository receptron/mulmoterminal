// The remote hosts' session rows, relayed onto this server's pub/sub (#3506 phase 2).
//
// One socket.io client per configured host, through the user's `ssh -L`, subscribed to `sessions`
// and `prompt-submitted` and nothing else. The browser never subscribes to a remote: the channel
// list here IS the allowlist, so what may cross does not depend on what a page asks for.
//
// Each message is copied field by field (remoteSessionRowOf) and republished with its host on
// REMOTE_SESSIONS_CHANNEL. A connect or a drop publishes a resync instead, since rows missed while
// down are not replayed and a dropped host's last row would otherwise read as its current state.
import { io } from "socket.io-client";
import {
  REMOTE_PROMPT_SUBMITTED_CHANNEL,
  REMOTE_SESSIONS_CHANNEL,
  remoteSessionRowOf,
  type RemotePromptSubmitted,
  type RemoteSessionRowMessage,
  type RemoteSessionsMessage,
} from "../../../common/remoteHosts.js";
import { PROMPT_SUBMITTED_CHANNEL, isPromptSubmittedEvent } from "../../../common/promptChannel.js";
import { SESSION_ID_RE } from "../../config/env.js";
import type { RemoteHost } from "./remoteHostsConfig.js";

const RELAYED_CHANNEL = "sessions";
const RELAYED_CHANNELS = [RELAYED_CHANNEL, PROMPT_SUBMITTED_CHANNEL] as const;
// A host added to or removed from config.json is noticed on this tick; nothing watches the file.
export const RELAY_RECONCILE_MS = 15_000;

/** The part of a socket.io client the relay uses, so a spec can hand in its own. */
export interface RelaySocket {
  on(event: "connect" | "disconnect", listener: () => void): unknown;
  on(event: "data", listener: (message: unknown) => void): unknown;
  emit(event: "subscribe", channel: string): unknown;
  close(): unknown;
}

export interface RemoteSessionsRelayDeps {
  hosts: () => readonly RemoteHost[];
  /** Whether `host` may be relayed now: it answers, with this server's major version. */
  usable: (host: RemoteHost) => Promise<boolean>;
  publish: (channel: string, data: RemoteSessionsMessage | RemotePromptSubmitted) => void;
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

function dataOf(message: unknown, channel: string): unknown {
  if (typeof message !== "object" || message === null || !("channel" in message) || message.channel !== channel) return undefined;
  return "data" in message ? message.data : undefined;
}

interface Relayed {
  origin: string;
  socket: RelaySocket;
}

export function startRemoteSessionsRelay(deps: RemoteSessionsRelayDeps): { reconcile: () => Promise<void>; stop: () => void } {
  const connect = deps.connect ?? connectSocketIo;
  const open = new Map<string, Relayed>();
  const pending = new Set<string>();

  const resync = (id: string) => deps.publish(REMOTE_SESSIONS_CHANNEL, { host: id, resync: true });

  function attach(host: RemoteHost) {
    const socket = connect(host.origin);
    socket.on("connect", () => {
      RELAYED_CHANNELS.forEach((channel) => socket.emit("subscribe", channel));
      resync(host.id);
    });
    socket.on("disconnect", () => resync(host.id));
    socket.on("data", (message) => {
      const relayed = relayMessage(host.id, dataOf(message, RELAYED_CHANNEL));
      if (relayed) deps.publish(REMOTE_SESSIONS_CHANNEL, relayed);
      const prompt = relayPrompt(host.id, dataOf(message, PROMPT_SUBMITTED_CHANNEL));
      if (prompt) deps.publish(REMOTE_PROMPT_SUBMITTED_CHANNEL, prompt);
    });
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
    stop: () => {
      clearInterval(timer);
      [...open.keys()].forEach(detach);
    },
  };
}
