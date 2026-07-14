# feat: self-heal the RemoteHost session after a server restart

Issue: receptron/mulmoterminal#358

## Problem

RemoteHost is case-A' browser-parked: the session blob lives in `localStorage`
(`remoteHost.session`) and is re-pushed to the server via `POST /api/remote-host/reconnect`
(`tryAutoReconnect`). But that re-push was only triggered in `onMounted` — **on page load**.

So a server restart (dev `--watch`, crash, redeploy) while the tab stays open leaves the
server with no in-memory session, the UI still showing "connected", and every Web Push
silently no-oping (`result: null`) until a manual reload. This recurred repeatedly during
development. (Sibling mulmoclaude is the same case-A' model and also only restores on mount —
no live self-heal — so this is net-new here and can be ported back.)

## Fix (client-only — no server change, no server restart to ship)

Trigger the existing `refreshStatus() → tryAutoReconnect()` on the signals that mean
"the server may have come back / we returned":

- `usePubSub().onReconnect` — the socket.io reconnect event already used by
  `useSessions`/`useGridActivity`/`useNotifications` as the "server came back" signal.
- `window 'online'` and `document 'visibilitychange'` (only when becoming visible) — network
  and sleep/tab-refocus recovery.

No new heal logic — `tryAutoReconnect` already re-pushes the parked blob and drops it only on
a 401 (genuinely expired). Healing while already connected is a cheap no-op, so over-triggering
is safe.

## Files

- `src/components/remoteHostSelfHeal.ts` — pure `registerRemoteHostSelfHeal(heal, onReconnect)`
  returning a cleanup; split out so the wiring is testable without mounting the Firebase component.
- `src/components/remoteHostSelfHeal.spec.ts` — heals on each trigger; cleanup unregisters all;
  no heal on visibilitychange while going hidden.
- `src/components/RemoteHostControl.vue` — add `selfHeal()`, register on mount via `onReconnect`
  + the DOM listeners, unregister on unmount.

## Acceptance

- After a server restart with the tab open, the client re-pushes the parked session and
  `connected` returns to true with no manual reload; Web Push resumes.
- Gates green (format / lint / typecheck / build / test).
