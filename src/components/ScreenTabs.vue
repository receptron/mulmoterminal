<script setup lang="ts">
// The screens opened so far, as tabs under the toolbar while one of them is in front, with the
// terminals first, and each collection or feed opened after its screen's index tab. The screens
// move down while it is up (`--screen-top` in style.css).
import { nextTick, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import IconGlyph from "./IconGlyph.vue";
import { SCREEN_ICONS, SCREEN_LABEL_KEYS } from "../composables/paletteScreens";
import type { ScreenTab } from "../composables/screenTabsModel";
import { closeScreenTab, frontTabKey, screenTabs, showScreenTab, showTerminals } from "../composables/useScreenTabs";
import { useScreenTabItemLabels } from "../composables/useScreenTabItemLabels";

const { t } = useI18n();
const strip = useTemplateRef<HTMLElement>("strip");
const { labelOf } = useScreenTabItemLabels();

// An item's own name and icon once its list has given them; its slug and its screen's icon until then.
const titleOf = (tab: ScreenTab): string => (tab.item ? (labelOf(tab)?.title ?? tab.item.slug) : t(SCREEN_LABEL_KEYS[tab.screen]));
const iconOf = (tab: ScreenTab): string => labelOf(tab)?.icon || SCREEN_ICONS[tab.screen];

// The closed tab had the keyboard; it goes to the tab now in front (still in the strip after its own
// close button went), or nowhere when the strip went with the last screen.
async function close(key: string): Promise<void> {
  await closeScreenTab(key);
  await nextTick();
  strip.value?.querySelector<HTMLElement>("[aria-current=page]")?.focus();
}

const TAB = "flex h-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2.5 text-[12px]";
</script>

<template>
  <nav
    v-if="frontTabKey !== null"
    ref="strip"
    data-screen-tabs
    class="fixed inset-x-0 top-10 z-50 flex h-8 items-stretch overflow-x-auto border-b border-border bg-panel"
    :aria-label="t('screenTabs.label')"
  >
    <button type="button" :class="[TAB, 'text-secondary hover:bg-hover hover:text-fg']" @click="showTerminals">
      <IconGlyph :icon="SCREEN_ICONS.terminals" material-class="text-[16px]" github-class="text-[13px]" />
      <span class="truncate">{{ t(SCREEN_LABEL_KEYS.terminals) }}</span>
    </button>
    <div
      v-for="tab in screenTabs"
      :key="tab.key"
      class="group flex min-w-0 items-stretch border-l border-border"
      :class="tab.key === frontTabKey ? 'bg-deep text-fg' : 'text-secondary hover:bg-hover hover:text-fg'"
    >
      <button
        type="button"
        :class="[TAB, 'text-inherit']"
        :aria-current="tab.key === frontTabKey ? 'page' : undefined"
        data-testid="screen-tab"
        @click="showScreenTab(tab.key)"
      >
        <IconGlyph :icon="iconOf(tab)" material-class="text-[16px]" github-class="text-[13px]" />
        <span class="truncate">{{ titleOf(tab) }}</span>
      </button>
      <button
        type="button"
        class="mr-1 flex w-5 cursor-pointer items-center justify-center self-center rounded border-0 bg-transparent text-[14px] text-secondary hover:bg-hover hover:text-fg"
        :aria-label="t('screenTabs.close', { screen: titleOf(tab) })"
        :data-tip="t('screenTabs.close', { screen: titleOf(tab) })"
        @click="close(tab.key)"
      >
        <span class="material-symbols-outlined text-[14px]" aria-hidden="true">close</span>
      </button>
    </div>
  </nav>
</template>
