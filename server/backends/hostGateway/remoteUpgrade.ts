// The WebSocket half of the remote-host gateway (#3506): `/remote/<id>/<terminal path>` is replayed
// to that host's MulmoTerminal and the two sockets are piped. A byte pipe, not a parse-and-resend,
// so the frames stay the remote's format and nothing here has to change when they do.
import { request, type ClientRequest, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { remotePathOf } from "../../../common/remoteHosts.js";
import { terminalWsKind } from "../../routes/terminal-ws-path.js";
import type { RemoteHost } from "./remoteHostsConfig.js";
import { switchingProtocolsHead, upstreamHeaders } from "./upstreamHeaders.js";

const UPSTREAM_CONNECT_TIMEOUT_MS = 5000;

export interface RemoteUpgradeDeps {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  /** Read per upgrade, so an edit to config.json applies to the next cell without a restart. */
  remoteHosts: () => readonly RemoteHost[];
}

export type RemoteUpgradeDecision = { kind: "not-remote" } | { kind: "refuse"; reason: string } | { kind: "forward"; host: RemoteHost; path: string };

/** What to do with an upgrade for `url`. Pure. Only the terminal endpoints are forwarded:
 *  `/remote/<id>/ws/pubsub` and any other path is refused rather than tunnelled. */
export function decideRemoteUpgrade(url: string, hosts: readonly RemoteHost[]): RemoteUpgradeDecision {
  const parsed = new URL(url, "http://localhost");
  const remote = remotePathOf(parsed.pathname);
  if (!remote) return { kind: "not-remote" };
  if (!terminalWsKind(remote.rest)) return { kind: "refuse", reason: `not a terminal endpoint: ${remote.rest}` };
  const host = hosts.find((candidate) => candidate.id === remote.id);
  if (!host) return { kind: "refuse", reason: `no remote host named ${remote.id}` };
  return { kind: "forward", host, path: `${remote.rest}${parsed.search}` };
}

function upstreamRequest(req: IncomingMessage, host: RemoteHost, path: string): ClientRequest {
  const target = new URL(host.origin);
  return request({
    hostname: target.hostname.replace(/^\[|\]$/g, ""),
    port: target.port,
    path,
    method: "GET",
    headers: upstreamHeaders(req.headers, target.host),
    timeout: UPSTREAM_CONNECT_TIMEOUT_MS,
  });
}

function joinSockets(socket: Duplex, head: Buffer, res: IncomingMessage, upstreamSocket: Duplex, upstreamHead: Buffer): void {
  socket.write(switchingProtocolsHead(res.statusMessage, res.rawHeaders));
  if (upstreamHead.length > 0) socket.write(upstreamHead);
  if (head.length > 0) upstreamSocket.write(head);
  upstreamSocket.on("error", () => socket.destroy());
  socket.on("error", () => upstreamSocket.destroy());
  upstreamSocket.pipe(socket).pipe(upstreamSocket);
}

function pipeUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, host: RemoteHost, path: string): void {
  const upstream = upstreamRequest(req, host, path);
  const fail = (reason: string) => {
    console.warn(`[remote-host] ${host.id}: ${reason}`);
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("timeout", () => fail(`no answer from ${host.origin} within ${UPSTREAM_CONNECT_TIMEOUT_MS}ms`));
  upstream.on("error", (err) => fail(`cannot reach ${host.origin}${path}: ${err.message}`));
  // Not a 101: the remote refused the upgrade. Its status reaches the browser as a failed handshake.
  upstream.on("response", (res) => {
    socket.end(`HTTP/1.1 ${res.statusCode ?? 502} ${res.statusMessage ?? ""}\r\nconnection: close\r\n\r\n`);
    res.resume();
  });
  upstream.on("upgrade", (res, upstreamSocket, upstreamHead) => {
    upstream.setTimeout(0);
    joinSockets(socket, head, res, upstreamSocket, upstreamHead);
  });
  upstream.end();
}

/** An upgrade listener's first step: true when the request was a remote path and has been dealt
 *  with (forwarded or refused), false to leave it to the local handlers. */
export function createRemoteUpgradeHandler(deps: RemoteUpgradeDeps) {
  return (req: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    const decision = decideRemoteUpgrade(req.url ?? "/", deps.remoteHosts());
    if (decision.kind === "not-remote") return false;
    // The Mac's own origin rule first, exactly as for a local terminal: a page that may not open a
    // terminal here may not open one on a remote either.
    if (!deps.isAllowedOrigin(req.headers.origin, req.socket?.remoteAddress)) {
      console.warn(`[remote-host] rejected cross-origin upgrade from ${req.headers.origin}`);
      socket.destroy();
      return true;
    }
    if (decision.kind === "refuse") {
      console.warn(`[remote-host] refused ${req.url}: ${decision.reason}`);
      socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n");
      return true;
    }
    pipeUpgrade(req, socket, head, decision.host, decision.path);
    return true;
  };
}
