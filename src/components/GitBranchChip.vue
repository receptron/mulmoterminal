<script setup lang="ts">
import { computed } from "vue";
import type { GitStatus } from "../composables/useGitStatus";

// `hideDirty` suppresses the dirty count for worktree cells, which already show
// ahead/dirty vs their base branch in the diff badge next to this chip.
const props = defineProps<{ status: GitStatus | null; hideDirty?: boolean }>();

const label = computed(() => (props.status?.detached ? "detached" : (props.status?.branch ?? "")));

const title = computed(() => {
  const s = props.status;
  if (!s?.repo) return "";
  const parts = [s.detached ? "detached HEAD" : `branch ${s.branch}`];
  if (s.dirty > 0) parts.push(`${s.dirty} uncommitted`);
  if (s.upstream && s.ahead > 0) parts.push(`${s.ahead} ahead`);
  if (s.upstream && s.behind > 0) parts.push(`${s.behind} behind`);
  return parts.join(" · ");
});
</script>

<template>
  <span v-if="status?.repo && (status.branch || status.detached)" class="git-chip" :class="{ detached: status.detached }" :title="title">
    <span class="git-branch">⎇ {{ label }}</span>
    <span v-if="!hideDirty && status.dirty > 0" class="git-dirty">●{{ status.dirty }}</span>
    <span v-if="status.upstream && status.ahead > 0" class="git-ab">↑{{ status.ahead }}</span>
    <span v-if="status.upstream && status.behind > 0" class="git-ab">↓{{ status.behind }}</span>
  </span>
</template>

<style scoped>
.git-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  padding: 0 0.4em;
  height: 1.5em;
  border-radius: 0.75em;
  font-size: 0.72rem;
  line-height: 1.5em;
  background: color-mix(in srgb, currentColor 12%, transparent);
  color: inherit;
  opacity: 0.85;
  white-space: nowrap;
  max-width: 16ch;
  overflow: hidden;
}
.git-branch {
  overflow: hidden;
  text-overflow: ellipsis;
}
.git-chip.detached {
  color: #d19a66;
}
.git-dirty {
  color: #e5c07b;
}
.git-ab {
  opacity: 0.8;
}
</style>
