// The remote hosts the launch panel may offer (#3506). Asked once per panel open: the server probes
// each host as it answers, so a tunnel opened since the last open shows up as reachable.
import { onMounted, ref, type Ref } from "vue";
import { fetchJson } from "../utils/fetchJson";
import { parseRemoteHostsResponse, type RemoteHostSummary } from "../../common/remoteHosts";

export const REMOTE_HOSTS_ROUTE = "/api/remote-hosts";

export function useRemoteHosts(): { hosts: Ref<RemoteHostSummary[]> } {
  const hosts = ref<RemoteHostSummary[]>([]);
  onMounted(async () => {
    const result = await fetchJson(REMOTE_HOSTS_ROUTE, parseRemoteHostsResponse);
    // A failure offers no remote host, which is what a machine with none configured already shows.
    if (result.ok) hosts.value = result.data.hosts;
  });
  return { hosts };
}
