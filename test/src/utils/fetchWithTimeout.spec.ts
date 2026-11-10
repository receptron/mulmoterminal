// The one bounded fetch (#1393). What is pinned here is the part a hand-written copy got wrong or
// left out: composing the caller's own signal, and clearing the timer on the failure path.
import { describe, it, expect, vi, afterEach } from "vitest";

import { fetchWithTimeout, DEFAULT_REQUEST_TIMEOUT_MS } from "../../../src/utils/fetchWithTimeout";
import { isRequestTimeout } from "../../../src/utils/requestTimeout";

const TIMEOUT_TEXT = /did not answer within/;

const LATE_REJECT_MS = DEFAULT_REQUEST_TIMEOUT_MS * 2;

/** A fetch whose rejection reaches the caller only `delay_ms` after its signal aborts. */
function lateRejectingFetch(delay_ms: number): void {
  vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      const rejectLater = () => setTimeout(() => reject(signal?.reason), delay_ms);
      if (signal?.aborted) rejectLater();
      else signal?.addEventListener("abort", rejectLater);
    });
  });
}

/** A fetch that never answers, recording the signal it was handed. */
function hangingFetch(): { signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>((_resolve, reject) => {
      // Like the real fetch, an already-aborted signal rejects at once rather than never.
      if (init?.signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  });
  return { signals };
}

const ok = () => ({ ok: true, status: 200 }) as Response;

// By name rather than `instanceof`: under jsdom the abort reason a Node AbortController makes is
// not the DOMException the spec file sees.
const errorName = (err: unknown): string => (typeof err === "object" && err !== null && "name" in err ? String(err.name) : "");

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("answers normally when the server does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok()),
    );
    expect((await fetchWithTimeout("/api/thing")).ok).toBe(true);
  });

  it("gives up at the default deadline", async () => {
    vi.useFakeTimers();
    hangingFetch();
    // Asserted BEFORE the clock moves: attaching the handler afterwards leaves a moment where the
    // promise rejects with nothing listening, which Node reports as an unhandled rejection. It
    // survived locally and failed on CI, where the ordering is not the same.
    const settled = expect(fetchWithTimeout("/api/thing")).rejects.toThrow(TIMEOUT_TEXT);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    await settled;
  });

  // The mock rejects with its own bare AbortError, as a runtime that drops the abort reason does.
  // What reaches the caller must still be the timeout, not "signal is aborted without reason".
  it("reports the deadline as a timeout whatever fetch rejected with", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const outcome = fetchWithTimeout("/api/thing").catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    const err = await outcome;
    expect(isRequestTimeout(err)).toBe(true);
    expect(String(err)).toContain("within 8 seconds");
  });

  it("hands the deadline to fetch as the abort reason", async () => {
    vi.useFakeTimers();
    const { signals } = hangingFetch();
    const settled = fetchWithTimeout("/api/thing").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    await settled;
    expect(isRequestTimeout(signals[0]?.reason)).toBe(true);
  });

  // The reason this takes a parameter at all: the same codebase runs 90s for an LLM summary and
  // 300s for an upload, and the default would abort both.
  it("waits the whole of a longer deadline the caller asked for", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const pending = fetchWithTimeout("/api/slow", undefined, 90_000);
    let done = false;
    const settled = pending.then(
      () => (done = true),
      () => (done = true),
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS + 1);
    expect(done).toBe(false); // still going, where the default would have given up
    await vi.advanceTimersByTimeAsync(90_000);
    await settled;
    expect(done).toBe(true);
  });

  // A composable cancels on unmount by passing its own signal. Overwriting it would leave the
  // request running after the component that wanted it is gone.
  // Fake timers held STILL on purpose: with them running, the default deadline fires on its own
  // after 8s and the test passes whether or not the caller's signal was kept. Frozen, the only
  // thing that can settle this request is the caller — which is the thing being asserted.
  it("still honours the caller's own signal", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const caller = new AbortController();
    const outcome = fetchWithTimeout("/api/thing", { signal: caller.signal }).catch((err: unknown) => err);
    caller.abort();
    const err = await outcome;
    // A cancellation, not a timeout: an unmounting component must not be told the server was slow.
    expect(err).toBeInstanceOf(DOMException);
    expect(err instanceof DOMException ? err.name : "").toBe("AbortError");
    expect(isRequestTimeout(err)).toBe(false);
  });

  // The rejection can reach the catch AFTER the deadline fired even though the caller cancelled
  // first (Codex, #3294). The composed signal remembers which came first; the deadline controller
  // alone does not.
  it("keeps a cancellation a cancellation when its rejection lands after the deadline", async () => {
    vi.useFakeTimers();
    lateRejectingFetch(LATE_REJECT_MS);
    const caller = new AbortController();
    const outcome = fetchWithTimeout("/api/thing", { signal: caller.signal }).catch((err: unknown) => err);
    caller.abort();
    await vi.advanceTimersByTimeAsync(LATE_REJECT_MS);
    const err = await outcome;
    expect(isRequestTimeout(err)).toBe(false);
    expect(errorName(err)).toBe("AbortError");
  });

  it("treats a signal that was already aborted as a cancellation, even when its rejection is late", async () => {
    vi.useFakeTimers();
    lateRejectingFetch(LATE_REJECT_MS);
    const outcome = fetchWithTimeout("/api/thing", { signal: AbortSignal.abort() }).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(LATE_REJECT_MS);
    const err = await outcome;
    expect(isRequestTimeout(err)).toBe(false);
    expect(errorName(err)).toBe("AbortError");
  });

  it("keeps the caller's signal AND the deadline, whichever comes first", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const caller = new AbortController(); // never fired
    const settled = expect(fetchWithTimeout("/api/thing", { signal: caller.signal })).rejects.toThrow(TIMEOUT_TEXT);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    await settled;
  });

  // CodeRabbit on #1398: a caller can build the Request up front and put its signal there. Passing
  // an `init` at all replaces a Request's signal, so reading only `init.signal` dropped it.
  it("honours a signal carried on a Request rather than in the init", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const caller = new AbortController();
    const request = new Request("http://localhost/api/thing", { signal: caller.signal });
    const settled = expect(fetchWithTimeout(request)).rejects.toThrow(/abort/i);
    caller.abort();
    await settled;
  });

  // `{ signal: null }` is how fetch DETACHES a request from its controller. Reading the caller's
  // signal with `??` treated that as "absent" and re-attached it (Codex, #1398) — the opposite of
  // what was asked for. Checked against the runtime: an abort on the original controller reaches
  // a `new Request(req, {})` and does not reach a `new Request(req, { signal: null })`.
  it("lets a caller detach a Request's signal with an explicit null", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const caller = new AbortController();
    const request = new Request("http://localhost/api/thing", { signal: caller.signal });
    let settled = false;
    const pending = fetchWithTimeout(request, { signal: null }).then(
      () => (settled = true),
      () => (settled = true),
    );
    caller.abort();
    // Flushed properly rather than one microtask: the rejection would travel through
    // AbortSignal.any and the mock's listener, and checking too early passes either way — which
    // it did, and the mutation went undetected until this line was fixed.
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // detached, so the caller's abort is not ours to honour

    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS); // the deadline still applies
    await pending;
    expect(settled).toBe(true);
  });

  // The third case. `{ signal: undefined }` is what a spread of optional options produces, and
  // WebIDL reads it as absent — so the Request's own signal must survive it (Codex, #1398).
  it("treats an undefined signal as absent, keeping the Request's own", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const caller = new AbortController();
    const request = new Request("http://localhost/api/thing", { signal: caller.signal });
    // Built at runtime rather than written as a literal: this repo has exactOptionalPropertyTypes,
    // so a TypeScript caller CANNOT write `{ signal: undefined }` — which is precisely why the
    // helper still has to handle it. The value reaches it from JS, or from a spread whose types
    // were erased, and the type system is not there to stop it.
    const init: RequestInit = {};
    Object.defineProperty(init, "signal", { value: undefined, enumerable: true });
    const settled = expect(fetchWithTimeout(request, init)).rejects.toThrow(/abort/i);
    caller.abort(); // must still reach us: nothing was detached
    await settled;
  });

  it("passes the caller's method and body through untouched", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init) seen.push(init);
      return ok();
    });
    await fetchWithTimeout("/api/thing", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.body).toBe("{}");
  });

  // Codex on #1398: the deadline has to cover the BODY, not just time-to-headers. A response whose
  // headers arrive promptly and whose body then stalls is the shape that hangs — and it is the
  // shape `fetchMulmoMediaBlob` is built on, where `res.blob()` reads a whole movie.
  it("gives up on a body that stalls after the headers arrived", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      // headers now, body never
      const body = new Promise<string>((_resolve, reject) => {
        // A body errors with the signal's reason, per the Fetch spec; this is the one path that
        // reaches the caller without passing through fetchWithTimeout's own catch.
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
      return { ok: true, status: 200, text: () => body, json: () => body, blob: () => body } as unknown as Response;
    });
    const res = await fetchWithTimeout("/api/media");
    expect(res.ok).toBe(true); // the headers were fine
    const settled = expect(res.text()).rejects.toThrow(TIMEOUT_TEXT);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    await settled;
  });

  // A pending timer on a request that already failed would abort a controller nobody is listening
  // to, and on a long deadline it keeps a handle alive for that whole time.
  it("clears the timer when the request fails rather than times out", async () => {
    vi.useFakeTimers();
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("network down"))),
    );
    await expect(fetchWithTimeout("/api/thing")).rejects.toThrow(/network down/);
    expect(cleared).toHaveBeenCalled();
    cleared.mockRestore();
  });

  // Deliberately NOT cleared on success: `fetch` resolves at the headers, and disarming there is
  // what left the body unbounded. The armed timer is the thing the test above depends on.
  it("leaves the deadline armed after the headers, so the body is still covered", async () => {
    vi.useFakeTimers();
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok()),
    );
    await fetchWithTimeout("/api/thing");
    expect(cleared).not.toHaveBeenCalled();
    cleared.mockRestore();
  });
});
