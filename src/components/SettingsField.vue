<script setup lang="ts">
// The settings modal's shared text input. Wraps a v-model; placeholder,
// aria-label, spellcheck, @change / @keydown, and any extra layout classes
// (flex-auto, font-mono, …) fall through to the underlying <input>.
defineProps<{ modelValue: string }>();
defineEmits<{ (e: "update:modelValue", value: string): void }>();
</script>

<template>
  <input
    type="text"
    :value="modelValue"
    class="box-border rounded-md border border-border bg-input px-2.5 py-[7px] text-[12px] text-fg focus:border-accent focus:outline-none"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
