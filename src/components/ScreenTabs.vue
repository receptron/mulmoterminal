<script setup lang="ts">
// The screens opened so far, as tabs under the toolbar while one of them is in front, with the
// terminals first. The screens move down while it is up (`--screen-top` in style.css).
import { useI18n } from "vue-i18n";
import IconGlyph from "./IconGlyph.vue";
import { SCREEN_ICONS, SCREEN_LABEL_KEYS } from "../composables/paletteScreens";
import { closeScreenTab, frontScreen, screenTabs, showScreenTab, showTerminals } from "../composables/useScreenTabs";

const { t } = useI18n();
const TAB = "flex h-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2.5 text-[12px]";
</script>

<template>
  <nav
    v-if="frontScreen !== null"
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
      :key="tab.screen"
      class="group flex min-w-0 items-stretch border-l border-border"
      :class="tab.screen === frontScreen ? 'bg-deep text-fg' : 'text-secondary hover:bg-hover hover:text-fg'"
    >
      <button
        type="button"
        :class="[TAB, 'text-inherit']"
        :aria-current="tab.screen === frontScreen ? 'page' : undefined"
        data-testid="screen-tab"
        @click="showScreenTab(tab.screen)"
      >
        <IconGlyph :icon="SCREEN_ICONS[tab.screen]" material-class="text-[16px]" github-class="text-[13px]" />
        <span class="truncate">{{ t(SCREEN_LABEL_KEYS[tab.screen]) }}</span>
      </button>
      <button
        type="button"
        class="mr-1 flex w-5 cursor-pointer items-center justify-center self-center rounded border-0 bg-transparent text-[14px] text-secondary hover:bg-hover hover:text-fg"
        :aria-label="t('screenTabs.close', { screen: t(SCREEN_LABEL_KEYS[tab.screen]) })"
        :data-tip="t('screenTabs.close', { screen: t(SCREEN_LABEL_KEYS[tab.screen]) })"
        @click="closeScreenTab(tab.screen)"
      >
        <span class="material-symbols-outlined text-[14px]" aria-hidden="true">close</span>
      </button>
    </div>
  </nav>
</template>
