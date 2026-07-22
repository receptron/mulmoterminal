<script setup lang="ts">
// The settings modal's shared action button. `primary` is the accent-filled
// variant (the footer Close); everything else — title, disabled, @click — falls
// through to the underlying <button>.
defineProps<{ primary?: boolean }>();
</script>

<template>
  <button
    type="button"
    class="cursor-pointer rounded-md border px-3.5 py-1.5 text-[13px] disabled:cursor-default disabled:opacity-60"
    :class="
      primary ? 'border-accent bg-accent-bg text-on-accent hover:bg-accent-bg-hover' : 'border-border bg-elevated text-secondary hover:bg-hover hover:text-fg'
    "
  >
    <slot />
  </button>
</template>
