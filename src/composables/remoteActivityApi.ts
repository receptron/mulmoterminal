// The current activity of a remote host's sessions (#3506), read through this server, which asks the
// remote and answers three fields per id. Null when it could not be read: the remote is down, or the
// host was removed. A caller then knows nothing about those sessions, which is not the same as idle.
import { fetchJson } from "../utils/fetchJson";
import { remoteActivityOf, remoteHostActivityRoute, type RemoteActivity } from "../../common/remoteHosts";

export async function fetchRemoteActivity(host: string, ids: readonly string[]): Promise<RemoteActivity | null> {
  if (ids.length === 0) return {};
  const result = await fetchJson(`${remoteHostActivityRoute(host)}?ids=${encodeURIComponent(ids.join(","))}`, (raw) => remoteActivityOf(raw, ids));
  return result.ok ? result.data : null;
}
