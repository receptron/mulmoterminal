import { Server as IOServer } from "socket.io";
import type { Server as HttpServer } from "node:http";

// Minimal socket.io pub/sub, modeled on mulmoclaude's server/events/pub-sub.
// Channel names are socket.io rooms — subscribe/unsubscribe map to
// socket.join / socket.leave, and publish broadcasts to the room.
// socket.io handles reconnect / heartbeat / transport for us.
export function createPubSub(server: HttpServer, isAllowedOrigin: (origin?: string) => boolean = () => true) {
  const io = new IOServer(server, {
    path: "/ws/pubsub",
    transports: ["websocket"],
    // Reject cross-origin connections so an untrusted website can't subscribe to
    // session activity. allowRequest covers the websocket handshake; cors covers
    // any polling/preflight.
    allowRequest: (req, cb) => cb(null, isAllowedOrigin(req.headers.origin)),
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("subscribe", (channel) => {
      if (typeof channel === "string") socket.join(channel);
    });
    socket.on("unsubscribe", (channel) => {
      if (typeof channel === "string") socket.leave(channel);
    });
  });

  return {
    publish(channel: string, data: unknown) {
      io.to(channel).emit("data", { channel, data });
    },
  };
}
