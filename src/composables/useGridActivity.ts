import { reactive, watch, onMounted, onUnmounted, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { parseSessionActivityPayload, type CellActivity } from "./sessionActivity";
import { snapshotAppliesTo } from "./liveMerge";

// Live attention state (working / waiting / event) for a set of grid cell sessions,
// keyed by session id. Unlike the sidebar's /api/sessions list this includes
// dev-terminal (grid) sessions and is NOT capped by the list limit, so an OFF-PAGE
// (unmounted) cell still reports blocked/done — the fix for the grid's cross-page
// attention routing. Seeded from /api/activity (current in-memory state) and kept
// live from the "sessions" pub/sub payload.
export function useGridActivity(sessionIds: Ref<string[]>) {
  const activity = reactive(new Map<string, CellActivity>());

  // Sessions the live channel spoke for while a seed was in flight (#620 F3). The response is
  // authoritative as of when it was SENT, so it must not speak for these.
  let seeding = false;
  const touchedDuringSeed = new Set<string>();

  function apply(data: unknown): void {
    const update = parseSessionActivityPayload(data);
    if (!update) return;
    if (seeding) touchedDuringSeed.add(update.id);
    if ("closed" in update) activity.delete(update.id);
    else activity.set(update.id, update.activity);
  }

  async function seed(): Promise<void> {
    const ids = [...new Set(sessionIds.value.filter(Boolean))];
    if (ids.length === 0) return;
    seeding = true;
    touchedDuringSeed.clear();
    try {
      const res = await fetch(`/api/activity?ids=${encodeURIComponent(ids.join(","))}`);
      if (!res.ok) return;
      const data: Record<string, CellActivity> = await res.json();
      for (const [id, a] of Object.entries(data)) {
        if (!snapshotAppliesTo(id, touchedDuringSeed)) continue;
        activity.set(id, { working: !!a.working, waiting: !!a.waiting, event: a.event ?? null });
      }
    } catch {
      // Transient — the pub/sub stream catches up on the next activity change.
    } finally {
      seeding = false;
      touchedDuringSeed.clear();
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
