<script setup lang="ts">
// A small pill toggle used to filter the session list. Active chips ignore hover
// (the accent fill wins), so the hover styles apply only in the inactive state.
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
    class="inline-flex items-center py-0.5 px-2.5 text-[11px] leading-4 rounded-full border cursor-pointer transition-colors duration-[120ms]"
    :class="active ? 'bg-accent-bg border-accent-bg text-on-accent' : 'bg-subtle border-border text-muted hover:bg-selected-hover hover:text-secondary'"
    @click="$emit('click')"
  >
    {{ label }}<template v-if="count !== undefined"> ({{ count }}) </template>
  </button>
</template>
