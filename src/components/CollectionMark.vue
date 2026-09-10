<script setup lang="ts">
// The collection a session was started FROM, worn by its cell (#2020).
//
// Beside the directory's icon rather than instead of it: the two answer different questions, and
// a chat started from a collection runs in the WORKSPACE, so every one of them carries the same
// directory picture. Which cell is about which collection is unreadable from that alone once more
// than one is on the grid.
//
// Drawn with core's `IconGlyph`, which is the one renderer for a schema-authored `icon`: the value
// is a Material Symbols LIGATURE NAME or a single emoji, and a name the font cannot resolve is laid
// out as ordinary text — 11x over the icon box, painting over the controls beside it. IconGlyph
// classifies the two and contains both. Never inline a `material-symbols-outlined` span for one.
import { IconGlyph } from "@mulmoclaude/core/plugin-vue";
import type { SessionCollection } from "../../common/sessionCollection";

const props = defineProps<{
  collection: SessionCollection | null;
  /** Rendered size, as a Tailwind class named by the CALL SITE — a class only exists if some
   *  Tailwind build saw the literal, and core's own build is not this app's. */
  sizeClass?: string;
}>();

const DEFAULT_SIZE_CLASS = "text-[13px]";

// The collection's own name, not the glyph's: a Material Symbols ligature would make a screen
// reader announce "checkbook" where the screen shows a picture of one.
const label = () => (props.collection ? `Started from ${props.collection.title}` : "");
</script>

<template>
  <span v-if="collection" data-testid="cell-collection-mark" class="flex-none leading-none text-secondary" :title="label()"
    ><IconGlyph :icon="collection.icon" :size-class="sizeClass ?? DEFAULT_SIZE_CLASS" :aria-label="label()"
  /></span>
</template>
