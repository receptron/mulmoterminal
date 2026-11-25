// The `remoteHosts` entries of config.json, validated (#3506). Pure.
//
// A remote's URL must be plain http to a loopback LITERAL: the local end of an `ssh -L`, where SSH
// is the authentication. Nothing else here authenticates, so a URL anyone else could reach would
// hand them the remote's terminals. `localhost` is refused too, because a hosts file can point it
// anywhere (the same reason server/infra/http/loopback.ts asks the kernel rather than the string).
import { isRecord } from "../../../common/isRecord.js";
import { isRemoteHostId, type RemoteHostRejection } from "../../../common/remoteHosts.js";
import { isLoopbackAddress } from "../../infra/http/loopback.js";

export const REMOTE_HOSTS_MAX = 16;
export const REMOTE_HOST_LABEL_MAX = 32;

export interface RemoteHost {
  id: string;
  label: string;
  /** The origin to forward to, e.g. `http://127.0.0.1:34599`, with no path. */
  origin: string;
}

export interface RemoteHostsConfig {
  hosts: RemoteHost[];
  rejected: RemoteHostRejection[];
}

const unbracketed = (hostname: string): string => (hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname);

function originOf(url: unknown): { origin: string } | { reason: string } {
  if (typeof url !== "string") return { reason: "url is not a string" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { reason: `url is not a URL: ${url}` };
  }
  if (parsed.protocol !== "http:") return { reason: `url must be http:// (the local end of an ssh tunnel): ${url}` };
  if (!isLoopbackAddress(unbracketed(parsed.hostname))) return { reason: `url must be a loopback address such as 127.0.0.1: ${url}` };
  if (parsed.username || parsed.password) return { reason: `url must not carry credentials: ${url}` };
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return { reason: `url must be an origin with no path: ${url}` };
  return { origin: parsed.origin };
}

function entryOf(value: unknown, seen: ReadonlySet<string>): RemoteHost | { reason: string } {
  if (!isRecord(value)) return { reason: "entry is not an object" };
  if (!isRemoteHostId(value.id)) return { reason: "id must be lowercase letters, digits and -" };
  if (seen.has(value.id)) return { reason: `duplicate id: ${value.id}` };
  const origin = originOf(value.url);
  if ("reason" in origin) return origin;
  const label = typeof value.label === "string" && value.label.trim() ? value.label.trim().slice(0, REMOTE_HOST_LABEL_MAX) : value.id;
  return { id: value.id, label, origin: origin.origin };
}

export function parseRemoteHosts(input: unknown): RemoteHostsConfig {
  if (input === undefined) return { hosts: [], rejected: [] };
  if (!Array.isArray(input)) return { hosts: [], rejected: [{ index: -1, reason: "remoteHosts is not an array" }] };
  return input.reduce<RemoteHostsConfig>(
    (acc, value: unknown, index) => {
      if (acc.hosts.length >= REMOTE_HOSTS_MAX) return { ...acc, rejected: [...acc.rejected, { index, reason: `more than ${REMOTE_HOSTS_MAX} hosts` }] };
      const entry = entryOf(value, new Set(acc.hosts.map((host) => host.id)));
      return "reason" in entry ? { ...acc, rejected: [...acc.rejected, { index, reason: entry.reason }] } : { ...acc, hosts: [...acc.hosts, entry] };
    },
    { hosts: [], rejected: [] },
  );
}
