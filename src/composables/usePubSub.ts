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

function connect(): Socket {
  if (socket) return socket;

  const sock = io({ path: "/ws/pubsub", transports: ["websocket"] });

  // Re-emit every live subscription so rooms survive a reconnect.
  sock.on("connect", () => {
    for (const channel of listeners.keys()) sock.emit("subscribe", channel);
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

  return { subscribe };
}
