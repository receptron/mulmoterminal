# feat: Web Push on task finish (#339)

## Goal

Send a Web Push to the user's registered devices when a background task finishes,
gated by a Settings on/off toggle. MulmoTerminal only *sends* — device registration
and delivery are the separate `mulmoserver` `sendPush` Cloud Function's job.

## Reference

`mulmoserver/docs/web-push-sending.md`:
- `POST https://asia-northeast1-<projectId>.cloudfunctions.net/sendPush`
- `Authorization: Bearer <Firebase Auth ID token>`, `Content-Type: application/json`
- Body `{ "data": { "title", "body" } }` → response `{ "result": { sent, failed, targets } }`
- Target devices resolve from the signed-in uid; the caller only needs to be signed in.

## Decisions

- **Server-side send** (not browser-side): works even when the browser tab is closed,
  as long as the machine/server is up — matching the "tell me when I'm away" value.
- **Auth** = the RemoteHost channel's Firebase sign-in (`server/backends/remoteHost/firebase.ts`,
  project `mulmoserver`, same as `sendPush`). `auth.currentUser.getIdToken()`. ⇒ **push only
  sends while RemoteHost is connected**; otherwise it's a silent no-op.
- **Trigger** = `handleActivityHook` on `event === "Stop" && !active` — one push per finished
  *background* turn (the pane the user is viewing is `active` → skipped, like the chime). Hooking
  the raw publish stream would double-fire, since a background Stop publishes twice (waiting+working).
- **Toggle** = a new `pushEnabled` global config field, read live at the hook so it takes effect
  without a restart. Mirrors the existing `soundFile` plumbing end to end.

## Changes

- `server/app-config.ts` — `pushEnabled: boolean` on `AppConfig` (+ `sanitizePushEnabled`, load/save).
- `server/config-routes.ts` — `pushEnabled` in GET/POST `/api/config`; live `getPushEnabled()`.
- `server/web-push.ts` (new) — `sendWebPush(title, body)` via the remote-host `auth`, with an
  `AbortController` timeout; pure `buildSendPushBody` / `parseSendPushResult`. No-ops when not signed in.
- `server/index.ts` — `notifyTaskFinished(sessionId)` (title = dir basename, body = last prompt),
  called from `handleActivityHook` on a background `Stop`.
- `src/composables/useAppConfig.ts` — singleton `pushEnabled` ref + `savePushEnabled` + load.
- `src/components/SettingsModal.vue` — "Web Push notifications" toggle (+ RemoteHost note).
- `src/App.vue` — wire `:push-enabled` / `@update-push-enabled`.
- `README.md` — document `pushEnabled` + the RemoteHost prerequisite.

## Verification

- Unit-tested: `sanitizePushEnabled`, config load/save round-trip with `pushEnabled`,
  `buildSendPushBody` / `parseSendPushResult`, and `sendWebPush` no-op when not signed in.
- Gates: format / lint (0 errors) / typecheck / build / test (1070).
- **Manual (user):** actual push delivery needs a Google sign-in (RemoteHost connected) and a
  registered device, so the user verifies end-to-end delivery.

## Possible follow-ups

- Also push on `Notification` (blocked / needs-input), not just Stop.
- Per-directory or per-session push opt-out.
- Browser-side fallback send when RemoteHost isn't connected.
