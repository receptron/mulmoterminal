// Send a Web Push via the mulmoserver `sendPush` Cloud Function when a task finishes
// (see mulmoserver docs/web-push-sending.md). We only POST { title, body }; the target
// devices are resolved server-side from the signed-in user's uid, and registration /
// delivery / dead-token pruning are the server's job. Auth comes from the RemoteHost
// channel's Firebase sign-in, so this no-ops whenever RemoteHost isn't connected.
import { auth } from "./backends/remoteHost/firebase.js";

// asia-northeast1 onCall endpoint for the `mulmoserver` project. Mirrors the firebase
// config in backends/remoteHost/firebase.ts — keep in sync if the project id changes.
export const SEND_PUSH_URL = "https://asia-northeast1-mulmoserver.cloudfunctions.net/sendPush";
const SEND_PUSH_TIMEOUT_MS = 8000;

export interface SendPushResult {
  sent: number;
  failed: number;
  targets: number;
}

// The onCall wire shape wraps the payload in `data`.
export function buildSendPushBody(title: string, body: string): string {
  return JSON.stringify({ data: { title, body } });
}

// The onCall response wraps the payload in `result`. Missing/!number counts read as 0.
export function parseSendPushResult(json: unknown): SendPushResult | null {
  if (typeof json !== "object" || json === null) return null;
  const result = (json as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return null;
  const r = result as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  return { sent: num(r.sent), failed: num(r.failed), targets: num(r.targets) };
}

// POST { title, body } to sendPush as the RemoteHost-signed-in user. Returns the delivery
// result, or null when nothing was sent (not signed in / network / timeout / non-2xx).
// Never throws — a failed push must not disturb the hook that triggered it.
export async function sendWebPush(title: string, body: string): Promise<SendPushResult | null> {
  const user = auth.currentUser;
  if (!user) return null; // RemoteHost not connected → no auth → nothing to send with
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_PUSH_TIMEOUT_MS);
  try {
    const idToken = await user.getIdToken();
    const res = await fetch(SEND_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
      body: buildSendPushBody(title, body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parseSendPushResult(await res.json());
  } catch {
    return null; // offline / aborted / bad JSON — silently skip; the beep still fired
  } finally {
    clearTimeout(timeout);
  }
}
