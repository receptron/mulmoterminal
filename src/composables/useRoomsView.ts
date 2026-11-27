// Navigation seam for the full-screen rooms overlay (#1456) — same shape as useAccountingView.
//
// The open ROOM is the URL, so a conversation can be linked to, reloaded, and walked back through
// with the browser's own buttons. That matters more here than for the other overlays: a room is a
// record somebody will want to point at afterwards.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";
import { isRoomId } from "../../common/roomMessage";
import { lastPlaceIn } from "./overlayLastPlace";

const lastRoomsPlace = lastPlaceIn(new Set(["rooms", "roomView"]));

/** Open the rooms overlay, on one room when given. */
export function roomsViewOpen(room?: string): void {
  const last = lastRoomsPlace();
  if (room === undefined && last !== null) {
    void router.push({ path: last, state: overlayOriginState() });
    return;
  }
  const to = room && isRoomId(room) ? { name: "roomView", params: { room } } : { name: "rooms" };
  void router.push({ ...to, state: overlayOriginState() });
}

export function roomsViewClose(): void {
  void router.push(overlayReturnPath());
}

/** Move between rooms INSIDE the overlay with `replace`, so closing returns to the view the
 *  overlay was opened from rather than walking back through every room that was looked at. */
export function roomsViewSelect(room: string): void {
  void router.replace({ name: "roomView", params: { room }, state: overlayOriginState() });
}

export function useRoomsView(): { isOpen: ComputedRef<boolean>; room: ComputedRef<string | null>; close: () => void } {
  const route = computed(() => router.currentRoute.value);
  return {
    isOpen: computed(() => route.value.name === "rooms" || route.value.name === "roomView"),
    room: computed(() => {
      const raw = route.value.params.room;
      return typeof raw === "string" && isRoomId(raw) ? raw : null;
    }),
    close: roomsViewClose,
  };
}
