// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { createRemoteUpgradeHandler, decideRemoteUpgrade } from "../../../../server/backends/hostGateway/remoteUpgrade";
import { switchingProtocolsHead, upstreamHeaders } from "../../../../server/backends/hostGateway/upstreamHeaders";
import type { RemoteHost } from "../../../../server/backends/hostGateway/remoteHostsConfig";

const HOST: RemoteHost = { id: "r1", label: "r1", origin: "http://127.0.0.1:1" };

describe("decideRemoteUpgrade", () => {
  it("leaves every non-remote path to the local handlers", () => {
    ["/ws", "/ws/pubsub", "/ws/run?x=1", "/", "/remotex/r1/ws"].forEach((url) => expect(decideRemoteUpgrade(url, [HOST])).toEqual({ kind: "not-remote" }));
  });
  it("forwards a terminal endpoint with its query", () => {
    expect(decideRemoteUpgrade("/remote/r1/ws?session=abc&cols=80", [HOST])).toEqual({ kind: "forward", host: HOST, path: "/ws?session=abc&cols=80" });
    ["/ws/run", "/ws/launch", "/ws/codex", "/ws/cursor"].forEach((path) =>
      expect(decideRemoteUpgrade(`/remote/r1${path}`, [HOST])).toEqual({ kind: "forward", host: HOST, path }),
    );
  });
  it("refuses pub/sub, other paths and unknown hosts", () => {
    ["/remote/r1/ws/pubsub", "/remote/r1/api/sessions", "/remote/r1/", "/remote/r1/ws/", "/remote/r2/ws"].forEach((url) =>
      expect(decideRemoteUpgrade(url, [HOST]).kind).toBe("refuse"),
    );
    expect(decideRemoteUpgrade("/remote/r1/ws", []).kind).toBe("refuse");
  });
});

describe("upstreamHeaders", () => {
  it("drops origin, cookie and host, and names the remote as host", () => {
    const headers: IncomingHttpHeaders = {
      host: "localhost:34567",
      origin: "http://localhost:34567",
      cookie: "a=b",
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "k",
      "sec-websocket-version": "13",
    };
    expect(upstreamHeaders(headers, "127.0.0.1:34599")).toEqual({
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "k",
      "sec-websocket-version": "13",
      host: "127.0.0.1:34599",
    });
  });
});

describe("switchingProtocolsHead", () => {
  it("writes the status line and each raw header pair", () => {
    expect(switchingProtocolsHead("Switching Protocols", ["Upgrade", "websocket", "Sec-WebSocket-Accept", "x"])).toBe(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: x\r\n\r\n",
    );
    expect(switchingProtocolsHead(undefined, [])).toBe("HTTP/1.1 101 Switching Protocols\r\n\r\n");
  });
});

// Real sockets: a stub remote that echoes, and a gateway in front of it.
const echo = (ws: WebSocket) => ws.on("message", (data) => ws.send(`echo:${data.toString()}`));

describe("the gateway over real sockets", () => {
  let remote: Server;
  let gateway: Server;
  let remoteWss: WebSocketServer;
  let gatewayPort = 0;
  const seen: { url: string | undefined; origin: string | undefined; cookie: string | undefined }[] = [];

  const isAddressInfo = (value: unknown): value is AddressInfo => typeof value === "object" && value !== null && "port" in value;
  const listen = (server: Server) =>
    new Promise<number>((resolve, reject) =>
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (isAddressInfo(address)) resolve(address.port);
        else reject(new Error("no port"));
      }),
    );

  beforeAll(async () => {
    remote = createServer((_req, res) => res.writeHead(403).end());
    remoteWss = new WebSocketServer({ noServer: true });
    remote.on("upgrade", (req, socket, head) => {
      seen.push({ url: req.url, origin: req.headers.origin, cookie: req.headers.cookie });
      if (req.url?.includes("deny")) return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      remoteWss.handleUpgrade(req, socket, head, echo);
    });
    const remotePort = await listen(remote);
    const hosts: RemoteHost[] = [
      { id: "r1", label: "r1", origin: `http://127.0.0.1:${remotePort}` },
      { id: "dead", label: "dead", origin: "http://127.0.0.1:9" },
    ];
    const handler = createRemoteUpgradeHandler({
      isAllowedOrigin: (origin) => origin === undefined || origin.startsWith("http://localhost"),
      remoteHosts: () => hosts,
    });
    gateway = createServer((_req, res) => res.writeHead(404).end());
    gateway.on("upgrade", (req, socket, head) => {
      if (!handler(req, socket, head)) socket.end("HTTP/1.1 418 Local\r\n\r\n");
    });
    gatewayPort = await listen(gateway);
  });
  afterAll(async () => {
    remoteWss.close();
    await Promise.all([remote, gateway].map((server) => new Promise((resolve) => server.close(resolve))));
  });

  const open = (path: string, origin = "http://localhost:34567") =>
    new WebSocket(`ws://127.0.0.1:${gatewayPort}${path}`, { headers: { origin, cookie: "secret=1" } });

  const outcome = (ws: WebSocket) =>
    new Promise<string>((resolve) => {
      ws.on("open", () => resolve("open"));
      ws.on("unexpected-response", (_req, res) => resolve(`status ${res.statusCode}`));
      ws.on("error", () => resolve("error"));
    });

  it("carries frames both ways, with the query, and without the page's origin or cookie", async () => {
    const ws = open("/remote/r1/ws?session=abc&cols=80");
    expect(await outcome(ws)).toBe("open");
    const reply = new Promise<string>((resolve) => ws.on("message", (data) => resolve(data.toString())));
    ws.send("hello");
    expect(await reply).toBe("echo:hello");
    ws.close();
    expect(seen.at(-1)).toEqual({ url: "/ws?session=abc&cols=80", origin: undefined, cookie: undefined });
  });

  it("leaves a local path to the local handlers", async () => {
    expect(await outcome(open("/ws"))).toBe("status 418");
  });

  it("refuses a foreign origin before reaching the remote", async () => {
    const before = seen.length;
    expect(await outcome(open("/remote/r1/ws", "http://evil.example"))).toBe("error");
    expect(seen).toHaveLength(before);
  });

  it("refuses pub/sub, unknown hosts and non-terminal paths without reaching the remote", async () => {
    const before = seen.length;
    expect(await outcome(open("/remote/r1/ws/pubsub"))).toBe("status 404");
    expect(await outcome(open("/remote/nope/ws"))).toBe("status 404");
    expect(await outcome(open("/remote/r1/api/sessions"))).toBe("status 404");
    expect(seen).toHaveLength(before);
  });

  it("hands the browser the remote's own refusal", async () => {
    expect(await outcome(open("/remote/r1/ws?deny=1"))).toBe("status 403");
  });

  it("closes the socket when the remote is unreachable", async () => {
    expect(await outcome(open("/remote/dead/ws"))).toBe("error");
  });
});
