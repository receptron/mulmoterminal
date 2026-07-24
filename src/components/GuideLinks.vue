<script setup lang="ts">
// The user guide's per-language landing pages, surfaced where a first-time user is most
// likely stuck: the empty grid and the settings modal. Both languages are offered as
// self-labelled links (日本語 / English) rather than a locale-detected single one — each
// label is written in its own language, so a reader reaches the version they can read
// without the app guessing from navigator.language.
const GUIDE_JA = "https://receptron.github.io/mulmoterminal/guide/ja/";
const GUIDE_EN = "https://receptron.github.io/mulmoterminal/guide/en/";
const LINK_CLASS = "font-medium text-accent hover:underline";
</script>

<template>
  <p class="m-0 font-sans text-[12px] text-dim">
    📖 Not sure how to use MulmoTerminal? Read the guide —
    <a :class="LINK_CLASS" :href="GUIDE_JA" target="_blank" rel="noopener noreferrer">日本語</a>
    <span aria-hidden="true"> · </span>
    <a :class="LINK_CLASS" :href="GUIDE_EN" target="_blank" rel="noopener noreferrer">English</a>
  </p>
</template>
