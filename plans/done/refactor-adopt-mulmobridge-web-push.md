# refactor: adopt `@mulmobridge/web-push` for the sendPush send core

Issue: receptron/mulmoterminal#354

## Goal

Make one package the single source of truth for the mulmoserver `sendPush` wire contract
(`{ data: { title, body } }` → `{ result: { sent, failed, targets } }`) so MulmoClaude and
MulmoTerminal can't drift when the contract changes. Pure refactor — no behavior change.

## What changes

- Add dep `@mulmobridge/web-push@^0.1.0` (first `@mulmobridge/*` dep in this repo).
- `server/web-push.ts`: delete the local `SEND_PUSH_URL` / `SEND_PUSH_TIMEOUT_MS` /
  `SendPushResult` / `buildSendPushBody` / `parseSendPushResult` / `sendWebPush` bodies;
  re-implement `sendWebPush(title, body)` as a thin wrapper over the package's
  `sendWebPush`, injecting the existing `currentIdToken` provider so **callers stay
  unchanged** (`server/index.ts:1134` still calls `void sendWebPush(title, body)`).
- `server/web-push.spec.ts`: the pure `buildSendPushBody` / `parseSendPushResult` unit
  tests now live in the package; keep only the wiring test (`sendWebPush` no-ops / never
  fetches when RemoteHost isn't signed in).

## What stays

- `notifyTaskFinished`, `pushEnabled`, and the `handleActivityHook` `Stop && !active`
  trigger in `server/index.ts` — untouched.
- RemoteHost auth (`currentIdToken` from `backends/remoteHost/session.ts`) — untouched.

## Verified against the installed package (0.1.0)

`sendWebPush(title, body, { getIdToken, url?, timeoutMs?, fetchImpl? }): Promise<SendPushResult | null>`,
`SendPushResult { sent, failed, targets }`, `buildSendPushBody`, `parseSendPushResult`,
`DEFAULT_SEND_PUSH_URL`. No-op (never fetches) when `getIdToken` yields null; 8 s
AbortController timeout; never throws — same guarantees as the code being removed.

## Acceptance

- `sendPush` still fires on a background task finish with a device registered.
- Local envelope/parse/URL logic removed; only the package is used.
- Gates green (format / lint / typecheck / typecheck:server / build / test).
