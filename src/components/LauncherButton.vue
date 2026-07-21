<script setup lang="ts">
// The toolbar's icon-only tab button. One shared button so the launcher styling
// (size, active accent, hover) lives in one place and travels with any new tab.
defineProps<{
  icon: string;
  title: string;
  label: string;
  active?: boolean;
  ariaPressed?: boolean;
}>();
defineEmits<{ (e: "click"): void }>();
</script>

<template>
  <button
    type="button"
    class="inline-flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-md border-0 p-0"
    :class="active ? 'bg-accent-bg text-on-accent' : 'bg-transparent text-muted hover:bg-hover hover:text-fg'"
    :title="title"
    :aria-label="label"
    :aria-pressed="ariaPressed"
    @click="$emit('click')"
  >
    <span class="material-symbols-outlined text-[19px] leading-none">{{ icon }}</span>
  </button>
</template>
