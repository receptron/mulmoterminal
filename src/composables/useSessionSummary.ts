import { ref, watch, onScopeDispose, type Ref, type ComputedRef, computed } from "vue";
import { EMPTY_SESSION_META, mergeSessionMeta, type SessionMetaView } from "../components/rosterPhase";
import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

// What ONE session is doing, in the words the cockpit roster uses: the AI summary, the prompt it is
// answering, the tail of its last reply (#2001).
//
// The roster reads the same endpoint for every cell it LISTS, into a cache it fills while it is on
// screen and prunes against those cells. This is the one-session case: the collection pane needs an
// answer for the tab it is showing, whether or not the roster has ever been opened, and it needs it
// to survive a prune it takes no part in. Same endpoint, same merge, separate lifetime — sharing
// the map would tie the pane's line to whether a different view happens to be open.
//
// `GET /api/session/:id` reads the transcript on disk, so it is current even for a session this
// build did not spawn, and a poll is what keeps it moving while the pane is open.

/** How often the pane re-reads. The roster polls on the same order; a summary that is a few seconds
 *  behind is still the answer to "what is it doing", and the read costs a transcript tail. */
const POLL_MS = 4000;

export function useSessionSummary(sessionId: Ref<string | null> | ComputedRef<string | null>): ComputedRef<SessionMetaView> {
  const meta = ref<SessionMetaView>(EMPTY_SESSION_META);
  // Only the newest answer may be applied: polls overlap, and an older one describes a moment that
  // has already been overtaken — applying it puts back what the newer answer replaced. The same
  // guard the roster's own seed carries, for the same reason (#620).
  let latest = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function read(id: string): Promise<void> {
    const seed = ++latest;
    try {
      const res = await fetchWithTimeout(`/api/session/${id}`);
      if (!res.ok || seed !== latest) return;
      const body: unknown = await res.json();
      if (seed !== latest) return;
      // Merged, never overwritten: a transcript this build cannot find answers with nulls, and
      // those must not wipe a summary already on screen.
      meta.value = mergeSessionMeta(meta.value, isRecord(body) ? body : {});
    } catch {
      // best-effort — the next poll retries
    }
  }

  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  watch(
    sessionId,
    (id) => {
      stop();
      latest += 1; // whatever is still in flight describes the session we just left
      meta.value = EMPTY_SESSION_META;
      if (!id) return;
      void read(id);
      timer = setInterval(() => void read(id), POLL_MS);
    },
    { immediate: true },
  );

  // The scope's, not the component's: `onScopeDispose` fires for a component unmount AND for an
  // effectScope, so the poll is stopped by whatever owns it rather than only by a component.
  onScopeDispose(stop);

  return computed(() => meta.value);
}
