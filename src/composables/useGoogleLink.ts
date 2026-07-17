import { ref } from "vue";

// The /api/google/status payload. `linked` reflects a stored refresh token — the
// token itself never leaves the host. `pending` is true while a consent flow is
// waiting on the loopback listener.
export type ClientSecretPresence = "found" | "missing" | "ambiguous";

export interface GoogleStatus {
  linked: boolean;
  pending: boolean;
  clientSecret: ClientSecretPresence;
  lastError: string | null;
}

const REQUEST_TIMEOUT_MS = 8000;
const STATUS_POLL_INTERVAL_MS = 2000;
const MAX_POLL_BACKOFF_MS = 30_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const isPresence = (v: unknown): v is ClientSecretPresence => v === "found" || v === "missing" || v === "ambiguous";

function parseStatus(data: unknown): GoogleStatus | null {
  if (!isRecord(data)) return null;
  return {
    linked: data.linked === true,
    pending: data.pending === true,
    clientSecret: isPresence(data.clientSecret) ? data.clientSecret : "found",
    lastError: typeof data.lastError === "string" ? data.lastError : null,
  };
}

async function requestJson(url: string, method: "GET" | "POST"): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, signal: controller.signal });
    if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const backoffMs = (failures: number): number => Math.min(STATUS_POLL_INTERVAL_MS * 2 ** failures, MAX_POLL_BACKOFF_MS);

async function startAuthorize(): Promise<string> {
  const data = await requestJson("/api/google/authorize", "POST");
  const authUrl = isRecord(data) && typeof data.authUrl === "string" ? data.authUrl : "";
  if (!authUrl) throw new Error("no authUrl in response");
  return authUrl;
}

// A stoppable poll timer: once stopped, neither a pending timer nor a late
// in-flight response can restart the loop — a closed modal must stop fetching.
function createPoller(tick: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  return {
    stopped: () => stopped,
    schedule(delayMs: number, keepGoing: boolean): void {
      if (timer) clearTimeout(timer);
      timer = !stopped && keepGoing ? setTimeout(tick, delayMs) : null;
    },
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// Drives the Settings modal's Google account link. The consent itself completes
// out of band (browser → Google → the host's loopback listener), so while the
// server reports `pending` this polls until it flips — the server-side flow times
// out, so the loop terminates on its own. Transient fetch failures back off but
// never clear `pending`: it mirrors the server's state, not our reachability.
export function useGoogleLink() {
  const status = ref<GoogleStatus | null>(null);
  const busy = ref(false);
  const error = ref("");
  let failures = 0;
  const poller = createPoller(() => void refresh());
  const pollWhilePending = (delayMs: number) => poller.schedule(delayMs, Boolean(status.value?.pending));

  async function refresh(): Promise<void> {
    try {
      const parsed = parseStatus(await requestJson("/api/google/status", "GET"));
      if (poller.stopped()) return;
      failures = 0;
      status.value = parsed;
      error.value = parsed?.lastError ?? "";
      pollWhilePending(STATUS_POLL_INTERVAL_MS);
    } catch {
      if (poller.stopped()) return;
      failures += 1;
      error.value = "Couldn't load the Google link status.";
      pollWhilePending(backoffMs(failures));
    }
  }

  // Opens consent in a new tab; the link completes when the user approves there.
  // The follow-up poll is forced rather than conditional on `pending`: the flow is
  // live now regardless of what the last status said (or whether one ever loaded).
  async function connect(): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      window.open(await startAuthorize(), "_blank", "noopener");
      if (status.value) status.value.pending = true;
      failures = 0;
      poller.schedule(STATUS_POLL_INTERVAL_MS, true);
    } catch {
      error.value = "Couldn't start the Google sign-in.";
    } finally {
      busy.value = false;
    }
  }

  async function unlink(): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      await requestJson("/api/google/unlink", "POST");
      if (status.value) status.value.linked = false;
    } catch {
      error.value = "Couldn't unlink the Google account.";
    } finally {
      busy.value = false;
    }
  }

  return { status, busy, error, refresh, connect, unlink, dispose: poller.stop };
}
