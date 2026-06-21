<script setup lang="ts">
// Ported from mulmoclaude's FilterChip — a small pill toggle used to filter
// the session list. Adapted to mulmoterminal's dark scoped-CSS theme.
defineProps<{
  active: boolean;
  label: string;
  count?: number;
}>();
defineEmits<{ (e: "click"): void }>();
</script>

<template>
  <button type="button" :aria-pressed="active" :class="['chip', { active }]" @click="$emit('click')">
    {{ label }}<template v-if="count !== undefined"> ({{ count }}) </template>
  </button>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  font-size: 11px;
  line-height: 16px;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
}
.chip:hover {
  background: var(--bg-selected-hover);
  color: var(--text-secondary);
}
.chip.active {
  background: var(--accent-bg);
  border-color: var(--accent-bg);
  color: var(--on-accent);
}
</style>
