<script setup lang="ts">
// The launch form for a remote host (#3506): a directory typed in, and a built-in agent or the
// shell. Nothing here asks this machine's /api: its saved directories and chips name paths on THIS
// disk, which is why CellLaunchForm is not reused with a flag.
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { AGENT_PICKER_OPTIONS } from "./agentPicker";
import { isLaunchAgent, type LaunchAgent } from "../../common/launchAgent";
import { remoteDirOf, type RemoteStart } from "./remoteLaunch";
import { LAUNCH_ROW } from "./launchFormClasses";
import type { RemoteHostSummary } from "../../common/remoteHosts";

const { t } = useI18n();

const props = defineProps<{ host: RemoteHostSummary }>();
const emit = defineEmits<{ (e: "start", value: RemoteStart): void; (e: "close"): void }>();

const AGENTS = AGENT_PICKER_OPTIONS.flatMap((option) => (isLaunchAgent(option.agent) ? [{ agent: option.agent, label: option.label }] : []));

const dir = ref("");
const agent = ref<LaunchAgent>("claude");
const startable = computed(() => remoteDirOf(dir.value) !== null);
const showDirHint = computed(() => dir.value.trim() !== "" && !startable.value);

function start() {
  if (startable.value) emit("start", { host: props.host.id, dir: dir.value, agent: agent.value });
}
</script>

<template>
  <form data-testid="remote-launch" class="flex flex-col items-center gap-3 p-4" @submit.prevent="start">
    <button
      type="button"
      data-testid="cell-launch-cancel"
      class="absolute right-1.5 top-1.5 inline-flex h-[26px] w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-[16px] leading-none text-secondary hover:bg-[var(--err-hover-bg)] hover:text-err-text"
      :data-tip="t('tips.launch.cancel')"
      :aria-label="t('tips.launch.cancel')"
      @click="emit('close')"
    >
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
    <label :class="LAUNCH_ROW" class="flex flex-col gap-1 text-[12px] text-secondary">
      {{ t("tips.launch.remote.dirLabel", { label: host.label }) }}
      <input
        v-model="dir"
        data-testid="cell-dir-input"
        class="box-border w-full rounded-md border border-border bg-input px-2.5 py-[7px] font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
        :placeholder="t('tips.launch.remote.dirPlaceholder')"
        spellcheck="false"
        autocomplete="off"
      />
      <span v-if="showDirHint" data-testid="remote-dir-hint" class="font-sans text-[11px] leading-snug text-amber">{{
        t("tips.launch.remote.dirNeedsAbsolute", { label: host.label })
      }}</span>
    </label>
    <div :class="LAUNCH_ROW" class="flex flex-wrap gap-1.5" role="radiogroup">
      <button
        v-for="option in AGENTS"
        :key="option.agent"
        type="button"
        role="radio"
        :data-testid="`remote-agent-${option.agent}`"
        :aria-checked="agent === option.agent"
        class="cursor-pointer rounded-md border px-2.5 py-1 text-[12px]"
        :class="agent === option.agent ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-transparent text-secondary hover:text-fg'"
        @click="agent = option.agent"
      >
        {{ option.label }}
      </button>
    </div>
    <button
      type="submit"
      data-testid="remote-start"
      class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-elevated px-3 py-1 text-[12px] text-secondary enabled:hover:border-accent enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-40"
      :disabled="!startable"
    >
      <span class="material-symbols-outlined text-[18px]" aria-hidden="true">play_arrow</span>
      {{ t("tips.launch.remote.start", { label: host.label }) }}
    </button>
    <p :class="LAUNCH_ROW" class="text-[11px] text-secondary">{{ t("tips.launch.remote.localOnly") }}</p>
  </form>
</template>
