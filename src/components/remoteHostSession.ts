// Client-side parking of the RemoteHost session blob (case A', mulmoserver#50) and
// the reconnect-outcome decision, split out of RemoteHostControl.vue so they're
// unit-testable without mounting the Firebase-importing component.

export interface RemoteHostStatus {
  connected: boolean;
  uid: string | null;
}

// The result of a /api/remote-host/* call: the status + parked blob on success, or
// an error with the HTTP status (0 for a network failure) so the caller can tell a
// genuinely-expired blob (401) from a transient failure.
export type FetchResult = { ok: true; status: RemoteHostStatus; session: string | null } | { ok: false; error: string; httpStatus: number };

// The server's Firebase session blob (refresh token included) parked in localStorage
// so a server restart can reconnect without a Google popup. Same-machine (localhost)
// trust model. Wrapped so a storage-disabled context (private mode) degrades to "no
// persistence" rather than throwing.
export const SESSION_KEY = "remoteHost.session";
const UNAUTHORIZED = 401;

export const loadStoredSession = (): string | null => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};

export const persistSession = (blob: string | null): void => {
  try {
    if (blob) localStorage.setItem(SESSION_KEY, blob);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable — reconnect just won't survive a restart
  }
};

// What to do with the parked blob after a reconnect attempt:
//  - park: success → store the (possibly rotated) blob from the response
//  - drop: 401 → the blob is genuinely expired/invalid, forget it (fall back to Connect)
//  - keep: any transient failure (network, 5xx) → keep the blob so a later retry works
export type ReconnectAction = "park" | "drop" | "keep";
export function reconnectAction(result: FetchResult): ReconnectAction {
  if (result.ok) return "park";
  if (result.httpStatus === UNAUTHORIZED) return "drop";
  return "keep";
}
