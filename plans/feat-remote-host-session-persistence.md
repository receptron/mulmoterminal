# feat: RemoteHost session persistence — Phase 2 (mulmoterminal wiring)

Ref: mulmoserver#50 (design + decision: case A', browser-parked session).
Phase 1 (core API) & Phase 3 (mulmoclaude wiring) done in `@mulmoclaude/core@0.13.0`
+ receptron/mulmoclaude#2076. This is **Phase 2** — mirror that wiring in mulmoterminal.

## Problem

The mulmoterminal server's Firebase session (RemoteHost auth) was in-memory, so a
server restart dropped it and forced a re-login (Google popup). Web Push (which needs
RemoteHost connected) then silently stopped. See mulmoserver#50.

## Fix (case A': browser-parked session)

The browser parks the server's Firebase session blob (refresh token included) in
localStorage and hands it back on reconnect, so a restart reconnects without a popup.

- Bump `@mulmoclaude/core` `^0.12.1` → `^0.13.0` (export/seed-able persistence + restartable session).
- **`server/backends/remoteHost/firebase.ts`** — now exports only `firebaseConfig`
  (the static app/auth/firestore/storage handles are gone; the session controller
  opens a fresh app per (re)connect).
- **`server/backends/remoteHost/session.ts`** (new) — mirrors mulmoclaude's session
  controller: `signIn` / `restore` / `signOut` / `currentUid` / `currentFirestore` /
  `currentStorage` / `currentIdToken` / `exportSession` + `RemoteHostSessionExpiredError`.
  Backed by `createRemoteHostSession(firebaseConfig)`.
- **`server/backends/remoteHost/index.ts`** — wires `createRemoteHost` to the session
  (`signIn`/`restore`/`signOut`/`currentUid`, runner uses `currentFirestore()`); adds
  `POST /api/remote-host/reconnect { session }`; every response now carries
  `{ status, session }` (the blob) so the browser keeps its copy fresh; reconnect
  returns 401 for an expired/invalid blob (client drops it), 5xx for transient (client keeps it).
- **`onExpire.ts` / `ingestAttachments.ts`** — read the LIVE session's Storage via a
  getter (`currentStorage`), since the app changes per (re)connect.
- **`server/web-push.ts`** — gets the ID token from the session (`currentIdToken()`)
  instead of the removed static `auth` handle.
- **`src/components/RemoteHostControl.vue`** — park the blob in localStorage on
  connect / refresh on status; auto-reconnect popup-free on mount when disconnected +
  a parked blob exists; drop the blob only on an explicit disconnect or a 401.

## Gotchas respected (from mulmoclaude#2076, solved in core 0.13.0)

1. persistence passed as a **class** — handled by `createRemoteHostSession` (don't pass a custom persistence object).
2. non-destructive (re)connect — sign-in/uid check runs in the session `validate` step, before any teardown of a live session.
3. reconnect error classification — `isSeedableBlob` + uid check → `RemoteHostSessionExpiredError` → 401 only; transient → 5xx; client drops the blob only on 401.
4. `signOut` in try/finally — always clears handles + closes the session even if Firebase sign-out throws.

## Verification

- Gates: format / lint (0 errors) / typecheck / build / test (1079).
- Isolated server boots cleanly with the new session wiring (no eager Firebase init crash).
- **Manual (user):** the real Google-login → park → server restart → popup-free
  auto-reconnect flow needs the user's Google auth (same as mulmoclaude#2076 verified).

## Concurrency / multi-host (see mulmoserver#50)

- Distinct `hostId` per app ("mulmoterminal" vs MulmoClaude) → separate Firestore
  command queues, no double execution. Session blob is per-origin isolated.
