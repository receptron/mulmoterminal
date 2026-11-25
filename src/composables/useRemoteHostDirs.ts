// A remote host's default workspace and saved directories (#3506), read through this server, which
// asks the remote and answers only those fields. Never the remote's /api directly: the browser has
// no route to it, and the gateway is what decides which of its fields may leave.
import { onMounted, ref, type Ref } from "vue";
import { fetchJson } from "../utils/fetchJson";
import { parseRemoteHostDirsResponse, remoteHostDirsRoute, type RemoteHostDirs } from "../../common/remoteHosts";

export interface RemoteHostDirsState {
  dirs: Ref<RemoteHostDirs | null>;
  error: Ref<string | null>;
}

export function useRemoteHostDirs(hostId: string): RemoteHostDirsState {
  const dirs = ref<RemoteHostDirs | null>(null);
  const error = ref<string | null>(null);
  onMounted(async () => {
    const result = await fetchJson(remoteHostDirsRoute(hostId), parseRemoteHostDirsResponse);
    if (result.ok) dirs.value = result.data;
    else error.value = result.error;
  });
  return { dirs, error };
}
