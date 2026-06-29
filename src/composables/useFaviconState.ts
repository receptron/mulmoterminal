// Drives the favicon off LIVE activity across every session — the same global
// "sessions" pub-sub stream the attention beep uses — so the icon reacts to
// background and other-directory grid sessions, not just the on-screen one.
import { computed, onUnmounted, ref } from "vue";
import { usePubSub } from "./usePubSub";
import { useDynamicFavicon } from "./useDynamicFavicon";

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
const isActivityMsg = (d: unknown): d is ActivityMsg => typeof d === "object" && d !== null && "id" in d;

// attention(waiting) wins over working wins over idle — matching the grid cell's
// own status priority, so the tab icon agrees with the cell border.
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

export function useFaviconState(): void {
  const activity = ref(new Map<string, Activity>());
  const { subscribe } = usePubSub();
  const unsubscribe = subscribe("sessions", (d) => {
    if (!isActivityMsg(d)) return;
    const next = new Map(activity.value);
    if (d.event === "closed") next.delete(d.id);
    else next.set(d.id, { working: d.working ?? false, waiting: d.waiting ?? false });
    activity.value = next;
  });
  onUnmounted(unsubscribe);

  const color = computed(() => STATE_COLOR[deriveFaviconState(activity.value.values())]);
  useDynamicFavicon(color);
}
