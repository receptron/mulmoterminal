// Live attention state for the grid's REMOTE cells (#3506), keyed by remoteSessionKey(host, id). The
// counterpart of useGridActivity, kept apart so the local path is untouched: rows arrive on
// REMOTE_SESSIONS_CHANNEL from the server's relay, and are seeded per host from the forwarded
// activity route — at mount, when the cells change, on this page's reconnect, and on the relay's
// resync for that host (it reconnected to the remote, or lost it).
import { onMounted, onUnmounted, reactive, watch, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { fetchRemoteActivity } from "./remoteActivityApi";
import type { CellActivity } from "./sessionActivity";
import { parseRemoteSessionsMessage, REMOTE_SESSIONS_CHANNEL, remoteSessionKey } from "../../common/remoteHosts";
import type { RemoteCellSession } from "../components/remoteCell";

export function useRemoteGridActivity(sessions: Ref<readonly RemoteCellSession[]>) {
  const activity = reactive(new Map<string, CellActivity>());
  // Bumped by every push for a key, so a seed answered after it does not put an older state back.
  const pushGen = new Map<string, number>();
  const latestSeed = new Map<string, number>();

  const idsOn = (host: string) => [...new Set(sessions.value.filter((session) => session.host === host).map((session) => session.id))];
  const hosts = () => [...new Set(sessions.value.map((session) => session.host))];

  async function seedHost(host: string): Promise<void> {
    const ids = idsOn(host);
    const seedId = (latestSeed.get(host) ?? 0) + 1;
    latestSeed.set(host, seedId);
    const gens = new Map(ids.map((id) => [id, pushGen.get(remoteSessionKey(host, id)) ?? 0]));
    const answer = await fetchRemoteActivity(host, ids);
    if (latestSeed.get(host) !== seedId) return;
    ids.forEach((id) => {
      const key = remoteSessionKey(host, id);
      if ((pushGen.get(key) ?? 0) !== gens.get(id)) return;
      const row = answer?.[id];
      if (row) activity.set(key, row);
      else activity.delete(key);
    });
  }
  const seedAll = () => hosts().forEach((host) => void seedHost(host));

  function apply(data: unknown): void {
    const message = parseRemoteSessionsMessage(data);
    if (!message) return;
    if ("resync" in message) return void seedHost(message.host);
    const { host, row } = message;
    if (!sessions.value.some((session) => session.host === host && session.id === row.id)) return;
    const key = remoteSessionKey(host, row.id);
    pushGen.set(key, (pushGen.get(key) ?? 0) + 1);
    if (row.event === "closed") activity.delete(key);
    else activity.set(key, { working: row.working, waiting: row.waiting, event: row.event });
  }

  const { subscribe, onReconnect } = usePubSub();
  let unsubscribe: (() => void) | undefined;
  let offReconnect: (() => void) | undefined;
  onMounted(() => {
    seedAll();
    unsubscribe = subscribe(REMOTE_SESSIONS_CHANNEL, apply);
    offReconnect = onReconnect(seedAll);
  });
  onUnmounted(() => {
    unsubscribe?.();
    offReconnect?.();
  });
  watch(sessions, seedAll);

  return { activity };
}
