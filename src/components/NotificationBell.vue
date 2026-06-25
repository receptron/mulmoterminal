<script setup lang="ts">
import { ref, onUnmounted, useTemplateRef } from "vue";
import { useNotifications, type NotifierEntry, type NotifierSeverity } from "../composables/useNotifications";

// Toolbar bell: a severity-coloured unread badge + a dropdown listing the active
// notifications. A row click navigates to the entry's target (a completion bell's
// pending record) WITHOUT clearing it — the watcher clears it when the record is
// done; the ✕ dismisses it explicitly. Mirrors MulmoClaude's bell.
const { count, topSeverity, sorted, dismiss, activate } = useNotifications();

const open = ref(false);
const rootRef = useTemplateRef<HTMLElement>("root");

function onOutside(e: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) close();
}
function onEscape(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
function openPanel() {
  open.value = true;
  window.addEventListener("pointerdown", onOutside);
  window.addEventListener("keydown", onEscape);
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

function onRowClick(entry: NotifierEntry) {
  // Navigate if it's a deep-linkable entry; close either way so the click feels live.
  activate(entry);
  close();
}

function severityClass(severity: NotifierSeverity): string {
  return `sev-${severity}`;
}

onUnmounted(close);
</script>

<template>
  <div ref="root" class="notif-bell">
    <button
      type="button"
      class="bell-btn"
      :class="{ active: open }"
      :aria-expanded="open"
      aria-haspopup="menu"
      :title="count ? `${count} notification${count === 1 ? '' : 's'}` : 'Notifications'"
      aria-label="Notifications"
      @click="toggle"
    >
      <span class="material-symbols-outlined">notifications</span>
      <span v-if="count" class="badge" :class="topSeverity ? severityClass(topSeverity) : ''">{{ count > 99 ? "99+" : count }}</span>
    </button>

    <div v-if="open" class="notif-pop" role="menu">
      <div class="notif-head">Notifications</div>
      <div v-if="!sorted.length" class="notif-empty">You're all caught up.</div>
      <ul v-else class="notif-list">
        <li v-for="entry in sorted" :key="entry.id" class="notif-row" :class="{ clickable: !!entry.navigateTarget }" role="menuitem" @click="onRowClick(entry)">
          <span class="dot" :class="severityClass(entry.severity)" aria-hidden="true"></span>
          <span class="notif-text">
            <span class="notif-title">{{ entry.title }}</span>
            <span v-if="entry.body" class="notif-body">{{ entry.body }}</span>
          </span>
          <button type="button" class="notif-dismiss" title="Dismiss" aria-label="Dismiss notification" @click.stop="dismiss(entry.id)">
            <span class="material-symbols-outlined">close</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.notif-bell {
  position: relative;
  display: inline-flex;
}

/* Mirrors App.vue's .launcher-btn (scoped styles don't cross component boundaries). */
.bell-btn {
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
.bell-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.bell-btn.active {
  background: var(--bg-hover);
  color: var(--text);
}
.bell-btn .material-symbols-outlined {
  font-size: 19px;
  line-height: 1;
}

/* Unread badge: severity-coloured pill at the top-right of the bell. */
.badge {
  position: absolute;
  top: 1px;
  right: 1px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  box-sizing: border-box;
  border-radius: 7px;
  font-family: system-ui, sans-serif;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  color: #fff;
  background: #9aa6cc;
}
.badge.sev-info {
  background: #9aa6cc;
}
.badge.sev-nudge {
  background: #e0a526;
}
.badge.sev-urgent {
  background: #e0533d;
}

.notif-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  /* Above the collections browse overlay (z-index 50, fills below the toolbar) so
     the dropdown stays visible when a navigation has opened it. */
  z-index: 60;
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.notif-head {
  padding: 6px 8px;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.notif-empty {
  padding: 14px 8px;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.notif-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.notif-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
}
.notif-row.clickable {
  cursor: pointer;
}
.notif-row.clickable:hover {
  background: var(--bg-hover);
}

.dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: #9aa6cc;
}
.dot.sev-info {
  background: #9aa6cc;
}
.dot.sev-nudge {
  background: #e0a526;
}
.dot.sev-urgent {
  background: #e0533d;
}

.notif-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.notif-title {
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: var(--text);
}
.notif-body {
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.notif-dismiss {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
}
.notif-dismiss:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.notif-dismiss .material-symbols-outlined {
  font-size: 16px;
  line-height: 1;
}
</style>
