// One bounded `fetch` for the whole UI (#1393).
//
// A request without a deadline does not fail — it does NOTHING, forever, and the screen cannot
// tell that apart from "there was nothing to show". Ten files had worked this out separately and
// written the same AbortController + setTimeout by hand; this is that, once.
//
// The default is 8s because that is what the majority of those ten already chose for a plain API
// read. It is a default rather than a rule: the same ten also run 90s for an LLM summary and 300s
// for an upload, and a blanket value would break exactly those. Pass `timeout_ms` when the call is
// not an ordinary one, and say in a comment why the number is what it is.

import { requestTimeoutError } from "./requestTimeout";

/** The deadline for an ordinary `/api` call — read a config, list a directory, save a setting. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

/**
 * For a route that shells out — `git worktree add`, a `gh` call, transcribing audio, spawning an
 * agent. The work is real and its length depends on the repository, the network or the machine,
 * so the default would abort a request that was going to succeed.
 *
 * Still bounded: an hour of nothing is not a better answer than a minute of nothing.
 */
export const SLOW_COMMAND_TIMEOUT_MS = 60_000;

/**
 * `fetch`, but it gives up.
 *
 * A `signal` the caller passes in its `init` is kept: it is how a composable cancels on unmount,
 * and dropping it would leave the request running after the component that wanted it is gone. The
 * two are composed, so whichever fires first wins.
 */
export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeout_ms: number = DEFAULT_REQUEST_TIMEOUT_MS): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(requestTimeoutError(timeout_ms)), timeout_ms);
  // A `Request` carries its own signal, so a caller that built the request up front rather than
  // passing an init here would otherwise lose its cancellation (CodeRabbit, #1398).
  //
  // Three cases, and `fetch` distinguishes all three — so this has to as well (Codex, #1398).
  // Verified against the runtime rather than read off the spec: build a Request on a controller,
  // abort it, and ask whether the derived request saw it.
  //
  //   { signal: someSignal }   the caller's own — compose with the deadline
  //   { signal: null }         an explicit DETACH; the Request's controller must not be re-attached
  //   { signal: undefined }    the same as absent, per WebIDL — inherit the Request's
  //
  // `??` collapsed the middle case into the last, and `"signal" in init` collapsed the last into
  // the middle. Comparing against `undefined` is the one test that separates all three.
  const inherited = input instanceof Request ? input.signal : null;
  const caller = init?.signal !== undefined ? init.signal : inherited;
  const signal = caller ? AbortSignal.any([caller, abort.signal]) : abort.signal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    // Disarmed ONLY here. `fetch` resolves when the headers arrive, so clearing the timer on the
    // way out would leave the body — `res.json()`, and `res.blob()` reading a whole movie —
    // unbounded, and a transfer that stalls mid-body would hang exactly as before (Codex, #1398).
    // Left armed, the deadline reaches the body too, because the signal is still the one the
    // response's stream is attached to.
    //
    // What that costs is a timer handle living until the deadline even after a request that
    // finished in milliseconds. The alternative — proxying the Response so a body reader disarms
    // it — buys back a few timers at the price of wrapping every response this app makes, and
    // `Response`'s accessors need their real receiver. Not worth it for a handle.
    clearTimeout(timer);
    // Our deadline's reason, not whatever `fetch` chose to reject with: a runtime that drops the
    // abort reason would otherwise bring back the message this reason exists to replace. Asked of
    // the composed signal, which keeps the FIRST reason: a caller that cancelled before the deadline
    // fired stays a cancellation even when the rejection reaches here after it.
    throw signal.aborted && signal.reason === abort.signal.reason ? abort.signal.reason : err;
  }
}
