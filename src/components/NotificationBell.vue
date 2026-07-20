<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import ToolbarPopover from "./ToolbarPopover.vue";
import { useNotifications, type NotifierEntry, type NotifierSeverity } from "../composables/useNotifications";

// Toolbar bell: a severity-coloured unread badge + a dropdown listing the active
// notifications. Mirrors MulmoClaude's bell structure (severity-coloured bell icon
// per row, title + lifecycle tag, a "relative-time · source" meta line, an
// "Active (N)" header) in MulmoTerminal's dark palette. A row click navigates to the
// entry's target (a completion bell's pending record) WITHOUT clearing it — the
// watcher clears it when the record is done; the ✕ dismisses it explicitly.
const { count, topSeverity, sorted, dismiss, activate } = useNotifications();

const popoverRef = useTemplateRef<InstanceType<typeof ToolbarPopover>>("popover");

const triggerTitle = computed(() => {
  if (!count.value) return "Notifications";
  const suffix = count.value === 1 ? "" : "s";
  return `${count.value} notification${suffix}`;
});

function onRowClick(entry: NotifierEntry) {
  // Navigate if it's a deep-linkable entry; close either way so the click feels live.
  activate(entry);
  popoverRef.value?.close();
}

function severityClass(severity: NotifierSeverity): string {
  return `sev-${severity}`;
}

// Strip a leading `@scope/` from a package name for the meta line (matches
// MulmoClaude's shortPkg) — unscoped legacy pluginPkgs pass through unchanged.
function shortPkg(pluginPkg: string): string {
  return pluginPkg.startsWith("@") ? pluginPkg.split("/").slice(1).join("/") || pluginPkg : pluginPkg;
}

// Compact relative time ("just now", "5m", "3h", "2d") from an ISO timestamp.
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
</script>

<template>
  <ToolbarPopover ref="popover" icon="notifications" :title="triggerTitle" trigger-label="Notifications" pane-class="notif-pop" pane-label="Notifications">
    <template #trigger-extra>
      <span v-if="count" class="badge" :class="topSeverity ? severityClass(topSeverity) : ''">{{ count > 99 ? "99+" : count }}</span>
    </template>

    <div class="notif-head">Notifications</div>
    <div class="notif-subhead">Active ({{ sorted.length }})</div>
    <div v-if="!sorted.length" class="notif-empty">You're all caught up.</div>
    <ul v-else class="notif-list">
      <li
        v-for="entry in sorted"
        :key="entry.id"
        class="notif-row"
        :class="{ clickable: !!entry.navigateTarget }"
        :role="entry.navigateTarget ? 'button' : undefined"
        :tabindex="entry.navigateTarget ? 0 : undefined"
        :aria-label="entry.navigateTarget ? entry.title : undefined"
        :title="entry.body || undefined"
        @click="onRowClick(entry)"
        @keydown.enter.prevent.self="entry.navigateTarget && onRowClick(entry)"
        @keydown.space.prevent.self="entry.navigateTarget && onRowClick(entry)"
      >
        <span class="material-symbols-outlined bell-icon" :class="severityClass(entry.severity)" aria-hidden="true">notifications</span>
        <span class="notif-text">
          <span class="notif-title-row">
            <span class="notif-title">{{ entry.title }}</span>
            <span v-if="entry.lifecycle" class="notif-lifecycle">{{ entry.lifecycle }}</span>
          </span>
          <span v-if="entry.body" class="notif-body">{{ entry.body }}</span>
          <span class="notif-meta">{{ relativeTime(entry.createdAt) }} · {{ shortPkg(entry.pluginPkg) }}</span>
        </span>
        <button type="button" class="notif-dismiss" title="Dismiss" aria-label="Dismiss notification" @click.stop="dismiss(entry.id)">
          <span class="material-symbols-outlined">close</span>
        </button>
      </li>
    </ul>
  </ToolbarPopover>
</template>

<style scoped>
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

/* The panel div lives inside ToolbarPopover, so its scopeId differs from ours. */
:deep(.notif-pop) {
  width: 340px;
  max-height: 460px;
  overflow-y: auto;
  padding: 4px;
}

.notif-head {
  padding: 6px 8px;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.notif-subhead {
  padding: 4px 8px;
  font-family: system-ui, sans-serif;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  border-top: 1px solid var(--border);
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
.notif-row:focus-visible {
  outline: 2px solid var(--accent-bg);
  outline-offset: -2px;
}

/* Per-row severity-coloured bell icon — MulmoClaude's "this is a notification"
   at-a-glance signal (replaces a generic coloured dot). */
.bell-icon {
  flex: 0 0 auto;
  margin-top: 1px;
  font-size: 18px;
  line-height: 1;
  color: #9aa6cc;
}
.bell-icon.sev-info {
  color: #9aa6cc;
}
.bell-icon.sev-nudge {
  color: #e0a526;
}
.bell-icon.sev-urgent {
  color: #e0533d;
}

.notif-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.notif-title-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.notif-title {
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notif-lifecycle {
  flex: 0 0 auto;
  font-family: system-ui, sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.notif-body {
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.notif-meta {
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 10px;
  color: var(--text-muted);
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
