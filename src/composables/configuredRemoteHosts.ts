// The configured remote host ids (#3506), one list for the page. Asked the first time something
// needs it, so a machine with no remote cell never sends the request. A host removed from
// config.json while the page is open is noticed on the next load.
import { computed, ref, type ComputedRef, type Ref } from "vue";
import { fetchJson } from "../utils/fetchJson";
import { parseRemoteHostIds, REMOTE_HOST_IDS_ROUTE } from "../../common/remoteHosts";
import { remoteHostStatus, type ConfiguredHosts, type RemoteHostStatus } from "../components/remoteHostStatus";

const configured = ref<ConfiguredHosts>({ state: "loading" });
let asked = false;

async function load(): Promise<void> {
  const result = await fetchJson(REMOTE_HOST_IDS_ROUTE, parseRemoteHostIds);
  configured.value = result.ok ? { state: "known", ids: result.data } : { state: "failed" };
}

export function configuredRemoteHosts(): Ref<ConfiguredHosts> {
  if (!asked) {
    asked = true;
    void load();
  }
  return configured;
}

/** For specs: forget the answer, so the next caller asks again. */
export function resetConfiguredRemoteHosts(): void {
  asked = false;
  configured.value = { state: "loading" };
}

/** A cell's host status. A local cell answers "local" without asking for the list at all. */
export function useRemoteHostStatus(host: string | null | undefined): ComputedRef<RemoteHostStatus> {
  const local = remoteHostStatus(host, { state: "failed" }) === "local";
  const list = local ? null : configuredRemoteHosts();
  return computed(() => (list === null ? "local" : remoteHostStatus(host, list.value)));
}
