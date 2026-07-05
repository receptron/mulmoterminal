<script setup lang="ts">
// Toolbar control for the remote-host command channel: drive MulmoTerminal from
// a phone (the mulmoserver PWA) over Firestore.
//
// Google sign-in popup (browser Firebase) → extract the Google OAuth idToken →
// POST it to /api/remote-host/connect, where the server signs in as the user and
// starts the Firestore command loop + presence heartbeat. The dropdown shows
// online/offline + the connected uid and offers Connect / Disconnect. Styling
// mirrors NotificationBell (dark palette, material-symbols-outlined, dropdown).
import { onUnmounted, ref, useTemplateRef } from "vue";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

import { auth } from "../config/firebase";

interface RemoteHostStatus {
  connected: boolean;
  uid: string | null;
}

// Mobile companion PWA — shown in the dropdown as help text (not fetched here).
const MOBILE_URL = "https://mulmoserver.web.app";

const open = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const status = ref<RemoteHostStatus>({ connected: false, uid: null });
const rootRef = useTemplateRef<HTMLElement>("root");

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function fetchStatus(
  url: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ ok: true; status: RemoteHostStatus } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      return { ok: false, error: (detail && typeof detail.error === "string" && detail.error) || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { status: RemoteHostStatus };
    return { ok: true, status: data.status };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

async function refreshStatus() {
  const result = await fetchStatus("/api/remote-host/status", "GET");
  if (result.ok) {
    status.value = result.status;
    error.value = null;
  } else {
    error.value = result.error;
  }
}

function onOutside(event: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) close();
}
function onEscape(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}
function openPanel() {
  open.value = true;
  window.addEventListener("pointerdown", onOutside);
  window.addEventListener("keydown", onEscape);
  refreshStatus().catch(() => undefined);
}
function close() {
  open.value = false;
  window.removeEventListener("pointerdown", onOutside);
  window.removeEventListener("keydown", onEscape);
}
function toggle() {
  if (open.value) close();
  else openPanel();
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
    close();
  } else {
    error.value = res.error;
  }
  busy.value = false;
}

onUnmounted(close);
</script>

<template>
  <div ref="root" class="remote-host">
    <button
      type="button"
      class="rh-btn"
      :class="{ active: open, connected: status.connected }"
      :aria-expanded="open"
      aria-haspopup="true"
      :title="status.connected ? 'Remote host connected' : 'Remote host'"
      aria-label="Remote host"
      @click="toggle"
    >
      <span class="material-symbols-outlined">smartphone</span>
    </button>

    <div v-if="open" class="rh-pop" role="group" aria-label="Remote host">
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
      </div>
    </div>
  </div>
</template>

<style scoped>
.remote-host {
  position: relative;
  display: inline-flex;
}

/* Mirrors App.vue's .launcher-btn (scoped styles don't cross component boundaries). */
.rh-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  height: 30px;
  width: 30px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 6px;
  cursor: pointer;
}
.rh-btn:hover,
.rh-btn.active {
  background: var(--bg-hover);
  color: var(--text);
}
.rh-btn.connected {
  color: #35c46a;
}
.rh-btn .material-symbols-outlined {
  font-size: 19px;
  line-height: 1;
}

.rh-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
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
</style>
