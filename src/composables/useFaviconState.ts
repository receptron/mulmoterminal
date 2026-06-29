// Drives the favicon off LIVE activity across EVERY session — the global "sessions"
// pub-sub stream the attention beep uses — so it never diverges from the beep and
// covers other-directory grid sessions too. The stream only carries transitions, so
// it's reconciled against the authoritative session list (useSessions: seeded on
// mount, refetched on each push, resynced on reconnect): that list's truth is adopted
// and any default-project session it stops reporting is pruned — the safety net that
// lets a missed "closed" (e.g. one that happened while the socket was down) recover.
import { computed, onUnmounted, ref, watch, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { useDynamicFavicon } from "./useDynamicFavicon";
import type { Session } from "./useSessions";

export type FaviconState = "idle" | "working" | "attention";

interface Activity {
  working: boolean;
  waiting: boolean;
}
interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
}
const isRecord = (d: unknown): d is Record<string, unknown> => typeof d === "object" && d !== null;
const isActivityMsg = (d: unknown): d is ActivityMsg => isRecord(d) && "id" in d;

// attention(waiting) wins over working wins over idle — matching the grid cell's own
// status priority, so the tab icon agrees with the cell border.
export function deriveFaviconState(activities: Iterable<Activity>): FaviconState {
  let working = false;
  for (const a of activities) {
    if (a.waiting) return "attention";
    if (a.working) working = true;
  }
  return working ? "working" : "idle";
}

const STATE_COLOR: Record<FaviconState, string> = {
  idle: "#8a8aa0", // slate — nothing happening
  working: "#4a8cff", // blue — Claude is thinking
  attention: "#e0a030", // amber — needs you
};

export function useFaviconState(sessions: Ref<Session[]>): void {
  const live = ref(new Map<string, Activity>());

  const { subscribe } = usePubSub();
  const unsubscribe = subscribe("sessions", (d) => {
    if (!isActivityMsg(d)) return;
    const next = new Map(live.value);
    if (d.event === "closed") next.delete(d.id);
    else next.set(d.id, { working: d.working ?? false, waiting: d.waiting ?? false });
    live.value = next;
  });
  onUnmounted(unsubscribe);

  // Reconcile with the authoritative list: adopt its truth and drop default-project
  // ids it no longer reports (cross-dir grid ids never appear here, so they stay,
  // pruned instead by their own "closed" event above).
  let prevAuthIds = new Set<string>();
  watch(
    sessions,
    (list) => {
      const next = new Map(live.value);
      const authIds = new Set<string>();
      for (const s of list) {
        authIds.add(s.id);
        next.set(s.id, { working: s.working, waiting: s.waiting });
      }
      for (const id of prevAuthIds) if (!authIds.has(id)) next.delete(id);
      prevAuthIds = authIds;
      live.value = next;
    },
    { immediate: true },
  );

  const color = computed(() => STATE_COLOR[deriveFaviconState(live.value.values())]);
  useDynamicFavicon(color);
}
