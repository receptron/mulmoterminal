<script setup lang="ts">
import { useNotifications, type NotifierSeverity } from "../composables/useNotifications";

const { sorted, count, topSeverity, open, dismiss, activate } = useNotifications();

const SEVERITY_COLOR: Record<NotifierSeverity, string> = {
  info: "#6b7280",
  nudge: "#f59e0b",
  urgent: "#ef4444",
};

function badgeColor(): string {
  return topSeverity.value ? SEVERITY_COLOR[topSeverity.value] : SEVERITY_COLOR.info;
}
</script>

<template>
  <div class="notif">
    <button
      type="button"
      class="notif-btn"
      :class="{ active: open }"
      :title="`Notifications${count ? ` (${count})` : ''}`"
      aria-label="Notifications"
      @click="open = !open"
    >
      <span class="material-symbols-outlined">notifications</span>
      <span v-if="count > 0" class="notif-badge" :style="{ background: badgeColor() }">{{ count > 99 ? "99+" : count }}</span>
    </button>

    <template v-if="open">
      <!-- Click-away backdrop. -->
      <div class="notif-backdrop" @click="open = false" />
      <div class="notif-panel" role="dialog" aria-label="Notifications">
        <div class="notif-head">Notifications</div>
        <div v-if="sorted.length === 0" class="notif-empty">No notifications</div>
        <ul v-else class="notif-list">
          <li v-for="entry in sorted" :key="entry.id" class="notif-row" :class="{ clickable: !!entry.navigateTarget }" @click="activate(entry)">
            <span class="notif-dot" :style="{ background: SEVERITY_COLOR[entry.severity] }" />
            <div class="notif-text">
              <div class="notif-title">{{ entry.title }}</div>
              <div v-if="entry.body" class="notif-body">{{ entry.body }}</div>
            </div>
            <button type="button" class="notif-dismiss" title="Dismiss" aria-label="Dismiss" @click.stop="dismiss(entry.id)">
              <span class="material-symbols-outlined">close</span>
            </button>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.notif {
  position: relative;
  display: inline-flex;
}
.notif-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  width: 30px;
  padding: 0;
  border: none;
  background: transparent;
  color: #9aa6cc;
  border-radius: 6px;
  cursor: pointer;
}
.notif-btn:hover {
  background: #26375f;
  color: #fff;
}
.notif-btn.active {
  background: #2f59c0;
  color: #fff;
}
.notif-btn .material-symbols-outlined {
  font-size: 19px;
  line-height: 1;
}
.notif-badge {
  position: absolute;
  top: 1px;
  right: 1px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  font-family: system-ui, sans-serif;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  color: #fff;
  text-align: center;
  box-sizing: border-box;
}
.notif-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.notif-panel {
  position: absolute;
  top: 36px;
  right: 0;
  z-index: 41;
  width: 320px;
  max-height: 60vh;
  overflow-y: auto;
  background: #1b2545;
  border: 1px solid #2a2a4e;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font-family: system-ui, sans-serif;
}
.notif-head {
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #e6e6f0;
  border-bottom: 1px solid #2a2a4e;
}
.notif-empty {
  padding: 18px 12px;
  font-size: 12px;
  color: #9aa6cc;
  text-align: center;
}
.notif-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.notif-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px 9px 12px;
  border-bottom: 1px solid #232c4f;
}
.notif-row.clickable {
  cursor: pointer;
}
.notif-row.clickable:hover {
  background: #26375f;
}
.notif-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
}
.notif-text {
  flex: 1 1 auto;
  min-width: 0;
}
.notif-title {
  font-size: 12px;
  font-weight: 600;
  color: #e6e6f0;
  word-break: break-word;
}
.notif-body {
  margin-top: 2px;
  font-size: 11px;
  color: #9aa6cc;
  word-break: break-word;
}
.notif-dismiss {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  width: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: #6b779e;
  border-radius: 4px;
  cursor: pointer;
}
.notif-dismiss:hover {
  background: #33406c;
  color: #fff;
}
.notif-dismiss .material-symbols-outlined {
  font-size: 15px;
  line-height: 1;
}
</style>
