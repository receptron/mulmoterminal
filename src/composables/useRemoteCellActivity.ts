// A remote cell's activity (#3506): the rows the server relays for its host and session, applied
// the way a local cell applies a `sessions` push, and seeded from the forwarded activity route at
// mount, on a new session id, on this page's reconnect and on the relay's resync for the host.
import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { fetchRemoteActivity } from "./remoteActivityApi";
import { parseRemoteSessionsMessage, REMOTE_SESSIONS_CHANNEL, type RemoteSessionRow } from "../../common/remoteHosts";
import type { ActivityPush } from "../components/cellActivity";

/** What a cell applies from a relayed row: the fields a local push carries, each only when the row
 *  carries it — an absent key keeps what is shown, which a null would clear (applyActivityPush). */
export function activityPushOfRow(row: RemoteSessionRow): ActivityPush {
  const push: ActivityPush = { working: row.working, waiting: row.waiting, event: row.event };
  if (row.lastPrompt !== undefined) push.lastPrompt = row.lastPrompt;
  if (row.aiTitle !== undefined) push.aiTitle = row.aiTitle;
  if (row.memo !== undefined) push.memo = row.memo;
  return push;
}

const UNKNOWN: ActivityPush = { working: false, waiting: false, event: null };

export function useRemoteCellActivity(host: string, sessionId: Ref<string | null>, apply: (push: ActivityPush) => void): void {
  // Bumped by every push, so a seed answered after one does not put an older state back.
  let pushGen = 0;

  async function seed(): Promise<void> {
    const id = sessionId.value;
    if (!id) return;
    const genBefore = pushGen;
    const answer = await fetchRemoteActivity(host, [id]);
    // Unreadable (the remote is down, or the tunnel): nothing is known, and "working" from before
    // the drop is the one thing that is surely stale. The cell already says it is disconnected.
    const row = answer === null ? UNKNOWN : answer[id];
    if (row && pushGen === genBefore && id === sessionId.value) apply(row);
  }

  function onMessage(data: unknown): void {
    const message = parseRemoteSessionsMessage(data);
    if (!message || message.host !== host) return;
    if ("resync" in message) return void seed();
    if (message.row.id !== sessionId.value) return;
    pushGen++;
    apply(activityPushOfRow(message.row));
  }

  const { subscribe, onReconnect } = usePubSub();
  let unsubscribe: (() => void) | undefined;
  let offReconnect: (() => void) | undefined;
  onMounted(() => {
    unsubscribe = subscribe(REMOTE_SESSIONS_CHANNEL, onMessage);
    offReconnect = onReconnect(() => void seed());
    void seed();
  });
  onUnmounted(() => {
    unsubscribe?.();
    offReconnect?.();
  });
  watch(sessionId, () => void seed());
}
