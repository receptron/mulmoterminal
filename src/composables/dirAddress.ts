// A directory as the per-directory reads key it (#3506): the bare path for one on this machine, and
// the host and path for one on a remote host. Pure.
//
// One string, so the caches and `Ref<string | null>` signatures those reads already have keep
// working unchanged; a NUL joins the two because no path can contain one. A local key is exactly the
// path it always was, so a local cell asks the same URLs as before.
import { remotePath } from "../../common/remoteHosts";
import { isRemoteHost } from "../components/remoteCell";

const SEPARATOR = "\0";

export interface DirAddress {
  host: string | null;
  cwd: string;
}

export const dirKeyOf = (host: string | null | undefined, cwd: string | null | undefined): string | null => {
  if (!cwd) return null;
  return isRemoteHost(host) ? `${host}${SEPARATOR}${cwd}` : cwd;
};

export function dirAddressOf(key: string): DirAddress {
  const split = key.indexOf(SEPARATOR);
  return split < 0 ? { host: null, cwd: key } : { host: key.slice(0, split), cwd: key.slice(split + 1) };
}

export const isRemoteDirKey = (key: string): boolean => dirAddressOf(key).host !== null;

/** `route` asked about the directory `key` names: this server's route, or the gateway's for a remote one. */
export function dirApiUrl(key: string, route: string, extra: Readonly<Record<string, string>> = {}): string {
  const { host, cwd } = dirAddressOf(key);
  const base = host === null ? route : remotePath(host, route);
  const params = [`cwd=${encodeURIComponent(cwd)}`, ...Object.entries(extra).map(([name, value]) => `${name}=${encodeURIComponent(value)}`)];
  return `${base}?${params.join("&")}`;
}
