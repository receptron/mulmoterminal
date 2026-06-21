<script setup lang="ts">
// The ★ favorite toggle the collection plugin renders (via the binding's
// `pinToggle`) on index cards + the view header. Talks to the useShortcuts
// singleton directly — a parent only supplies the target's identity + cached
// label/icon. Click/keyboard activation are stopped so toggling never also opens
// the underlying card.
//
// Rendered INSIDE the plugin's shadow root, where scoped CSS (document-head) and the
// host's Tailwind don't reach — so styling is inline. The star glyph uses the
// `material-icons` class, which the shadow-injected icon CSS maps to Material Symbols.
import { computed } from "vue";
import { useShortcuts } from "../composables/useShortcuts";
import type { ShortcutKind } from "../types/shortcuts";

const props = defineProps<{
  kind: ShortcutKind;
  slug: string;
  /** Cached at pin time so the launcher renders without re-fetching. */
  title: string;
  icon: string;
}>();

const { isPinned, pin, unpin } = useShortcuts();
const pinned = computed(() => isPinned(props.kind, props.slug));

function toggle(): void {
  if (pinned.value) void unpin(props.kind, props.slug);
  else void pin({ kind: props.kind, slug: props.slug, title: props.title, icon: props.icon });
}
</script>

<template>
  <button
    type="button"
    :title="pinned ? 'Unpin from toolbar' : 'Pin to toolbar'"
    :aria-label="pinned ? 'Unpin from toolbar' : 'Pin to toolbar'"
    :aria-pressed="pinned"
    :data-testid="`pin-toggle-${kind}-${slug}`"
    :style="{
      height: '32px',
      width: '32px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '6px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: pinned ? 'var(--amber, #f59e0b)' : 'var(--text-dim, #94a3b8)',
    }"
    @click.stop="toggle"
    @keydown.enter.stop
    @keydown.space.stop
  >
    <span class="material-icons" style="font-size: 20px">{{ pinned ? "star" : "star_border" }}</span>
  </button>
</template>
