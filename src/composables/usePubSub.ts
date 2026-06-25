import { io, type Socket } from "socket.io-client";

// Minimal pub/sub client, modeled on mulmoclaude's usePubSub. A single shared
// socket multiplexes every channel; subscriptions are replayed on reconnect.
interface PubSubMessage {
  channel: string;
  data: unknown;
}

type Callback = (data: unknown) => void;
type Unsubscribe = () => void;

let socket: Socket | null = null;
const listeners = new Map<string, Set<Callback>>();
// Fired on every RE-connect (not the first connect). A subscriber that holds derived
// state — e.g. the notification list — re-syncs here, since pubsub only replays room
// membership on reconnect, not the events missed while disconnected.
const reconnectListeners = new Set<() => void>();
let hasConnected = false;

function connect(): Socket {
  if (socket) return socket;

  const sock = io({ path: "/ws/pubsub", transports: ["websocket"] });

  // Re-emit every live subscription so rooms survive a reconnect.
  sock.on("connect", () => {
    for (const channel of listeners.keys()) sock.emit("subscribe", channel);
    if (hasConnected) for (const cb of reconnectListeners) cb();
    hasConnected = true;
  });

  sock.on("data", (msg: PubSubMessage) => {
    const cbs = listeners.get(msg.channel);
    if (cbs) for (const handler of cbs) handler(msg.data);
  });

  socket = sock;
  return sock;
}

export function usePubSub() {
  function subscribe(channel: string, callback: Callback): Unsubscribe {
    let entry = listeners.get(channel);
    if (!entry) {
      entry = new Set();
      listeners.set(channel, entry);
    }
    entry.add(callback);

    const sock = connect();
    if (sock.connected) sock.emit("subscribe", channel);

    return () => {
      const cbs = listeners.get(channel);
      if (!cbs) return;
      cbs.delete(callback);
      if (cbs.size === 0) {
        listeners.delete(channel);
        if (socket?.connected) socket.emit("unsubscribe", channel);
      }
    };
  }

  // Register a callback fired on every reconnect (not the first connect). Returns an
  // unsubscribe. Lets a consumer re-fetch authoritative state after a dropped socket.
  function onReconnect(callback: () => void): Unsubscribe {
    reconnectListeners.add(callback);
    connect();
    return () => reconnectListeners.delete(callback);
  }

  return { subscribe, onReconnect };
}
