// The headers an upgrade carries to a remote host (#3506). Pure.
//
// `origin` is dropped so the remote sees what it already trusts: a loopback peer (the tunnel) with no
// Origin, i.e. a local non-browser client (server/infra/http/allowed-origin.ts). Forwarding the
// Mac's page origin would work only while the remote happens to allow it, and says nothing true
// about the remote's own pages. `cookie` belongs to the Mac's origin and is not the remote's to read.
import type { IncomingHttpHeaders } from "node:http";

const DROPPED = new Set(["origin", "cookie", "host"]);

export function upstreamHeaders(headers: IncomingHttpHeaders, targetHost: string): Record<string, string | string[]> {
  const kept = Object.entries(headers).flatMap(([name, value]): [string, string | string[]][] =>
    value === undefined || DROPPED.has(name.toLowerCase()) ? [] : [[name, value]],
  );
  return { ...Object.fromEntries(kept), host: targetHost };
}

/** The remote's `101` as the bytes to hand the browser's socket, from the raw header pairs node gives. */
export function switchingProtocolsHead(statusMessage: string | undefined, rawHeaders: readonly string[]): string {
  const lines = [`HTTP/1.1 101 ${statusMessage || "Switching Protocols"}`];
  rawHeaders.forEach((value, i) => {
    if (i % 2 === 1) lines.push(`${rawHeaders[i - 1]}: ${value}`);
  });
  return [...lines, "", ""].join("\r\n");
}
