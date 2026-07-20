<script setup lang="ts">
// Toolbar control for the remote-host command channel: drive MulmoTerminal from
// a phone (the mulmoserver PWA) over Firestore.
//
// Google sign-in popup (browser Firebase) → extract the Google OAuth idToken →
// POST it to /api/remote-host/connect, where the server signs in as the user and
// starts the Firestore command loop + presence heartbeat. The dropdown shows
// online/offline + the connected uid and offers Connect / Disconnect. Trigger and
// panel chrome are shared with NotificationBell via toolbarPopover.css.
import { onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { renderSVG } from "uqr";

import { auth } from "../config/firebase";
// Session parking (localStorage) + reconnect-outcome decision live in a plain module
// so they're unit-testable without mounting this Firebase-importing component.
import { loadStoredSession, persistSession, reconnectAction, type FetchResult, type RemoteHostStatus } from "./remoteHostSession";
import { registerRemoteHostSelfHeal } from "./remoteHostSelfHeal";
import { useDropdownMenu } from "../composables/useDropdownMenu";
import { usePubSub } from "../composables/usePubSub";

// Mobile companion PWA — shown in the dropdown as help text (not fetched here).
const MOBILE_URL = "https://mulmoserver.web.app";
// Rendered to a data URL (uqr output is ASCII-only SVG) so no v-html is needed.
const qrDataUrl = `data:image/svg+xml;base64,${btoa(renderSVG(MOBILE_URL))}`;

const busy = ref(false);
const error = ref<string | null>(null);
const status = ref<RemoteHostStatus>({ connected: false, uid: null });
const rootRef = useTemplateRef<HTMLElement>("root");
const { open, close, toggle } = useDropdownMenu(rootRef, () => {
  refreshStatus().catch(() => undefined);
});

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function fetchStatus(url: string, method: "GET" | "POST", body?: unknown): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      return { ok: false, error: (detail && typeof detail.error === "string" && detail.error) || `HTTP ${res.status}`, httpStatus: res.status };
    }
    const data = (await res.json()) as { status: RemoteHostStatus; session: string | null };
    return { ok: true, status: data.status, session: data.session ?? null };
  } catch (err) {
    return { ok: false, error: errorText(err), httpStatus: 0 };
  }
}

async function refreshStatus() {
  const result = await fetchStatus("/api/remote-host/status", "GET");
  if (result.ok) {
    status.value = result.status;
    // Keep the parked blob fresh (the refresh token can rotate) — but never clear
    // it on a disconnected status, so an auto-reconnect still has it.
    if (result.session) persistSession(result.session);
    error.value = null;
  } else {
    error.value = result.error;
  }
}

// On load, if the server is disconnected but we have a parked session, restore it
// without a popup. A 401 means the blob is genuinely expired/invalid → drop it;
// transient failures KEEP it so a later retry/restart can still reconnect.
async function tryAutoReconnect() {
  if (status.value.connected) return;
  const blob = loadStoredSession();
  if (!blob) return;
  const res = await fetchStatus("/api/remote-host/reconnect", "POST", { session: blob });
  if (res.ok) status.value = res.status;
  const action = reconnectAction(res);
  if (action === "park" && res.ok) persistSession(res.session);
  else if (action === "drop") persistSession(null);
}

async function onConnect() {
  busy.value = true;
  error.value = null;
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = GoogleAuthProvider.credentialFromResult(result)?.idToken;
    if (!idToken) {
      error.value = "Could not obtain a Google sign-in token.";
      return;
    }
    const res = await fetchStatus("/api/remote-host/connect", "POST", { idToken });
    if (!res.ok) {
      error.value = res.error;
      return;
    }
    status.value = res.status;
    persistSession(res.session); // park the session for popup-free reconnect after a restart
    close();
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

async function onDisconnect() {
  busy.value = true;
  error.value = null;
  const res = await fetchStatus("/api/remote-host/disconnect", "POST");
  if (res.ok) {
    status.value = res.status;
    persistSession(null); // forget the parked session on an explicit disconnect
    close();
  } else {
    error.value = res.error;
  }
  busy.value = false;
}

// Re-check the real connection state and, if the server dropped our parked session
// (e.g. it restarted while this tab stayed open), re-push it popup-free.
function selfHeal() {
  return refreshStatus()
    .then(tryAutoReconnect)
    .catch(() => undefined);
}

// On mount: heal once. Then keep healing on the signals that mean the server may
// have come back or we returned to the tab — without this a server restart leaves
// the UI showing "connected" while every Web Push silently no-ops.
const pubsub = usePubSub();
let stopSelfHeal: (() => void) | null = null;
onMounted(() => {
  void selfHeal();
  stopSelfHeal = registerRemoteHostSelfHeal(() => void selfHeal(), pubsub.onReconnect);
});
onUnmounted(() => stopSelfHeal?.());
</script>

<template>
  <div ref="root" class="toolbar-popover-root">
    <button
      type="button"
      class="toolbar-popover-btn"
      :class="{ active: open, connected: status.connected }"
      :aria-expanded="open"
      aria-haspopup="true"
      :title="status.connected ? 'Remote host connected' : 'Remote host'"
      aria-label="Remote host"
      @click="toggle"
    >
      <span class="material-symbols-outlined">phonelink</span>
    </button>

    <div v-if="open" class="toolbar-popover rh-pop" role="group" aria-label="Remote host">
      <div class="rh-head">
        <span class="material-symbols-outlined rh-dot" :class="{ connected: status.connected }">
          {{ status.connected ? "check_circle" : "radio_button_unchecked" }}
        </span>
        <span class="rh-head-label">{{ status.connected ? "Online" : "Offline" }}</span>
      </div>

      <p v-if="status.uid" class="rh-uid">Signed in as {{ status.uid }}</p>

      <button v-if="!status.connected" type="button" class="rh-action connect" :disabled="busy" @click="onConnect">
        <span class="material-symbols-outlined">login</span>
        {{ busy ? "Connecting…" : "Connect (Google sign-in)" }}
      </button>
      <button v-else type="button" class="rh-action disconnect" :disabled="busy" @click="onDisconnect">
        <span class="material-symbols-outlined">logout</span>
        {{ busy ? "Disconnecting…" : "Disconnect" }}
      </button>

      <p v-if="error" class="rh-error">{{ error }}</p>

      <div class="rh-help">
        <p>Drive this terminal from your phone over a Firestore command channel — list collections, browse records, and start a chat.</p>
        <p>
          Open
          <a :href="MOBILE_URL" target="_blank" rel="noopener noreferrer" class="rh-link">{{ MOBILE_URL }}</a>
          on your phone, signed in with the same Google account.
        </p>
        <div class="rh-qr">
          <img :src="qrDataUrl" alt="" aria-hidden="true" />
          <p>Or scan this QR code with your phone's camera.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./toolbarPopover.css"></style>

<style scoped>
.toolbar-popover-btn.connected {
  color: #35c46a;
}

.rh-pop {
  width: 300px;
  gap: 8px;
  padding: 10px;
  font-family: system-ui, sans-serif;
}

.rh-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rh-dot {
  font-size: 16px;
  line-height: 1;
  color: var(--text-muted);
}
.rh-dot.connected {
  color: #35c46a;
}
.rh-head-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.rh-uid {
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 10px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.rh-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.rh-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.rh-action.connect {
  background: var(--accent-bg, #2f59c0);
  color: #fff;
}
.rh-action.disconnect {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
}
.rh-action.disconnect:hover:not(:disabled) {
  background: var(--bg-hover);
}
.rh-action .material-symbols-outlined {
  font-size: 16px;
  line-height: 1;
}

.rh-error {
  font-size: 11px;
  color: #e0533d;
  overflow-wrap: anywhere;
}

.rh-help {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}
.rh-link {
  font-family: ui-monospace, "JetBrains Mono", monospace;
  color: #6ea8fe;
  overflow-wrap: anywhere;
}

.rh-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding-top: 2px;
}
/* uqr's SVG carries its own white background, so it stays scannable on the dark panel. */
.rh-qr img {
  width: 128px;
  height: 128px;
  border-radius: 6px;
}
</style>
