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

// Severity colours (info blue-grey, nudge amber, urgent red) — hardcoded, token-less
// hues shared by the trigger badge (background) and the per-row bell (text).
function badgeClass(severity: NotifierSeverity | null): string {
  if (severity === "nudge") return "bg-[#e0a526]";
  if (severity === "urgent") return "bg-[#e0533d]";
  return "bg-[#9aa6cc]";
}
function bellColorClass(severity: NotifierSeverity): string {
  if (severity === "nudge") return "text-[#e0a526]";
  if (severity === "urgent") return "text-[#e0533d]";
  return "text-[#9aa6cc]";
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
  <ToolbarPopover
    ref="popover"
    icon="notifications"
    :title="triggerTitle"
    trigger-label="Notifications"
    pane-class="w-[340px] max-h-[460px] overflow-y-auto p-1"
    pane-label="Notifications"
  >
    <template #trigger-extra>
      <span
        v-if="count"
        class="absolute right-px top-px box-border h-[14px] min-w-[14px] rounded-[7px] px-[3px] font-sans text-[9px] font-bold leading-[14px] text-white"
        :class="badgeClass(topSeverity)"
        >{{ count > 99 ? "99+" : count }}</span
      >
    </template>

    <div class="px-2 py-1.5 font-sans text-[12px] font-semibold text-fg">Notifications</div>
    <div class="border-t border-border px-2 py-1 font-sans text-[11px] font-medium text-muted">Active ({{ sorted.length }})</div>
    <div v-if="!sorted.length" class="px-2 py-3.5 text-center font-sans text-[12px] text-muted">You're all caught up.</div>
    <ul v-else class="m-0 flex list-none flex-col p-0">
      <li
        v-for="entry in sorted"
        :key="entry.id"
        class="flex items-start gap-2 rounded-md p-2 focus-visible:[outline:2px_solid_var(--accent-bg)] focus-visible:[outline-offset:-2px]"
        :class="{ 'cursor-pointer hover:bg-hover': !!entry.navigateTarget }"
        :role="entry.navigateTarget ? 'button' : undefined"
        :tabindex="entry.navigateTarget ? 0 : undefined"
        :aria-label="entry.navigateTarget ? entry.title : undefined"
        :title="entry.body || undefined"
        @click="onRowClick(entry)"
        @keydown.enter.prevent.self="entry.navigateTarget && onRowClick(entry)"
        @keydown.space.prevent.self="entry.navigateTarget && onRowClick(entry)"
      >
        <span class="material-symbols-outlined mt-px flex-none text-[18px] leading-none" :class="bellColorClass(entry.severity)" aria-hidden="true"
          >notifications</span
        >
        <span class="flex min-w-0 flex-auto flex-col gap-0.5">
          <span class="flex min-w-0 items-baseline gap-1.5">
            <span class="truncate font-sans text-[13px] text-fg">{{ entry.title }}</span>
            <span v-if="entry.lifecycle" class="flex-none font-sans text-[9px] uppercase tracking-[0.04em] text-muted">{{ entry.lifecycle }}</span>
          </span>
          <span v-if="entry.body" class="font-sans text-[12px] text-muted [overflow-wrap:anywhere]">{{ entry.body }}</span>
          <span class="font-mono text-[10px] text-muted">{{ relativeTime(entry.createdAt) }} · {{ shortPkg(entry.pluginPkg) }}</span>
        </span>
        <button
          type="button"
          class="inline-flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted hover:bg-hover hover:text-fg"
          title="Dismiss"
          aria-label="Dismiss notification"
          @click.stop="dismiss(entry.id)"
        >
          <span class="material-symbols-outlined text-[16px] leading-none">close</span>
        </button>
      </li>
    </ul>
  </ToolbarPopover>
</template>
