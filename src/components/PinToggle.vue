<script setup lang="ts">
// The favorite toggle the collection plugin renders (via the binding's
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
import type { ShortcutKind } from "../../common/shortcuts";

const props = defineProps<{
  kind: ShortcutKind;
  slug: string;
  /** Cached at pin time so the launcher renders without re-fetching. */
  title: string;
  icon: string;
  /** The collection's accent colour, cached with the label. The plugin passes it (MulmoClaude's
   *  pin toggle has taken it all along); leaving it out of these props is what left a pin made
   *  HERE colourless in MulmoClaude's launcher until its next index visit reconciled one in
   *  (#1995). Nothing in this app draws it — see `Shortcut.color`. */
  color?: string;
}>();

const { isPinned, pin, unpin } = useShortcuts();
const pinned = computed(() => isPinned(props.kind, props.slug));

function toggle(): void {
  if (pinned.value) void unpin(props.kind, props.slug);
  // Absent rather than null when there is no colour: `color: undefined` survives as a key on the
  // object, and the file is shared — the other app should not have to know to ignore it.
  else void pin({ kind: props.kind, slug: props.slug, title: props.title, icon: props.icon, ...(props.color ? { color: props.color } : {}) });
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
