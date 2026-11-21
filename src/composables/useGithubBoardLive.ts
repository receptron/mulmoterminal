// Keeping the GitHub board current while it is open (#3182): its cells follow the `sessions` channel
// the grid listens to, and the board is read again on a slow tick while visible and shortly after a
// cell on it finishes a turn. A terminal that closes leaves its card at once, and one that opens
// anywhere has the board read again shortly (#3363).
import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from "vue";
import type { RepoBoard } from "../../common/githubBoard";
import { isPtyOpenedEvent, PTY_OPENED_CHANNEL } from "../../common/ptyOpenedChannel";
import { boardSessionIds, closesAfter, finishedTurns, withLiveCells, withoutClosedCells } from "../components/boardLive";
import { parseSessionActivityPayload } from "./sessionActivity";
import { useGridActivity } from "./useGridActivity";
import { usePollWhileVisible } from "./usePollWhileVisible";
import { usePubSub } from "./usePubSub";

// GitHub state changes on a scale of minutes; each read is a few `gh` calls per repo.
export const BOARD_POLL_MS = 60_000;
// Long enough for a push the agent just made to show up in `gh pr list`.
export const BOARD_TURN_RELOAD_DELAY_MS = 3_000;
// Session ids are uuids; a newline is never part of one.
const SESSION_KEY_SEPARATOR = "\n";

export interface GithubBoardLive {
  /** The cards with their cells as they are now, which is what every view reads. */
  liveRepos: ComputedRef<RepoBoard[]>;
  /** Called as a read is sent; its answer goes to readApplied, so closes it already saw are let go. */
  readStarted: () => number;
  readApplied: (startedAt: number) => void;
}

export function useGithubBoardLive(repos: Ref<RepoBoard[]>, load: () => void): GithubBoardLive {
  // Through a string so the list only changes when its CONTENTS do: every read replaces `repos`, and
  // useGridActivity re-seeds /api/activity whenever the list it is handed changes.
  const sessionKey = computed(() => boardSessionIds(repos.value).join(SESSION_KEY_SEPARATOR));
  const sessionIds = computed(() => (sessionKey.value === "" ? [] : sessionKey.value.split(SESSION_KEY_SEPARATOR)));
  const { activity } = useGridActivity(sessionIds);

  usePollWhileVisible(load, BOARD_POLL_MS);

  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const reloadSoon = (): void => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, BOARD_TURN_RELOAD_DELAY_MS);
  };
  watch(
    () => new Map([...activity.entries()].map(([session, state]) => [session, state.working])),
    (now, before) => {
      if (finishedTurns(before, now).length > 0) reloadSoon();
    },
  );

  const tracking = useCloseTracking(reloadSoon);
  onUnmounted(() => clearTimeout(reloadTimer));

  return {
    liveRepos: computed(() => withoutClosedCells(withLiveCells(repos.value, activity), tracking.closed.value)),
    readStarted: tracking.readStarted,
    readApplied: tracking.readApplied,
  };
}

// The sessions closed since the board was read, each stamped from the counter reads also draw on,
// so a close can be ordered against the read that answers it. A terminal opening calls `opened`.
function useCloseTracking(opened: () => void) {
  let eventCount = 0;
  const closed = ref(new Map<string, number>());
  const forgetClose = (session: string): void => {
    if (!closed.value.has(session)) return;
    const next = new Map(closed.value);
    next.delete(session);
    closed.value = next;
  };
  const { subscribe } = usePubSub();
  const unsubscribers: (() => void)[] = [];
  onMounted(() => {
    unsubscribers.push(
      subscribe("sessions", (data) => {
        const update = parseSessionActivityPayload(data);
        if (update && "closed" in update) closed.value = new Map(closed.value).set(update.id, ++eventCount);
      }),
      subscribe(PTY_OPENED_CHANNEL, (data) => {
        if (!isPtyOpenedEvent(data)) return;
        forgetClose(data.sessionId);
        opened();
      }),
    );
  });
  onUnmounted(() => unsubscribers.forEach((off) => off()));
  return {
    closed,
    readStarted: (): number => ++eventCount,
    readApplied: (startedAt: number): void => {
      closed.value = closesAfter(closed.value, startedAt);
    },
  };
}
