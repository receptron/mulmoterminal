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
  <span
    v-if="status?.repo && (status.branch || status.detached)"
    data-testid="git-chip"
    class="inline-flex items-center gap-[0.25em] px-[0.4em] h-[1.5em] rounded-[0.75em] text-[0.72rem] leading-[1.5em] bg-[color-mix(in_srgb,currentColor_12%,transparent)] opacity-85 whitespace-nowrap max-w-[16ch] overflow-hidden"
    :class="status.detached ? 'text-[#d19a66]' : 'text-inherit'"
    :title="title"
  >
    <span data-testid="git-branch" class="overflow-hidden text-ellipsis">⎇ {{ label }}</span>
    <span v-if="!hideDirty && status.dirty > 0" data-testid="git-dirty" class="text-[#e5c07b]">●{{ status.dirty }}</span>
    <span v-if="status.upstream && status.ahead > 0" data-testid="git-ab" class="opacity-80">↑{{ status.ahead }}</span>
    <span v-if="status.upstream && status.behind > 0" data-testid="git-ab" class="opacity-80">↓{{ status.behind }}</span>
  </span>
</template>
