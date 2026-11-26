<script setup lang="ts">
// The release guides for every version since the user last closed this dialog. The guides are the
// dated setup pages each release ships, so this says what to try and what looks different in the
// words the release was documented in, not in a second, shorter copy of them.
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import MarkdownProse from "./MarkdownProse.vue";
import { MODAL_FOCUSABLE } from "../utils/focusTrap";
import { useModalKeyboard } from "../composables/useModalKeyboard";
import { CHANGELOG_URL, GUIDE_SITE_ORIGIN, type WhatsNewResponse } from "../../common/whatsNew";

const GUIDE_LOCALES: readonly string[] = ["en", "ja"];

const { t, locale } = useI18n();

const props = defineProps<{ whatsNew: WhatsNewResponse }>();
const emit = defineEmits<{ (e: "close"): void }>();

// Korean and Chinese readers get the English guide, and are told so rather than left wondering.
const readsTranslatedGuide = computed(() => GUIDE_LOCALES.includes(locale.value));

const modalEl = ref<HTMLElement>();
useModalKeyboard({ modalEl, onClose: () => emit("close"), trapSelector: MODAL_FOCUSABLE, focusSelector: "button" });
</script>

<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(0,0,0,0.55)] p-4" @click.self="emit('close')">
    <div
      ref="modalEl"
      class="flex max-h-full w-full max-w-[760px] flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-panel p-5 text-left"
      role="dialog"
      aria-modal="true"
      :aria-label="t('whatsNew.title')"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h2 class="m-0 font-sans text-[16px] font-semibold text-fg">{{ t("whatsNew.title") }}</h2>
          <p class="m-0 font-sans text-[12px] text-secondary">{{ t("whatsNew.intro", { version: props.whatsNew.version }) }}</p>
          <p v-if="!readsTranslatedGuide" class="m-0 font-sans text-[11px] text-dim">{{ t("whatsNew.englishOnly") }}</p>
          <p class="m-0 mt-2 flex items-start gap-2 rounded-md border border-border bg-elevated px-3 py-2 font-sans text-[12px] leading-[1.6] text-fg">
            <span class="material-symbols-outlined shrink-0 text-[16px] leading-[1.6] text-secondary" aria-hidden="true">favorite</span>
            <span>{{ t("whatsNew.thanks") }}</span>
          </p>
        </div>
        <button
          type="button"
          class="cursor-pointer border-none bg-transparent p-0 text-dim hover:text-fg"
          :aria-label="t('whatsNew.close')"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
        </button>
      </div>

      <section v-for="entry in props.whatsNew.entries" :key="entry.version" class="flex flex-col gap-2 border-t border-border pt-4">
        <h3 class="m-0 font-sans text-[14px] font-semibold text-fg">{{ entry.title }}</h3>
        <MarkdownProse :markdown="entry.markdown" :trusted-image-origin="GUIDE_SITE_ORIGIN" class="font-sans text-[13px] leading-[1.6] text-fg" />
        <a :href="entry.url" target="_blank" rel="noopener noreferrer" class="self-start font-sans text-[11px] text-dim underline hover:text-fg">
          {{ t("whatsNew.openOnWeb") }}
        </a>
      </section>

      <a
        v-if="props.whatsNew.truncated"
        :href="CHANGELOG_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="font-sans text-[12px] text-secondary underline hover:text-fg"
      >
        {{ t("whatsNew.older") }}
      </a>

      <button
        type="button"
        class="self-end cursor-pointer rounded-md border border-border bg-elevated px-4 py-1.5 font-sans text-[12px] text-fg hover:bg-input"
        @click="emit('close')"
      >
        {{ t("whatsNew.close") }}
      </button>
    </div>
  </div>
</template>
