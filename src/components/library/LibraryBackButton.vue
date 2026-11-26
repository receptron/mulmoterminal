<script setup lang="ts">
// The narrow-screen way back from a Library reader to its list; the caller's @click and data-* fall through.
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <button
    type="button"
    class="hidden cursor-pointer items-center gap-1 border-0 bg-transparent px-4 pt-3 font-sans text-[13px] text-secondary max-[760px]:flex"
  >
    <span class="material-symbols-outlined text-[18px]">arrow_back</span>{{ t("libraryView.back") }}
  </button>
</template>
