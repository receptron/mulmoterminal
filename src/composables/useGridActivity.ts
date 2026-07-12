import { reactive, watch, onMounted, onUnmounted, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { parseSessionActivityPayload, type CellActivity } from "./sessionActivity";

// Live attention state (working / waiting / event) for a set of grid cell sessions,
// keyed by session id. Unlike the sidebar's /api/sessions list this includes
// dev-terminal (grid) sessions and is NOT capped by the list limit, so an OFF-PAGE
// (unmounted) cell still reports blocked/done — the fix for the grid's cross-page
// attention routing. Seeded from /api/activity (current in-memory state) and kept
// live from the "sessions" pub/sub payload.
export function useGridActivity(sessionIds: Ref<string[]>) {
  const activity = reactive(new Map<string, CellActivity>());

  function apply(data: unknown): void {
    const update = parseSessionActivityPayload(data);
    if (!update) return;
    if ("closed" in update) activity.delete(update.id);
    else activity.set(update.id, update.activity);
  }

  async function seed(): Promise<void> {
    const ids = [...new Set(sessionIds.value.filter(Boolean))];
    if (ids.length === 0) return;
    try {
      const res = await fetch(`/api/activity?ids=${encodeURIComponent(ids.join(","))}`);
      if (!res.ok) return;
      const data: Record<string, CellActivity> = await res.json();
      for (const [id, a] of Object.entries(data)) {
        activity.set(id, { working: !!a.working, waiting: !!a.waiting, event: a.event ?? null });
      }
    } catch {
      // Transient — the pub/sub stream catches up on the next activity change.
    }
  }

  const { subscribe, onReconnect } = usePubSub();
  let unsubscribe: (() => void) | undefined;
  let offReconnect: (() => void) | undefined;
  onMounted(() => {
    void seed();
    unsubscribe = subscribe("sessions", apply);
    // A dropped socket misses pushes; re-seed the authoritative state on reconnect.
    offReconnect = onReconnect(() => void seed());
  });
  onUnmounted(() => {
    unsubscribe?.();
    offReconnect?.();
  });
  // New cells (or a fresh session id after relaunch) need their current state seeded.
  watch(sessionIds, () => void seed());

  return { activity };
}
