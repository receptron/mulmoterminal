<script setup lang="ts">
// The two agents' marks, drawn rather than picked: Material Symbols is an icon set, not a brand
// set, so anything from it (`code`, `auto_awesome`) says "generic AI thing" twice and leaves the
// reader to work out which row is which. These are the shapes each tool is actually known by.
//
// Geometry only — no text, no logotype — and both inherit `currentColor`, so a window past its
// warning threshold turns its mark amber along with its number rather than staying a fixed swatch
// beside coloured text.
defineProps<{ agent: "claude" | "codex" | "antigravity" }>();

// Anthropic's burst: spokes around a centre. Drawn from one radius so the arms stay even at the
// 13px this renders at, where a hand-placed path goes lopsided.
const SPOKES = 8;
const spokeRotations = Array.from({ length: SPOKES }, (_, i) => (i * 360) / SPOKES);
</script>

<template>
  <svg v-if="agent === 'claude'" viewBox="0 0 24 24" class="h-[13px] w-[13px] flex-none" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line v-for="rotation in spokeRotations" :key="rotation" x1="12" y1="12" x2="12" y2="3.5" :transform="`rotate(${rotation} 12 12)`" />
    </g>
  </svg>
  <svg v-else-if="agent === 'antigravity'" viewBox="0 0 24 24" class="h-[14px] w-[14px] flex-none" fill="currentColor" aria-hidden="true">
    <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
  </svg>
  <svg v-else viewBox="0 0 24 24" class="h-[14px] w-[14px] flex-none" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="1.5">
      <ellipse cx="12" cy="12" rx="4.5" ry="10" transform="rotate(45 12 12)" />
      <ellipse cx="12" cy="12" rx="4.5" ry="10" transform="rotate(-45 12 12)" />
    </g>
  </svg>
</template>
