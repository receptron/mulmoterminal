// Polling the launched server until it answers `/`, then firing onReady exactly once.
// Split out of mulmoterminal.js so the retry state machine is testable without a socket.

import { get as httpGet } from "node:http";

const PROBE_TIMEOUT_MS = 1000;
const RETRY_INTERVAL_MS = 300;
const DEFAULT_READY_TIMEOUT_MS = 15_000;

// One probe of the server: resolves "ready" if it answers, else "retry". It NEVER
// rejects, and yields exactly ONE outcome per call — the crucial guarantee. Destroying a
// timed-out request itself emits an 'error', so a single timeout would otherwise trigger
// both the timeout handler AND the error handler; each schedules a retry, the poll loop
// forks in two, and every fork fires onReady when the server finally answers — printing
// the banner and opening the browser several times. The `settled` latch collapses each
// request to one outcome.
export function probeOnce(get, port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const req = get({ host: "127.0.0.1", port, path: "/", timeout: timeoutMs }, (res) => {
      res.resume();
      done("ready");
    });
    req.on("error", () => done("retry"));
    req.on("timeout", () => {
      req.destroy();
      done("retry");
    });
  });
}

// Poll until the server answers, then call onReady once; give up after readyTimeoutMs so
// the launcher never hangs on a crash loop. Returns a cancel function — a raced/abandoned
// attempt stops polling so it can't fire a stale banner. `deps` is injectable for tests.
export function waitUntilReady(port, onReady, deps = {}) {
  const { get = httpGet, now = Date.now, timeoutMs = PROBE_TIMEOUT_MS, intervalMs = RETRY_INTERVAL_MS, readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS } = deps;
  const startedAt = now();
  let cancelled = false;
  let timer = null;
  const loop = async () => {
    if (cancelled) return;
    const outcome = await probeOnce(get, port, timeoutMs);
    if (cancelled) return;
    if (outcome === "ready") {
      onReady();
      return;
    }
    if (now() - startedAt > readyTimeoutMs) return;
    timer = setTimeout(loop, intervalMs);
  };
  loop();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
