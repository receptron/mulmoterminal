// Wire the "the server may have come back / we returned to the tab" signals to a
// self-heal callback, returning a cleanup that unregisters every listener. Kept out
// of RemoteHostControl.vue so the trigger wiring is unit-testable without mounting
// the Firebase-importing component (mirrors the remoteHostSession.ts split).
//
// The heal itself is a no-op when already connected, so firing a trigger spuriously
// only costs one status check — safe to over-trigger, never under-trigger.
type OnReconnect = (cb: () => void) => () => void;

export function registerRemoteHostSelfHeal(heal: () => void, onReconnect: OnReconnect): () => void {
  const onOnline = () => heal();
  // A tab going hidden ALSO fires visibilitychange; only a return to visible warrants a heal.
  const onVisible = () => {
    if (document.visibilityState === "visible") heal();
  };
  const stopReconnect = onReconnect(heal);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopReconnect();
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
