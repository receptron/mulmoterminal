# fix: a request timeout says it timed out (#3293)

## Problem

A user saw `Failed to load: signal is aborted without reason` on Collections and on every single
collection. A restart cleared it. `fetchWithTimeout` ends a request at its deadline with a bare
`abort()`, and the browser's text for that tells the user neither that it was a timeout nor what to
do. Every `/api` read in the UI goes through that helper, so this affects every surface that shows
an error message. Collections is where it was seen.

## Change

- `src/utils/requestTimeout.ts`: `requestTimeoutError(timeout_ms)` builds a `DOMException` named
  `TimeoutError`, the name `AbortSignal.timeout` uses. Its message gives the wait in seconds and
  says to restart MulmoTerminal if the timeout keeps happening. `isRequestTimeout` recognises it.
- `fetchWithTimeout` aborts with that error as the reason. When the deadline has fired, its catch
  rethrows the deadline's reason whatever `fetch` rejected with, so the result does not depend on
  whether the runtime passes the abort reason through. A caller's own cancellation is still an
  `AbortError`.
- The message is in the UI language. Five bundles live under `src/i18n/requestTimeout/`, and
  `src/i18n/index.ts` installs the translated text with `setRequestTimeoutText`. The util does not
  import vue-i18n, because it sits under every `/api` call and every spec that fetches. English is
  the default until the text is installed.
- `pluginDispatchDeadline.ts` and `CellLaunchForm.vue` already replace a deadline abort with their
  own wording ("gave no answer within N minutes", "Timed out waiting for git"). They now recognise
  the new error as well as `AbortError`.

## Not changed

- The deadlines themselves.
- Why the server stopped answering in the reported case. There is no log, and a restart cleared it.
- A body that stalls after the headers arrive does not pass through the helper's catch. That
  rejection carries the signal's reason, which the Fetch spec requires and Chromium and WebKit do.

## Verification

- `yarn test`. The specs pin the timeout message, its name, that the reason reaches `fetch`, that a
  bare `AbortError` from `fetch` is still reported as the timeout, that a caller's cancellation
  stays an `AbortError`, and the message in each UI locale.
- In a real browser, against a scratch-HOME server built from this branch, `/api/collections/**`
  was held past the deadline. Chromium showed the English message and WebKit the Japanese one. With
  no delay, the page loaded with no error.
