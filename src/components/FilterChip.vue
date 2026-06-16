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
  <button
    type="button"
    :aria-pressed="active"
    :class="['chip', { active }]"
    @click="$emit('click')"
  >
    {{ label }}<template v-if="count !== undefined">
      ({{ count }})
    </template>
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
  border: 1px solid #2a2a4e;
  background: #1b2647;
  color: #9aa5c4;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.chip:hover {
  background: #224a86;
  color: #cfe0ff;
}
.chip.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}
</style>
