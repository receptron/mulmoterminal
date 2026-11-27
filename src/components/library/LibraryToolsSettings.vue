<script setup lang="ts">
// Claude Code's settings for the chosen directory (#3332), laid over each other as it lays them: each
// file it reads, then the permission rules, variables, hooks and other keys in effect, every one naming
// the file it came from. Read only.
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { PERMISSION_KINDS, type LibrarySettings, type SettingsSource } from "../../../common/librarySettings";
import { loadToolSettings } from "../../composables/libraryApi";
import { onOverlayShownAgain } from "../../composables/overlayVisibility";

const props = defineProps<{ cwd: string }>();
const { t } = useI18n();
const settings = ref<LibrarySettings | null>(null);
const failed = ref(false);

let reads = 0;
watch(
  () => props.cwd,
  async (cwd) => {
    const mine = ++reads;
    settings.value = null;
    failed.value = false;
    const read = await loadToolSettings(cwd);
    if (mine !== reads) return;
    settings.value = read;
    failed.value = read === null;
  },
  { immediate: true },
);
// The screen is kept while closed and the settings files may have changed; a failed re-read keeps them.
async function reread(): Promise<void> {
  const mine = ++reads;
  const read = await loadToolSettings(props.cwd);
  if (mine !== reads || read === null) return;
  settings.value = read;
  failed.value = false;
}
onOverlayShownAgain(() => void reread());

const sourceLabel = (source: SettingsSource): string => t(`libraryView.tools.settings.source.${source}`);
const HEADING = "m-0 mt-4 font-sans text-[12px] font-[650] text-dim";
const ROW = "flex min-w-0 items-baseline gap-3 font-mono text-[12px] text-fg";
const SOURCE = "flex-none font-sans text-[11px] text-dim";
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto border-t border-border px-4 py-3" data-testid="tool-settings">
    <p v-if="failed" class="m-0 font-sans text-[13px] text-err-text">{{ t("libraryView.tools.settings.failed") }}</p>
    <p v-else-if="settings === null" class="m-0 font-sans text-[13px] text-dim">{{ t("libraryView.loading") }}</p>
    <template v-else>
      <p class="m-0 font-sans text-[12px] text-secondary">{{ t("libraryView.tools.settings.order") }}</p>
      <ul class="m-0 mt-1 list-none p-0" data-testid="tool-settings-files">
        <li v-for="file in settings.files" :key="file.source" :class="ROW">
          <span :class="SOURCE" class="w-28">{{ sourceLabel(file.source) }}</span>
          <span class="min-w-0 truncate" :class="file.state === 'ok' ? '' : 'text-dim'">{{ file.path }}</span>
          <span v-if="file.state !== 'ok'" :class="SOURCE">{{ t(`libraryView.tools.settings.state.${file.state}`) }}</span>
        </li>
      </ul>
      <template v-for="kind in PERMISSION_KINDS" :key="kind">
        <h3 :class="HEADING">{{ t(`libraryView.tools.settings.permissions.${kind}`) }}</h3>
        <p v-if="settings.permissions[kind].length === 0" class="m-0 font-sans text-[12px] text-dim">{{ t("libraryView.tools.settings.none") }}</p>
        <ul class="m-0 list-none p-0" :data-testid="`tool-settings-${kind}`">
          <li v-for="(rule, at) in settings.permissions[kind]" :key="`${rule.source}:${at}`" :class="ROW">
            <span class="min-w-0 break-all">{{ rule.value }}</span><span :class="SOURCE">{{ sourceLabel(rule.source) }}</span>
          </li>
        </ul>
      </template>
      <h3 :class="HEADING">{{ t("libraryView.tools.settings.env") }}</h3>
      <p v-if="settings.env.length === 0" class="m-0 font-sans text-[12px] text-dim">{{ t("libraryView.tools.settings.none") }}</p>
      <ul class="m-0 list-none p-0" data-testid="tool-settings-env">
        <li v-for="variable in settings.env" :key="variable.name" :class="ROW">
          <span class="min-w-0 break-all">{{ variable.name }}={{ variable.value }}</span
          ><span :class="SOURCE">{{ sourceLabel(variable.source) }}</span>
        </li>
      </ul>
      <h3 :class="HEADING">{{ t("libraryView.tools.settings.hooks") }}</h3>
      <p v-if="settings.hooks.length === 0" class="m-0 font-sans text-[12px] text-dim">{{ t("libraryView.tools.settings.none") }}</p>
      <ul class="m-0 list-none p-0" data-testid="tool-settings-hooks">
        <li v-for="(hook, at) in settings.hooks" :key="`${hook.event}:${at}`" :class="ROW">
          <span class="flex-none font-sans text-[12px] text-secondary">{{ hook.event }}</span>
          <span class="min-w-0 break-all">{{ hook.value }}</span><span :class="SOURCE">{{ sourceLabel(hook.source) }}</span>
        </li>
      </ul>
      <h3 :class="HEADING">{{ t("libraryView.tools.settings.other") }}</h3>
      <p v-if="settings.other.length === 0" class="m-0 font-sans text-[12px] text-dim">{{ t("libraryView.tools.settings.none") }}</p>
      <ul class="m-0 list-none p-0" data-testid="tool-settings-other">
        <li v-for="entry in settings.other" :key="entry.key" :class="ROW">
          <span class="min-w-0 break-all">{{ entry.key }}: {{ entry.value }}</span
          ><span :class="SOURCE">{{ sourceLabel(entry.source) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>
